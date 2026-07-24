import Decimal from 'decimal.js';
import {
  decodeFunctionData,
  erc20Abi,
  type Hex,
  type PrivateKeyAccount,
  UserRejectedRequestError,
} from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLogger } from '../../../src/domain';
import { BackendError, ERROR_CODES, Errors } from '../../../src/domain/errors';
import { PermitVariant } from '../../../src/domain/permits';
import { BebopAggregator } from '../../../src/swap/aggregators/bebop';
import type { Aggregator, QuoteResponse } from '../../../src/swap/aggregators/types';
import { sizeDirectDestinationExactOut } from '../../../src/swap/algorithms/direct-destination-size';
import { EADDRESS } from '../../../src/swap/constants';
import { DIRECT_DST_QUOTE_TTL_MS } from '../../../src/swap/constants';
import { executeDirectDestinationExactOut } from '../../../src/swap/execution/direct-destination';
import { dispatchSourceChainBatch } from '../../../src/swap/execution/source-swaps';
import { predictSafeAccountAddress } from '../../../src/swap/safe/predict';
import type {
  ExecutionContext,
  PreparedSwapExecution,
  SwapMetadata,
  SwapRoute,
} from '../../../src/swap/types';
import { SwapMode } from '../../../src/swap/types';
import { buildTransferAuthorization } from '../../../src/swap/wallet/transfer-authorization';
import { quoteFixture } from '../../helpers/quote';

vi.mock('../../../src/swap/execution/source-swaps', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/swap/execution/source-swaps')
  >('../../../src/swap/execution/source-swaps');
  return { ...actual, dispatchSourceChainBatch: vi.fn() };
});

vi.mock('../../../src/swap/wallet/transfer-authorization', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/swap/wallet/transfer-authorization')
  >('../../../src/swap/wallet/transfer-authorization');
  return { ...actual, buildTransferAuthorization: vi.fn() };
});

vi.mock('../../../src/swap/algorithms/direct-destination-size', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/swap/algorithms/direct-destination-size')
  >('../../../src/swap/algorithms/direct-destination-size');
  return { ...actual, sizeDirectDestinationExactOut: vi.fn() };
});

const CHAIN_ID = 8453;
const USDC = '0x0000000000000000000000000000000000000011' as Hex;
const DAI = '0x0000000000000000000000000000000000000066' as Hex;
const WETH = '0x0000000000000000000000000000000000000022' as Hex;
const EOA = '0x0000000000000000000000000000000000000033' as Hex;
const EXECUTOR = '0x0000000000000000000000000000000000000044' as Hex;
const ROUTER = '0x0000000000000000000000000000000000000055' as Hex;
const TX_HASH = '0x1234' as Hex;

const makeSwap = (
  inputAmountRaw: bigint,
  outputToken: Hex,
  outputAmountRaw: bigint,
  outputRole: 'token' | 'gas'
): QuoteResponse => ({
  chainID: CHAIN_ID,
  holding: {
    chainID: CHAIN_ID,
    tokenAddress: USDC,
    amountRaw: inputAmountRaw,
    decimals: 6,
    symbol: 'USDC',
  },
  aggregator: {} as Aggregator,
  outputRole,
  quote: quoteFixture({
    input: {
      contractAddress: USDC,
      amount: new Decimal(inputAmountRaw.toString()).div(1_000_000).toFixed(),
      amountRaw: inputAmountRaw,
      decimals: 6,
      value: Number(inputAmountRaw) / 1_000_000,
      symbol: 'USDC',
    },
    output: {
      contractAddress: outputToken,
      amount: new Decimal(outputAmountRaw.toString()).div(10n ** 18n).toFixed(),
      amountRaw: outputAmountRaw,
      decimals: 18,
      value: 0,
      symbol: outputRole === 'token' ? 'WETH' : 'ETH',
    },
    txData: {
      approvalAddress: ROUTER,
      tx: { to: ROUTER, data: outputRole === 'token' ? '0xaaaa' : '0xbbbb', value: '0x0' },
    },
  }),
});

const makeRoute = (swaps: QuoteResponse[]): SwapRoute => ({
  type: SwapMode.EXACT_OUT,
  settlementCurrencyId: 1,
  sameTokenBridge: false,
  directDestination: true,
  source: {
    swaps,
    creationTime: Date.now(),
    srcBuffer: null,
    reclaimFromActualBalance: false,
  },
  bridge: null,
  destination: {
    chainId: CHAIN_ID,
    eoaToEphemeral: null,
    inputAmount: { min: new Decimal(0), max: new Decimal(0) },
    swap: { tokenSwap: null, gasSwap: null },
    getDstSwap: vi.fn().mockResolvedValue(null),
  },
  buffer: { amount: '0' },
  dstTokenInfo: { contractAddress: WETH, decimals: 18, symbol: 'WETH' },
  extras: {
    aggregators: [],
    oraclePrices: [
      {
        universe: 'EVM',
        chainId: CHAIN_ID,
        priceUsd: new Decimal(1),
        tokenAddress: USDC,
        tokenSymbol: 'USDC',
        tokenDecimals: 6,
        timestamp: 0,
      },
    ],
    balances: [],
    assetsUsed: [],
    directDestination: {
      dstHoldings: [
        {
          chainID: CHAIN_ID,
          tokenAddress: USDC,
          amountRaw: 1_000_000_000n,
          decimals: 6,
          symbol: 'USDC',
          value: 1000,
        },
      ],
      toAmountRaw: 200_000_000_000_000_000n,
      toNativeAmountRaw: 10_000_000_000_000_000n,
    },
  },
  sourceExecutionPaths: new Map([[CHAIN_ID, 'ephemeral']]),
});

const makePreparedExecution = (swaps: QuoteResponse[]): PreparedSwapExecution => ({
  parsedQuotes: swaps.map((swap, index) => ({
    chainId: CHAIN_ID,
    quote: swap.quote,
    approval: { to: USDC, data: index === 0 ? '0x1111' : '0x2222', value: 0n },
    swap: { to: ROUTER, data: swap.quote.txData.tx.data, value: 0n },
  })),
  eoaToEphemeralTransfers: [],
});

const makeContext = (preparedExecution: PreparedSwapExecution, allowance = 0n) =>
  ({
    chainList: {
      getChainByID: vi.fn().mockReturnValue({ id: CHAIN_ID, name: 'Base', supports7702: true }),
    },
    publicClientList: {
      get: vi.fn().mockReturnValue({
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
        readContract: vi.fn(),
      }),
    },
    middlewareClient: {},
    eoaWallet: {
      getChainId: vi.fn().mockResolvedValue(CHAIN_ID),
      writeContract: vi.fn().mockResolvedValue('0xapproval'),
    },
    eoaAddress: EOA,
    ephemeralWallet: { address: EXECUTOR } as PrivateKeyAccount,
    intentExplorerUrl: '',
    sourceExecutionPaths: new Map([[CHAIN_ID, 'ephemeral']]),
    destinationDirectEoa: true,
    cache: {
      getAllowance: vi.fn().mockReturnValue(allowance),
      getPermit: vi.fn(),
      hasAuthCodeSet: vi.fn().mockReturnValue(false),
    },
    preparedExecution,
    onProgress: vi.fn(),
    slippage: 0.005,
    destinationChainId: CHAIN_ID,
  }) as unknown as ExecutionContext & { destinationChainId: number };

const makeMetadata = (): SwapMetadata => ({
  src: [],
  dst: null,
  has_xcs: false,
  intent_request_hash: null,
});

const mockRevertThenSuccess = (requoted: QuoteResponse[]) => {
  const revertedHash = '0xdead' as Hex;
  vi.mocked(sizeDirectDestinationExactOut).mockResolvedValueOnce(requoted);
  vi.mocked(dispatchSourceChainBatch)
    .mockResolvedValueOnce({
      chainId: CHAIN_ID,
      walletPath: 'ephemeral',
      submittedTxHash: revertedHash,
      waitForReceipt: vi.fn().mockRejectedValue(Errors.transactionReverted(revertedHash)),
    })
    .mockResolvedValueOnce({
      chainId: CHAIN_ID,
      walletPath: 'ephemeral',
      submittedTxHash: TX_HASH,
      waitForReceipt: vi.fn().mockResolvedValue(TX_HASH),
    });
};

describe('executeDirectDestinationExactOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildTransferAuthorization).mockResolvedValue({
      kind: 'permit',
      call: { to: USDC, data: '0x9999', value: 0n },
      permit: { signature: '0x1234', permitVariant: 1, permitContractVersion: 2 },
    });
    vi.mocked(dispatchSourceChainBatch).mockResolvedValue({
      chainId: CHAIN_ID,
      walletPath: 'ephemeral',
      submittedTxHash: TX_HASH,
      waitForReceipt: vi.fn().mockResolvedValue(TX_HASH),
    });
  });

  it('logs the quote timestamps used for the initial freshness decision', async () => {
    const currentTimeMs = 1_750_000_000_000;
    const quoteCreationTimeMs = currentTimeMs - 1_234;
    vi.spyOn(Date, 'now').mockReturnValue(currentTimeMs);
    const debugSpy = vi.spyOn(getLogger(), 'debug').mockImplementation(() => {});
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const route = makeRoute([swap]);
    route.source.creationTime = quoteCreationTimeMs;

    await executeDirectDestinationExactOut(route, makeContext(makePreparedExecution([swap])), makeMetadata());

    expect(debugSpy).toHaveBeenCalledWith('swap.execute.source.quote_freshness.decision', {
      chainId: CHAIN_ID,
      routePath: 'direct_destination',
      quoteCreationTimeMs,
      currentTimeMs,
      quoteAgeMs: 1_234,
      quoteTtlMs: DIRECT_DST_QUOTE_TTL_MS,
      forceRequote: false,
    });
  });

  it('groups same-token funding once and records the confirmed source batch', async () => {
    const swaps = [
      makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token'),
      makeSwap(25_000_000n, EADDRESS, 10_000_000_000_000_000n, 'gas'),
    ];
    const route = makeRoute(swaps);
    const ctx = makeContext(makePreparedExecution(swaps));
    const metadata = makeMetadata();

    await executeDirectDestinationExactOut(route, ctx, metadata);

    expect(buildTransferAuthorization).toHaveBeenCalledTimes(1);
    expect(buildTransferAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 525_000_000n, ephemeralAddress: EXECUTOR })
    );
    const calls = vi.mocked(dispatchSourceChainBatch).mock.calls[0][0].calls;
    expect(calls.map((call) => call.data)).toEqual([
      '0x9999',
      expect.any(String),
      '0x1111',
      '0xaaaa',
      '0x2222',
      '0xbbbb',
    ]);
    const transfer = decodeFunctionData({ abi: erc20Abi, data: calls[1].data });
    expect(transfer.functionName).toBe('transferFrom');
    expect(transfer.args).toEqual([EOA, EXECUTOR, 525_000_000n]);
    expect(metadata.src).toEqual([
      expect.objectContaining({ chid: CHAIN_ID, tx_hash: TX_HASH, swaps: expect.any(Array) }),
    ]);
    expect(metadata.src[0].swaps).toHaveLength(2);
  });

  it('reuses an exact permit after a confirmed revert and requotes before retrying', async () => {
    const swaps = [
      makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token'),
      makeSwap(25_000_000n, EADDRESS, 10_000_000_000_000_000n, 'gas'),
    ];
    const route = makeRoute(swaps);
    const ctx = makeContext(makePreparedExecution(swaps));
    const metadata = makeMetadata();
    mockRevertThenSuccess(swaps);

    await executeDirectDestinationExactOut(route, ctx, metadata);

    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(2);
    expect(sizeDirectDestinationExactOut).toHaveBeenCalledTimes(1);
    expect(buildTransferAuthorization).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dispatchSourceChainBatch).mock.calls[1][0].calls[0].data).toBe('0x9999');
  });

  it.each([PermitVariant.EIP2612Canonical, PermitVariant.PolygonEMT])(
    'builds fresh exact-capacity authorization %s when a requote grows funding',
    async (permitVariant) => {
      const initial = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
      const grown = makeSwap(600_000_000n, WETH, 200_000_000_000_000_000n, 'token');
      const route = makeRoute([initial]);
      const ctx = makeContext(makePreparedExecution([initial]));
      vi.mocked(buildTransferAuthorization).mockResolvedValue({
        kind: 'permit',
        call: { to: USDC, data: '0x9999', value: 0n },
        permit: { signature: '0x1234', permitVariant, permitContractVersion: 2 },
      });
      mockRevertThenSuccess([grown]);

      await executeDirectDestinationExactOut(route, ctx, makeMetadata());

      expect(buildTransferAuthorization).toHaveBeenCalledTimes(2);
      expect(vi.mocked(buildTransferAuthorization).mock.calls.map(([call]) => call.amount)).toEqual([
        500_000_000n,
        600_000_000n,
      ]);
    }
  );

  it.each([PermitVariant.DAI, PermitVariant.Polygon2612])(
    'reuses unlimited allowed=true authorization %s when a requote grows funding',
    async (permitVariant) => {
      const initial = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
      const grown = makeSwap(500_800_000n, WETH, 200_000_000_000_000_000n, 'token');
      const route = makeRoute([initial]);
      const ctx = makeContext(makePreparedExecution([initial]));
      vi.mocked(buildTransferAuthorization).mockResolvedValue({
        kind: 'permit',
        call: { to: USDC, data: '0x9999', value: 0n },
        permit: { signature: '0x1234', permitVariant, permitContractVersion: 2 },
      });
      mockRevertThenSuccess([grown]);

      await executeDirectDestinationExactOut(route, ctx, makeMetadata());

      expect(buildTransferAuthorization).toHaveBeenCalledTimes(1);
      const retryCalls = vi.mocked(dispatchSourceChainBatch).mock.calls[1][0].calls;
      expect(retryCalls[0].data).toBe('0x9999');
      const retryTransfer = decodeFunctionData({ abi: erc20Abi, data: retryCalls[1].data });
      expect(retryTransfer.args?.[2]).toBe(500_800_000n);
    }
  );

  it('uses the actual pre-existing allowance as reusable capacity', async () => {
    const initial = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const grown = makeSwap(500_500_000n, WETH, 200_000_000_000_000_000n, 'token');
    const route = makeRoute([initial]);
    const ctx = makeContext(makePreparedExecution([initial]), 600_000_000n);
    vi.mocked(buildTransferAuthorization).mockResolvedValue(null);
    mockRevertThenSuccess([grown]);

    await executeDirectDestinationExactOut(route, ctx, makeMetadata());

    expect(buildTransferAuthorization).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dispatchSourceChainBatch).mock.calls[1][0].calls).toHaveLength(3);
  });

  it('does not replay a mined paid approval on retry', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const route = makeRoute([swap]);
    const ctx = makeContext(makePreparedExecution([swap]));
    vi.mocked(buildTransferAuthorization).mockResolvedValue({
      kind: 'approve',
      call: { to: USDC, data: '0x7777', value: 0n },
      permit: null,
    });
    mockRevertThenSuccess([swap]);

    await executeDirectDestinationExactOut(route, ctx, makeMetadata());

    expect(ctx.eoaWallet.writeContract).toHaveBeenCalledTimes(1);
    expect(buildTransferAuthorization).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dispatchSourceChainBatch).mock.calls[1][0].calls[0].data).not.toBe('0x7777');
  });

  it('normalizes a raw permit rejection and does not prompt again', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const ctx = makeContext(makePreparedExecution([swap]));
    vi.mocked(buildTransferAuthorization).mockRejectedValueOnce(
      new UserRejectedRequestError(new Error('permit denied'))
    );

    const error = await executeDirectDestinationExactOut(
      makeRoute([swap]),
      ctx,
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'user_action/allowance_approval_denied' });
    expect(buildTransferAuthorization).toHaveBeenCalledTimes(1);
    expect(dispatchSourceChainBatch).not.toHaveBeenCalled();
    expect(sizeDirectDestinationExactOut).not.toHaveBeenCalled();
  });

  it('normalizes a raw paid-approval rejection and does not dispatch', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const ctx = makeContext(makePreparedExecution([swap]));
    vi.mocked(buildTransferAuthorization).mockResolvedValueOnce({
      kind: 'approve',
      call: { to: USDC, data: '0x7777', value: 0n },
      permit: null,
    });
    vi.mocked(ctx.eoaWallet.writeContract).mockRejectedValueOnce(
      new UserRejectedRequestError(new Error('approval denied'))
    );

    const error = await executeDirectDestinationExactOut(
      makeRoute([swap]),
      ctx,
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'user_action/allowance_approval_denied' });
    expect(ctx.eoaWallet.writeContract).toHaveBeenCalledTimes(1);
    expect(dispatchSourceChainBatch).not.toHaveBeenCalled();
  });

  it('normalizes a raw native-send rejection and never redispatches', async () => {
    const nativeSwap = makeSwap(
      100_000_000_000_000_000n,
      WETH,
      200_000_000_000_000_000n,
      'token'
    );
    nativeSwap.holding.tokenAddress = EADDRESS;
    nativeSwap.holding.amountRaw = nativeSwap.quote.input.amountRaw;
    nativeSwap.holding.decimals = 18;
    nativeSwap.holding.symbol = 'ETH';
    nativeSwap.quote.input.contractAddress = EADDRESS;
    nativeSwap.quote.input.decimals = 18;
    nativeSwap.quote.input.symbol = 'ETH';
    const ctx = makeContext(makePreparedExecution([nativeSwap]));
    vi.mocked(dispatchSourceChainBatch).mockRejectedValueOnce(
      new UserRejectedRequestError(new Error('send denied'))
    );

    const error = await executeDirectDestinationExactOut(
      makeRoute([nativeSwap]),
      ctx,
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'user_action/tx_send_denied' });
    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(1);
    expect(sizeDirectDestinationExactOut).not.toHaveBeenCalled();
  });

  it('requotes a stale route before its first dispatch from persisted exact targets', async () => {
    const initial = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const fresh = makeSwap(510_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const route = makeRoute([initial]);
    route.source.creationTime = Date.now() - DIRECT_DST_QUOTE_TTL_MS - 1;
    vi.mocked(sizeDirectDestinationExactOut).mockResolvedValueOnce([fresh]);
    const metadata = makeMetadata();

    await executeDirectDestinationExactOut(
      route,
      makeContext(makePreparedExecution([initial])),
      metadata
    );

    expect(sizeDirectDestinationExactOut).toHaveBeenCalledWith(
      expect.objectContaining({
        holdings: route.extras.directDestination?.dstHoldings,
        tokenTargetRaw: 200_000_000_000_000_000n,
        gasTargetRaw: 10_000_000_000_000_000n,
        userAddressByChain: new Map([[CHAIN_ID, EXECUTOR]]),
        recipientAddressByChain: new Map([[CHAIN_ID, EOA]]),
      })
    );
    expect(vi.mocked(sizeDirectDestinationExactOut).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dispatchSourceChainBatch).mock.invocationCallOrder[0]
    );
    expect(metadata.src[0].swaps[0].inputAmount).toBe(510_000_000n);
  });

  it('attributes stale-route coverage shortfall as drift without dispatching', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    swap.aggregator = new BebopAggregator(vi.fn());
    const route = makeRoute([swap]);
    route.source.creationTime = Date.now() - DIRECT_DST_QUOTE_TTL_MS - 1;
    vi.mocked(sizeDirectDestinationExactOut).mockRejectedValueOnce(
      Errors.quoteFailed('direct coverage shortfall')
    );

    const error = await executeDirectDestinationExactOut(
      route,
      makeContext(makePreparedExecution([swap])),
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({
      code: 'external_service/rates_drift_exceeded',
      context: {
        service: 'bebop',
        stepType: 'source_swap',
        chainId: CHAIN_ID,
      },
    });
    expect(dispatchSourceChainBatch).not.toHaveBeenCalled();
  });

  it('does not redispatch after an ambiguous receipt error for a known hash', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const ctx = makeContext(makePreparedExecution([swap]));
    vi.mocked(dispatchSourceChainBatch).mockResolvedValueOnce({
      chainId: CHAIN_ID,
      walletPath: 'ephemeral',
      submittedTxHash: TX_HASH,
      submittedExplorerUrl: 'https://explorer.example/tx/0x1234',
      waitForReceipt: vi
        .fn()
        .mockRejectedValue(Errors.execution('Receipt RPC unavailable', { service: 'rpc' })),
    });

    const error = await executeDirectDestinationExactOut(
      makeRoute([swap]),
      ctx,
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'execution/error' });
    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(1);
    expect(sizeDirectDestinationExactOut).not.toHaveBeenCalled();
    expect(ctx.onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'failed',
        txHash: TX_HASH,
        explorerUrl: 'https://explorer.example/tx/0x1234',
      })
    );
  });

  it('categorizes a raw ambiguous receipt error without redispatching', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    vi.mocked(dispatchSourceChainBatch).mockResolvedValueOnce({
      chainId: CHAIN_ID,
      walletPath: 'ephemeral',
      submittedTxHash: TX_HASH,
      waitForReceipt: vi.fn().mockRejectedValue(new Error('RPC disconnected')),
    });

    const error = await executeDirectDestinationExactOut(
      makeRoute([swap]),
      makeContext(makePreparedExecution([swap])),
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({
      code: 'execution/error',
      context: {
        service: 'rpc',
        stepId: `source_swap:${CHAIN_ID}`,
        stepType: 'source_swap',
        chainId: CHAIN_ID,
      },
    });
    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(1);
  });

  it('stops after three definitive dispatch failures and emits one terminal failure', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const ctx = makeContext(makePreparedExecution([swap]));
    const failedBatch = (txHash: Hex) => ({
      chainId: CHAIN_ID,
      walletPath: 'ephemeral' as const,
      submittedTxHash: txHash,
      waitForReceipt: vi.fn().mockRejectedValue(Errors.transactionReverted(txHash)),
    });
    vi.mocked(dispatchSourceChainBatch)
      .mockResolvedValueOnce(failedBatch('0x01'))
      .mockResolvedValueOnce(failedBatch('0x02'))
      .mockResolvedValueOnce(failedBatch('0x03'));
    vi.mocked(sizeDirectDestinationExactOut)
      .mockResolvedValueOnce([swap])
      .mockResolvedValueOnce([swap]);

    const error = await executeDirectDestinationExactOut(
      makeRoute([swap]),
      ctx,
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'execution/tx_onchain_reverted' });
    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(3);
    expect(sizeDirectDestinationExactOut).toHaveBeenCalledTimes(2);
    expect(buildTransferAuthorization).toHaveBeenCalledTimes(1);
    const failedUpdates = vi
      .mocked(ctx.onProgress!)
      .mock.calls.map(([update]) => update)
      .filter((update) => update.state === 'failed');
    expect(failedUpdates).toHaveLength(1);
    expect(failedUpdates[0]).toMatchObject({ txHash: '0x03' });
  });

  it('does not consume another dispatch when a post-revert requote fails', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const revertedHash = '0xdead' as Hex;
    vi.mocked(dispatchSourceChainBatch).mockResolvedValueOnce({
      chainId: CHAIN_ID,
      walletPath: 'ephemeral',
      submittedTxHash: revertedHash,
      waitForReceipt: vi.fn().mockRejectedValue(Errors.transactionReverted(revertedHash)),
    });
    vi.mocked(sizeDirectDestinationExactOut).mockRejectedValueOnce(
      Errors.quoteFailed('retry no longer covers')
    );

    const error = await executeDirectDestinationExactOut(
      makeRoute([swap]),
      makeContext(makePreparedExecution([swap])),
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'external_service/rates_drift_exceeded' });
    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(1);
    expect(sizeDirectDestinationExactOut).toHaveBeenCalledTimes(1);
  });

  it('funds the predicted Safe on a non-7702 execution path', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const route = makeRoute([swap]);
    route.sourceExecutionPaths.set(CHAIN_ID, 'safe');
    const ctx = makeContext(makePreparedExecution([swap]));
    ctx.sourceExecutionPaths.set(CHAIN_ID, 'safe');
    const safe = predictSafeAccountAddress(EXECUTOR).address;

    await executeDirectDestinationExactOut(route, ctx, makeMetadata());

    expect(buildTransferAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeralAddress: safe })
    );
    const transfer = decodeFunctionData({
      abi: erc20Abi,
      data: vi.mocked(dispatchSourceChainBatch).mock.calls[0][0].calls[1].data,
    });
    expect(transfer.args?.[1]).toBe(safe);
  });

  it('skips ERC20 funding for native input and forwards its batch value', async () => {
    const inputRaw = 100_000_000_000_000_000n;
    const nativeSwap = makeSwap(inputRaw, WETH, 200_000_000_000_000_000n, 'token');
    nativeSwap.holding.tokenAddress = EADDRESS;
    nativeSwap.holding.amountRaw = inputRaw;
    nativeSwap.holding.decimals = 18;
    nativeSwap.holding.symbol = 'ETH';
    nativeSwap.quote.input.contractAddress = EADDRESS;
    nativeSwap.quote.input.decimals = 18;
    nativeSwap.quote.input.symbol = 'ETH';
    const prepared = makePreparedExecution([nativeSwap]);
    prepared.parsedQuotes[0].approval = null;
    prepared.parsedQuotes[0].swap.value = inputRaw;

    await executeDirectDestinationExactOut(
      makeRoute([nativeSwap]),
      makeContext(prepared),
      makeMetadata()
    );

    expect(buildTransferAuthorization).not.toHaveBeenCalled();
    expect(dispatchSourceChainBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeValue: inputRaw,
        calls: [expect.objectContaining({ data: '0xaaaa', value: inputRaw })],
      })
    );
  });

  it('orders native calls first while preserving sizer order in metadata', async () => {
    const erc20Swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const nativeSwap = makeSwap(
      100_000_000_000_000_000n,
      WETH,
      100_000_000_000_000_000n,
      'token'
    );
    nativeSwap.holding.tokenAddress = EADDRESS;
    nativeSwap.holding.amountRaw = nativeSwap.quote.input.amountRaw;
    nativeSwap.holding.decimals = 18;
    nativeSwap.holding.symbol = 'ETH';
    nativeSwap.quote.input.contractAddress = EADDRESS;
    nativeSwap.quote.input.decimals = 18;
    nativeSwap.quote.input.symbol = 'ETH';
    nativeSwap.quote.txData.tx.data = '0xcccc';
    const prepared = makePreparedExecution([erc20Swap, nativeSwap]);
    prepared.parsedQuotes[1].approval = null;
    prepared.parsedQuotes[1].swap.data = '0xcccc';
    const metadata = makeMetadata();

    await executeDirectDestinationExactOut(
      makeRoute([erc20Swap, nativeSwap]),
      makeContext(prepared),
      metadata
    );

    expect(vi.mocked(dispatchSourceChainBatch).mock.calls[0][0].calls[0].data).toBe('0xcccc');
    expect(metadata.src[0].swaps.map((swap) => swap.inputContract)).toEqual([USDC, EADDRESS]);
  });

  it('allows silent input growth within the route-time cap', async () => {
    const initial = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const withinCap = makeSwap(500_800_000n, WETH, 200_000_000_000_000_000n, 'token');
    const route = makeRoute([initial]);
    route.source.creationTime = Date.now() - DIRECT_DST_QUOTE_TTL_MS - 1;
    vi.mocked(sizeDirectDestinationExactOut).mockResolvedValueOnce([withinCap]);
    vi.mocked(buildTransferAuthorization).mockResolvedValue(null);

    await executeDirectDestinationExactOut(
      route,
      makeContext(makePreparedExecution([initial]), 1_000_000_000n),
      makeMetadata()
    );

    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects silent input growth beyond the route-time cap before dispatch', async () => {
    const initial = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const beyondCap = makeSwap(501_100_000n, WETH, 200_000_000_000_000_000n, 'token');
    const route = makeRoute([initial]);
    route.source.creationTime = Date.now() - DIRECT_DST_QUOTE_TTL_MS - 1;
    vi.mocked(sizeDirectDestinationExactOut).mockResolvedValueOnce([beyondCap]);
    vi.mocked(buildTransferAuthorization).mockResolvedValue(null);

    const error = await executeDirectDestinationExactOut(
      route,
      makeContext(makePreparedExecution([initial]), 1_000_000_000n),
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'external_service/rates_drift_exceeded' });
    expect(dispatchSourceChainBatch).not.toHaveBeenCalled();
  });

  it('compares every silent retry to the route-time baseline without ratcheting', async () => {
    const initial = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const firstRetry = makeSwap(500_800_000n, WETH, 200_000_000_000_000_000n, 'token');
    const ratcheted = makeSwap(501_500_000n, WETH, 200_000_000_000_000_000n, 'token');
    const route = makeRoute([initial]);
    const ctx = makeContext(makePreparedExecution([initial]), 1_000_000_000n);
    vi.mocked(buildTransferAuthorization).mockResolvedValue(null);
    vi.mocked(sizeDirectDestinationExactOut)
      .mockResolvedValueOnce([firstRetry])
      .mockResolvedValueOnce([ratcheted]);
    vi.mocked(dispatchSourceChainBatch)
      .mockResolvedValueOnce({
        chainId: CHAIN_ID,
        walletPath: 'ephemeral',
        submittedTxHash: '0x01',
        waitForReceipt: vi.fn().mockRejectedValue(Errors.transactionReverted('0x01')),
      })
      .mockResolvedValueOnce({
        chainId: CHAIN_ID,
        walletPath: 'ephemeral',
        submittedTxHash: '0x02',
        waitForReceipt: vi.fn().mockRejectedValue(Errors.transactionReverted('0x02')),
      });

    const error = await executeDirectDestinationExactOut(route, ctx, makeMetadata()).catch(
      (caught) => caught
    );

    expect(error).toMatchObject({ code: 'external_service/rates_drift_exceeded' });
    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(2);
  });

  it('uses zero as the baseline for a newly selected silent token', async () => {
    const initial = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    const newlySelected = makeSwap(
      1_000_000_000_000_000_000n,
      WETH,
      200_000_000_000_000_000n,
      'token'
    );
    newlySelected.holding.tokenAddress = DAI;
    newlySelected.holding.amountRaw = newlySelected.quote.input.amountRaw;
    newlySelected.holding.decimals = 18;
    newlySelected.holding.symbol = 'DAI';
    newlySelected.quote.input.contractAddress = DAI;
    newlySelected.quote.input.decimals = 18;
    newlySelected.quote.input.symbol = 'DAI';
    const route = makeRoute([initial]);
    route.source.creationTime = Date.now() - DIRECT_DST_QUOTE_TTL_MS - 1;
    route.extras.directDestination?.dstHoldings.push({
      chainID: CHAIN_ID,
      tokenAddress: DAI,
      amountRaw: 100n * 10n ** 18n,
      decimals: 18,
      symbol: 'DAI',
      value: 100,
    });
    vi.mocked(sizeDirectDestinationExactOut).mockResolvedValueOnce([newlySelected]);
    vi.mocked(buildTransferAuthorization).mockResolvedValue(null);

    const error = await executeDirectDestinationExactOut(
      route,
      makeContext(makePreparedExecution([initial]), 100n * 10n ** 18n),
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'external_service/rates_drift_exceeded' });
    expect(dispatchSourceChainBatch).not.toHaveBeenCalled();
  });

  it('uses a $1 oracle fallback for silent-growth input units', async () => {
    const initial = makeSwap(
      100n * 10n ** 18n,
      WETH,
      200_000_000_000_000_000n,
      'token'
    );
    const grown = makeSwap(
      101_500_000_000_000_000_000n,
      WETH,
      200_000_000_000_000_000n,
      'token'
    );
    for (const swap of [initial, grown]) {
      swap.holding.tokenAddress = DAI;
      swap.holding.amountRaw = swap.quote.input.amountRaw;
      swap.holding.decimals = 18;
      swap.holding.symbol = 'DAI';
      swap.quote.input.contractAddress = DAI;
      swap.quote.input.decimals = 18;
      swap.quote.input.symbol = 'DAI';
    }
    const route = makeRoute([initial]);
    route.source.creationTime = Date.now() - DIRECT_DST_QUOTE_TTL_MS - 1;
    vi.mocked(sizeDirectDestinationExactOut).mockResolvedValueOnce([grown]);
    vi.mocked(buildTransferAuthorization).mockResolvedValue(null);

    const error = await executeDirectDestinationExactOut(
      route,
      makeContext(makePreparedExecution([initial]), 200n * 10n ** 18n),
      makeMetadata()
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'external_service/rates_drift_exceeded' });
    expect(dispatchSourceChainBatch).not.toHaveBeenCalled();
  });

  it('requotes and retries an explicit middleware no-broadcast failure', async () => {
    const swap = makeSwap(500_000_000n, WETH, 200_000_000_000_000_000n, 'token');
    vi.mocked(sizeDirectDestinationExactOut).mockResolvedValueOnce([swap]);
    vi.mocked(dispatchSourceChainBatch)
      .mockRejectedValueOnce(
        new BackendError(
          ERROR_CODES.BACKEND_SBC_SUBMIT_FAILED,
          'middleware rejected the unbroadcast batch',
          { context: { service: 'middleware', chainId: CHAIN_ID } }
        )
      )
      .mockResolvedValueOnce({
        chainId: CHAIN_ID,
        walletPath: 'ephemeral',
        submittedTxHash: TX_HASH,
        waitForReceipt: vi.fn().mockResolvedValue(TX_HASH),
      });

    await executeDirectDestinationExactOut(
      makeRoute([swap]),
      makeContext(makePreparedExecution([swap])),
      makeMetadata()
    );

    expect(sizeDirectDestinationExactOut).toHaveBeenCalledTimes(1);
    expect(dispatchSourceChainBatch).toHaveBeenCalledTimes(2);
  });
});
