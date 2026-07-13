import { describe, expect, it, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Hex,
  type PrivateKeyAccount,
  type WalletClient,
} from 'viem';
import { ERC20PermitABI } from '../../../src/abi/erc20';

vi.mock('../../../src/services/sbc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/sbc')>(
    '../../../src/services/sbc'
  );
  return {
    ...actual,
    createSBCTxFromCalls: vi.fn(),
    requireSuccessfulSbcResult: vi.fn((results, chainId) => {
      const result = results.find((entry: { chainId: number }) => entry.chainId === chainId) as
        | { errored: false; txHash: Hex }
        | { errored: true; message: string }
        | undefined;
      if (!result || result.errored) {
        throw new Error(result?.message ?? 'SBC submission failed');
      }
      return result.txHash;
    }),
  };
});

vi.mock('../../../src/swap/wallet/eoa-executor', () => ({
  dispatchViaEoa: vi.fn(),
  waitForDispatchedEoaCalls: vi.fn(),
}));

vi.mock('../../../src/swap/sweep', () => ({
  createSweeperTxs: vi.fn().mockReturnValue([
    {
      to: '0x5555555555555555555555555555555555555555' as Hex,
      data: '0xsweep' as Hex,
      value: 0n,
    },
  ]),
}));

vi.mock('../../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn(),
}));

vi.mock('../../../src/swap/execution/safe-dispatch', () => ({
  dispatchSafeSource: vi.fn(),
}));

import {
  dispatchSourceChainBatch,
  executeSourceSwaps,
} from '../../../src/swap/execution/source-swaps';
import { dispatchSafeSource } from '../../../src/swap/execution/safe-dispatch';
import { createSBCTxFromCalls } from '../../../src/services/sbc';
import {
  dispatchViaEoa,
  waitForDispatchedEoaCalls,
} from '../../../src/swap/wallet/eoa-executor';
import { createSweeperTxs } from '../../../src/swap/sweep';
import { signPermitForAddressAndValue } from '../../../src/services/allowance-utils';
import { makeSwapExecutionMiddlewareClient } from '../../helpers/middleware-client';
import type { QuoteResponse, Aggregator } from '../../../src/swap/aggregators/types';
import type {
  PreparedSwapExecution,
  SwapMetadata,
  BridgeAsset,
  ExecutionContext,
  WalletPath,
} from '../../../src/swap/types';
import { QuoteSeriousness, QuoteType } from '../../../src/swap/aggregators/types';
import { EADDRESS } from '../../../src/swap/constants';

const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
const ARB_CHAIN = 42161;
const SBC_ADDRESS = '0x0000000000000000000000000000000000000abc' as Hex;

const requestToData = (request: {
  data?: Hex;
  functionName?: string;
  args?: readonly unknown[];
}) =>
  request.data ??
  encodeFunctionData({
    abi: erc20Abi,
    functionName: request.functionName as 'approve',
    args: request.args as readonly [Hex, bigint],
  });

const makeSbcSuccess = (chainId: number, txHash: Hex) => ({
  chainId,
  address: SBC_ADDRESS,
  errored: false as const,
  txHash,
});

const makeSbcFailure = (chainId: number, message: string) => ({
  chainId,
  address: SBC_ADDRESS,
  errored: true as const,
  message,
});

const makeQuoteResponse = (
  chainId = ARB_CHAIN,
  overrides?: Partial<QuoteResponse>
): QuoteResponse => ({
  chainID: chainId,
  quote: {
    input: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
    output: { contractAddress: USDC_ARB, amount: '3000', amountRaw: 3000000000n, decimals: 6, value: 3000, symbol: 'USDC' },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
    },
  },
  holding: { chainID: chainId, tokenAddress: WETH, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'WETH' },
  aggregator: {} as Aggregator,
  ...overrides,
});

type SrcCtx = Pick<
  ExecutionContext,
  | 'chainList'
  | 'sourceExecutionPaths'
  | 'destinationDirectEoa'
  | 'eoaAddress'
  | 'eoaWallet'
  | 'ephemeralWallet'
  | 'publicClientList'
  | 'middlewareClient'
  | 'cache'
  | 'preparedExecution'
  | 'onProgress'
  | 'slippage'
> & { destinationChainId: number };

const makePreparedExecution = (quote: QuoteResponse): PreparedSwapExecution => ({
  parsedQuotes: [
    {
      chainId: quote.chainID,
      quote: quote.quote,
      approval: {
        to: quote.quote.input.contractAddress,
        data: '0xapprove' as Hex,
        value: 0n,
      },
      swap: {
        to: quote.quote.txData.tx.to,
        data: quote.quote.txData.tx.data,
        value: BigInt(quote.quote.txData.tx.value),
      },
    },
  ],
  eoaToEphemeralTransfers: [
    {
      reason: 'source',
      chainId: quote.chainID,
      tokenAddress: quote.quote.input.contractAddress,
      amount: quote.quote.input.amountRaw,
      targetAddress: '0xbbbb000000000000000000000000000000000002' as Hex,
      authorization: {
        kind: 'permit',
        call: {
          to: quote.quote.input.contractAddress,
          data: '0xpermit' as Hex,
          value: 0n,
        },
        permit: {
          signature: '0x1234' as Hex,
          permitVariant: 1,
          permitContractVersion: 2,
        },
      },
      transferCall: {
        to: quote.quote.input.contractAddress,
        data: '0xtransferFrom' as Hex,
        value: 0n,
      },
    },
  ],
});

const makeCtx = (
  walletPath: WalletPath = 'ephemeral',
  preparedExecution?: PreparedSwapExecution
): SrcCtx => ({
  chainList: { getChainByID: vi.fn().mockReturnValue({ id: ARB_CHAIN, name: 'Arbitrum' }) } as unknown as ExecutionContext['chainList'],
  sourceExecutionPaths: new Map([[ARB_CHAIN, walletPath]]),
  eoaAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
  ephemeralWallet: {
    address: '0xbbbb000000000000000000000000000000000002' as Hex,
    signTypedData: vi.fn().mockResolvedValue('0x' + 'aa'.repeat(65)),
    signAuthorization: vi.fn().mockResolvedValue({ r: '0x01', s: '0x02', yParity: 0, nonce: 0 }),
  } as unknown as PrivateKeyAccount,
  eoaWallet: {
    getChainId: vi.fn().mockResolvedValue(ARB_CHAIN),
    switchChain: vi.fn().mockResolvedValue(undefined),
    addChain: vi.fn().mockResolvedValue(undefined),
    sendCalls: vi.fn().mockResolvedValue({ id: '0xcallid' }),
    sendTransaction: vi.fn().mockResolvedValue('0xeoa_native_tx' as Hex),
    waitForCallsStatus: vi.fn().mockResolvedValue({ status: 'success', receipts: [{ transactionHash: '0xeoa_tx' as Hex }] }),
    writeContract: vi.fn().mockResolvedValue('0xeoa_approval' as Hex),
  } as unknown as WalletClient,
  publicClientList: {
    get: vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      multicall: vi.fn().mockResolvedValue([]),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        transactionHash: '0xtx123' as Hex,
      }),
    }),
  } as unknown as ExecutionContext['publicClientList'],
  middlewareClient: makeSwapExecutionMiddlewareClient({
    submitSBCs: vi.fn().mockResolvedValue([makeSbcSuccess(ARB_CHAIN, '0xtx123' as Hex)]),
  }),
  cache: {
    getAllowance: vi.fn().mockReturnValue(0n),
    hasAuthCodeSet: vi.fn().mockReturnValue(false),
  } as unknown as ExecutionContext['cache'],
  preparedExecution,
  onProgress: vi.fn(),
  slippage: 0.005,
  destinationDirectEoa: false,
  destinationChainId: ARB_CHAIN,
});

describe('executeSourceSwaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signPermitForAddressAndValue).mockResolvedValue(
      (`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex
    );

    vi.mocked(createSBCTxFromCalls).mockResolvedValue({
      chainId: 1,
      address: '0x0000000000000000000000000000000000000001' as Hex,
      calls: [],
      deadline: '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
      keyHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      nonce: '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
      revertOnFailure: true,
      signature: '0x1234' as Hex,
    });

    vi.mocked(dispatchViaEoa).mockResolvedValue({
      id: '0xcallid',
      chainId: ARB_CHAIN,
      address: '0xaaaa000000000000000000000000000000000001' as Hex,
    });
    vi.mocked(waitForDispatchedEoaCalls).mockResolvedValue('0xeoa_tx' as Hex);
  });

  it('dispatches one ephemeral batch without owning chain-swap bookkeeping', async () => {
    const ctx = makeCtx('ephemeral');

    const dispatched = await dispatchSourceChainBatch({
      chainId: ARB_CHAIN,
      calls: [{ to: WETH, data: '0xswap', value: 0n }],
      nativeValue: 0n,
      ctx,
    });

    expect(ctx.middlewareClient.submitSBCs).toHaveBeenCalledTimes(1);
    expect(dispatched).not.toHaveProperty('chainSwaps');
    expect(dispatched.submittedTxHash).toBe('0xtx123');
    await expect(dispatched.waitForReceipt()).resolves.toBe('0xtx123');
    expect(vi.mocked(ctx.onProgress!).mock.calls.map(([update]) => update.state)).toEqual([
      'started',
      'submitted',
    ]);
  });

  it('ephemeral path → creates SBC and submits via middleware', async () => {
    const ctx = makeCtx('ephemeral');
    const source = { swaps: [makeQuoteResponse()], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const assets = await executeSourceSwaps(source, ctx, metadata);

    expect(createSBCTxFromCalls).toHaveBeenCalled();
    expect(ctx.middlewareClient.submitSBCs).toHaveBeenCalled();
    expect(assets.length).toBeGreaterThan(0);
    expect(metadata.src.length).toBe(1);
  });

  it('metadata populated with chain and txHash', async () => {
    const ctx = makeCtx('ephemeral');
    const source = { swaps: [makeQuoteResponse()], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(source, ctx, metadata);

    expect(metadata.src[0].chid).toBe(ARB_CHAIN);
    expect(metadata.src[0].tx_hash).toBeDefined();
  });

  it('uses route-resolved COT metadata for returned bridge assets', async () => {
    const ctx = makeCtx('ephemeral');
    const source = {
      swaps: [makeQuoteResponse()],
      creationTime: Date.now(),
      srcBuffer: new Decimal(0),
      cotByChain: new Map([
        [
          ARB_CHAIN,
          {
            contractAddress: '0x9999999999999999999999999999999999999999' as Hex,
            decimals: 8,
            currencyId: 42,
          },
        ],
      ]),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const assets = await executeSourceSwaps(source, ctx, metadata);

    expect(assets).toEqual([
      expect.objectContaining({
        chainID: ARB_CHAIN,
        contractAddress: '0x9999999999999999999999999999999999999999',
        decimals: 8,
        ephemeralBalance: new Decimal('3000'),
      }),
    ]);
  });

  it('returns bridge asset balances as human-readable Decimal amounts', async () => {
    const ctx = makeCtx('ephemeral');
    const source = { swaps: [makeQuoteResponse()], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const assets = await executeSourceSwaps(source, ctx, metadata);

    expect(assets).toEqual([
      expect.objectContaining({
        chainID: ARB_CHAIN,
        eoaBalance: new Decimal(0),
        ephemeralBalance: new Decimal('3000'),
      }),
    ]);
  });

  // EXACT_IN reclaim (Seam 1): bridge the COT that actually landed at the wrapper (captures source
  // positive slippage above the quote's `minReceived` floor) instead of the conservative quote output.
  const withBalanceReadClient = (ctx: SrcCtx, balanceRaw: bigint) => {
    const readContract = vi.fn().mockResolvedValue(balanceRaw);
    (ctx.publicClientList.get as unknown) = vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      multicall: vi.fn().mockResolvedValue([]),
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ status: 'success', transactionHash: '0xtx123' as Hex }),
      readContract,
    });
    return readContract;
  };

  it('EXACT_IN reclaim: bridges the actual wrapper COT balance, not the quote floor', async () => {
    const ctx = makeCtx('ephemeral');
    const readContract = withBalanceReadClient(ctx, 3015000000n); // 3015 USDC at wrapper (floor 3000)
    const source = {
      swaps: [makeQuoteResponse()],
      creationTime: Date.now(),
      srcBuffer: new Decimal(0),
      reclaimFromActualBalance: true,
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const assets = await executeSourceSwaps(source, ctx, metadata);

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: USDC_ARB,
        functionName: 'balanceOf',
        args: ['0xbbbb000000000000000000000000000000000002'], // ephemeral wrapper
      })
    );
    expect(assets[0].ephemeralBalance).toEqual(new Decimal('3015'));
  });

  it('EXACT_IN reclaim: uses the quote output when the flag is unset (no balance read)', async () => {
    const ctx = makeCtx('ephemeral');
    const readContract = withBalanceReadClient(ctx, 3015000000n);
    const source = { swaps: [makeQuoteResponse()], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const assets = await executeSourceSwaps(source, ctx, metadata);

    expect(readContract).not.toHaveBeenCalled();
    expect(assets[0].ephemeralBalance).toEqual(new Decimal('3000')); // quote floor
  });

  it('EXACT_IN reclaim: reads the COT balance at the predicted Safe on non-7702 chains', async () => {
    const SAFE = '0x2d7E4C3ef02B86D271624742C6e81636f4c9e663' as Hex; // predictSafe(0xbbbb...0002)
    vi.mocked(dispatchSafeSource).mockResolvedValue({ txHash: '0xsafe_src' as Hex, safeAddress: SAFE });
    const readContract = vi.fn().mockResolvedValue(3010000000n);
    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      sourceExecutionPaths: new Map([[ARB_CHAIN, 'safe']]),
      chainList: {
        getChainByID: vi
          .fn()
          .mockReturnValue({ id: ARB_CHAIN, name: 'HyperEVM', supports7702: false }),
      } as unknown as ExecutionContext['chainList'],
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          multicall: vi.fn().mockResolvedValue([]),
          waitForTransactionReceipt: vi
            .fn()
            .mockResolvedValue({ status: 'success', transactionHash: '0xsafe_src' as Hex }),
          readContract,
        }),
      } as unknown as ExecutionContext['publicClientList'],
    };
    const source = {
      swaps: [makeQuoteResponse()],
      creationTime: Date.now(),
      srcBuffer: new Decimal(0),
      reclaimFromActualBalance: true,
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const assets = await executeSourceSwaps(source, ctx, metadata);

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: USDC_ARB, functionName: 'balanceOf', args: [SAFE] })
    );
    expect(assets[0].ephemeralBalance).toEqual(new Decimal('3010'));
  });

  it('emits typed source_swap progress per chain', async () => {
    const ctx = makeCtx('ephemeral');
    const source = { swaps: [makeQuoteResponse()], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(source, ctx, metadata);

    const progress = vi.mocked(ctx.onProgress!).mock.calls.map(([update]) => update);

    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepType: 'source_swap',
          state: 'started',
          chainId: ARB_CHAIN,
        }),
        expect.objectContaining({
          stepType: 'source_swap',
          state: 'submitted',
          chainId: ARB_CHAIN,
          txHash: '0xtx123',
        }),
        expect.objectContaining({
          stepType: 'source_swap',
          state: 'confirmed',
          chainId: ARB_CHAIN,
          txHash: '0xtx123',
        }),
      ])
    );
  });

  it('empty swaps → returns empty assets', async () => {
    const ctx = makeCtx('ephemeral');
    const source = { swaps: [], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const assets = await executeSourceSwaps(source, ctx, metadata);

    expect(assets).toHaveLength(0);
  });

  it('ephemeral path throws when middleware reports SBC submission failure', async () => {
    const ctx = makeCtx('ephemeral');
    ctx.middlewareClient.submitSBCs = vi
      .fn()
      .mockResolvedValue([makeSbcFailure(ARB_CHAIN, 'submission failed')]) as any;

    const quote = makeQuoteResponse();
    quote.aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([quote.quote]),
    } as unknown as Aggregator;

    const source = { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await expect(executeSourceSwaps(source, ctx, metadata)).rejects.toThrow(
      /submission failed|SBC submission/i
    );
  });

  it('safe path injects the EOA->Safe funding transfer into the batch before the router approval and swap', async () => {
    // Parity with v1: on a non-7702 (Safe) source chain the swap runs as the Safe, so the input
    // ERC20 must be moved EOA -> Safe inside the same batch (permit/approve spender = Safe), then
    // the Safe approves the aggregator router and swaps. Without the transferFrom the Safe holds
    // zero of the input and the aggregator call reverts (GS013). Native inputs are unaffected
    // because their value rides in via execTransaction.
    const SAFE = '0x2d7E4C3ef02B86D271624742C6e81636f4c9e663' as Hex; // predictSafe(0xbbbb...0002)
    vi.mocked(dispatchSafeSource).mockResolvedValue({ txHash: '0xsafe_src' as Hex, safeAddress: SAFE });

    const quote = makeQuoteResponse();
    const prepared = makePreparedExecution(quote);
    prepared.eoaToEphemeralTransfers[0] = {
      ...prepared.eoaToEphemeralTransfers[0],
      targetAddress: SAFE,
    };

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral', prepared),
      sourceExecutionPaths: new Map([[ARB_CHAIN, 'safe']]),
      chainList: {
        getChainByID: vi
          .fn()
          .mockReturnValue({ id: ARB_CHAIN, name: 'HyperEVM', supports7702: false }),
      } as unknown as ExecutionContext['chainList'],
    };
    const source = { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(source, ctx, metadata);

    expect(dispatchSafeSource).toHaveBeenCalledTimes(1);
    const calls = vi.mocked(dispatchSafeSource).mock.calls[0][0].calls;
    expect(calls).toEqual([
      { to: WETH, data: '0xpermit', value: 0n },
      { to: WETH, data: '0xtransferFrom', value: 0n },
      { to: WETH, data: '0xapprove', value: 0n },
      {
        to: quote.quote.txData.tx.to,
        data: quote.quote.txData.tx.data,
        value: BigInt(quote.quote.txData.tx.value),
      },
    ]);
  });

  it('ephemeral path prepends prepared permit, transferFrom, and approval before swap', async () => {
    const quote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        input: {
          ...makeQuoteResponse().quote.input,
          contractAddress: USDC_ARB,
          amount: '3000',
          amountRaw: 3000000000n,
          decimals: 6,
          symbol: 'USDC',
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
    });
    const ctx = makeCtx('ephemeral', makePreparedExecution(quote));
    const source = { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(source, ctx, metadata);

    const sbcInput = vi.mocked(createSBCTxFromCalls).mock.calls[0][0];
    expect(sbcInput.calls).toEqual([
      { to: USDC_ARB, data: '0xpermit', value: 0n },
      { to: USDC_ARB, data: '0xtransferFrom', value: 0n },
      { to: USDC_ARB, data: '0xapprove', value: 0n },
      {
        to: quote.quote.txData.tx.to,
        data: quote.quote.txData.tx.data,
        value: BigInt(quote.quote.txData.tx.value),
      },
    ]);
  });

  it('materializes a lazy source permit into the SBC before transferFrom and swap execution', async () => {
    const quote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        input: {
          ...makeQuoteResponse().quote.input,
          contractAddress: USDC_ARB,
          amount: '3000',
          amountRaw: 3000000000n,
          decimals: 6,
          symbol: 'USDC',
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
    });
    const preparedExecution = makePreparedExecution(quote);
    preparedExecution.eoaToEphemeralTransfers[0] = {
      ...preparedExecution.eoaToEphemeralTransfers[0],
      authorization: {
        kind: 'permit',
        call: null,
        permit: {
          signature: null,
          permitVariant: 1,
          permitContractVersion: 2,
        },
      },
    };

    const ctx = makeCtx('ephemeral', preparedExecution);
    const source = { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(source, ctx, metadata);

    expect(signPermitForAddressAndValue).toHaveBeenCalledTimes(1);

    const sbcInput = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0];
    const tokenCalls = sbcInput.calls
      .filter((call) => call.to.toLowerCase() === USDC_ARB.toLowerCase())
      .map((call) => call.data);

    expect(tokenCalls).toHaveLength(3);
    const permitCall = decodeFunctionData({
      abi: ERC20PermitABI,
      data: tokenCalls[0],
    });
    expect(permitCall.functionName).toBe('permit');
    expect((permitCall.args?.[0] as Hex).toLowerCase()).toBe(ctx.eoaAddress.toLowerCase());
    expect((permitCall.args?.[1] as Hex).toLowerCase()).toBe(
      ctx.ephemeralWallet.address.toLowerCase()
    );
    expect(permitCall.args?.[2]).toBe(3000000000n);
    expect(permitCall.args?.[4]).toBe(27);
    expect(permitCall.args?.[5]).toBe(
      `0x${'0'.repeat(63)}1` as Hex
    );
    expect(permitCall.args?.[6]).toBe(
      `0x${'0'.repeat(63)}2` as Hex
    );
    expect(tokenCalls[1]).toBe('0xtransferFrom');
    expect(tokenCalls[2]).toBe('0xapprove');
  });

  it('switches the EOA wallet to the funding chain before requesting a source permit', async () => {
    const fundingChainId = 137;
    const quote = makeQuoteResponse(fundingChainId, {
      quote: {
        ...makeQuoteResponse(fundingChainId).quote,
        input: {
          ...makeQuoteResponse(fundingChainId).quote.input,
          contractAddress: USDC_ARB,
          amount: '3000',
          amountRaw: 3000000000n,
          decimals: 6,
          symbol: 'USDC',
        },
      },
      holding: { chainID: fundingChainId, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
    });
    const preparedExecution = makePreparedExecution(quote);
    preparedExecution.eoaToEphemeralTransfers[0] = {
      ...preparedExecution.eoaToEphemeralTransfers[0],
      chainId: fundingChainId,
      authorization: {
        kind: 'permit',
        call: null,
        permit: {
          signature: null,
          permitVariant: 1,
          permitContractVersion: 2,
        },
      },
    };

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral', preparedExecution),
      sourceExecutionPaths: new Map([[fundingChainId, 'ephemeral']]),
      chainList: {
        getChainByID: vi.fn().mockImplementation((chainId: number) => ({
          id: chainId,
          name: `Chain ${chainId}`,
        })),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValue([makeSbcSuccess(fundingChainId, '0x137' as Hex)]),
      }),
    };
    let currentChainId = ARB_CHAIN;
    vi.mocked(ctx.eoaWallet.getChainId).mockImplementation(async () => currentChainId);
    vi.mocked(ctx.eoaWallet.switchChain).mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    });
    const source = { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(source, ctx, metadata);

    expect(signPermitForAddressAndValue).toHaveBeenCalledTimes(1);
    expect(signPermitForAddressAndValue).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAddress: USDC_ARB }),
      expect.objectContaining({ id: fundingChainId }),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ address: ctx.eoaAddress }),
      ctx.ephemeralWallet.address,
      quote.quote.input.amountRaw
    );
  });

  it('keeps the EOA funding approve out of the source SBC calldata when permit support is unavailable', async () => {
    const quote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        input: {
          ...makeQuoteResponse().quote.input,
          contractAddress: USDC_ARB,
          amount: '3000',
          amountRaw: 3000000000n,
          decimals: 6,
          symbol: 'USDC',
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
    });
    const expectedFundingApprove = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: ['0xbbbb000000000000000000000000000000000002' as Hex, 3000000000n],
    });
    const expectedRouterApprove = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [quote.quote.txData.approvalAddress, 3000000000n],
    });
    const expectedTransferFrom = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transferFrom',
      args: [
        '0xaaaa000000000000000000000000000000000001' as Hex,
        '0xbbbb000000000000000000000000000000000002' as Hex,
        3000000000n,
      ],
    });
    const preparedExecution = makePreparedExecution(quote);
    preparedExecution.eoaToEphemeralTransfers[0] = {
      ...preparedExecution.eoaToEphemeralTransfers[0],
      authorization: {
        kind: 'approve',
        call: {
          to: USDC_ARB,
          data: expectedFundingApprove,
          value: 0n,
        },
        permit: null,
      },
      transferCall: {
        to: USDC_ARB,
        data: expectedTransferFrom,
        value: 0n,
      },
    };
    preparedExecution.parsedQuotes[0] = {
      ...preparedExecution.parsedQuotes[0],
      approval: {
        to: USDC_ARB,
        data: expectedRouterApprove,
        value: 0n,
      },
    };

    const ctx = makeCtx('ephemeral', preparedExecution);
    const source = { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(source, ctx, metadata);

    const approvalRequest = vi.mocked(ctx.eoaWallet.writeContract).mock.calls[0]?.[0] as
      | {
          data?: Hex;
          functionName?: string;
          args?: readonly unknown[];
        }
      | undefined;
    expect(approvalRequest).toBeDefined();
    expect(requestToData(approvalRequest!)).toBe(expectedFundingApprove);

    const sbcInput = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0];
    expect(sbcInput.calls.map((call) => call.data)).not.toContain(expectedFundingApprove);

    const tokenCallData = sbcInput.calls
      .filter((call) => call.to.toLowerCase() === USDC_ARB.toLowerCase())
      .map((call) => call.data);

    expect(tokenCallData).toEqual(
      expect.arrayContaining([expectedTransferFrom, expectedRouterApprove])
    );
  });

  it('orders native source swaps before ERC20 source swaps within a chain', async () => {
    const nativeQuote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        input: {
          ...makeQuoteResponse().quote.input,
          contractAddress: EADDRESS as Hex,
          symbol: 'ETH',
        },
        txData: {
          ...makeQuoteResponse().quote.txData,
          tx: {
            ...makeQuoteResponse().quote.txData.tx,
            to: '0x3333333333333333333333333333333333333333' as Hex,
          },
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: EADDRESS as Hex, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'ETH' },
    });
    const erc20Quote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        input: {
          ...makeQuoteResponse().quote.input,
          contractAddress: USDC_ARB,
          amount: '3000',
          amountRaw: 3000000000n,
          decimals: 6,
          symbol: 'USDC',
        },
        txData: {
          ...makeQuoteResponse().quote.txData,
          tx: {
            ...makeQuoteResponse().quote.txData.tx,
            to: '0x4444444444444444444444444444444444444444' as Hex,
          },
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
    });

    const ctx = makeCtx('ephemeral');
    const source = { swaps: [erc20Quote, nativeQuote], creationTime: Date.now(), srcBuffer: new Decimal(0) };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(source, ctx, metadata);

    const sbcInput = vi.mocked(createSBCTxFromCalls).mock.calls[0][0];
    expect(sbcInput.calls[0]?.to).toBe(nativeQuote.quote.txData.tx.to);
    expect(sbcInput.calls.at(-1)?.to).toBe(erc20Quote.quote.txData.tx.to);
  });

  it('native ephemeral path bootstraps delegation via middleware before the EOA sends the payable execute tx', async () => {
    const nativeQuote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        input: {
          ...makeQuoteResponse().quote.input,
          contractAddress: EADDRESS as Hex,
          symbol: 'ETH',
        },
        txData: {
          ...makeQuoteResponse().quote.txData,
          tx: {
            ...makeQuoteResponse().quote.txData.tx,
            to: '0x3333333333333333333333333333333333333333' as Hex,
            data: '0xfeedface' as Hex,
            value: '0x5' as Hex,
          },
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: EADDRESS as Hex, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'ETH' },
    });
    const ctx = makeCtx('ephemeral');
    const hasAuthCodeSet = vi.fn().mockReturnValue(false);
    ctx.cache = {
      ...ctx.cache,
      hasAuthCodeSet,
    } as unknown as ExecutionContext['cache'];
    let currentChainId = 1;
    vi.mocked(ctx.eoaWallet.getChainId).mockImplementation(async () => currentChainId);
    vi.mocked(ctx.eoaWallet.switchChain).mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    });
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(
      { swaps: [nativeQuote], creationTime: Date.now(), srcBuffer: new Decimal(0) },
      ctx,
      metadata
    );

    expect(hasAuthCodeSet).toHaveBeenCalledWith(ctx.ephemeralWallet.address, ARB_CHAIN);
    expect(createSBCTxFromCalls).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0]?.calls).toEqual([]);
    expect(ctx.middlewareClient.submitSBCs).toHaveBeenCalledTimes(1);
    expect(ctx.eoaWallet.switchChain).toHaveBeenCalledWith({ id: ARB_CHAIN });
    expect(vi.mocked(ctx.eoaWallet.sendTransaction)).toHaveBeenCalledTimes(1);

    const txRequest = vi.mocked(ctx.eoaWallet.sendTransaction).mock.calls[0]?.[0];
    expect(txRequest).toEqual(
      expect.objectContaining({
        account: ctx.eoaAddress,
        to: ctx.ephemeralWallet.address,
        value: 5n,
      })
    );
    expect(txRequest).not.toHaveProperty('authorizationList');

    const decoded = decodeFunctionData({
      abi: parseAbi([
        'function execute((((address to,uint256 value,bytes data)[] calls,bool revertOnFailure) batchedCall,uint256 nonce,bytes32 keyHash,address executor,uint256 deadline) signedBatchedCall,bytes wrappedSignature)',
      ]),
      data: txRequest?.data as Hex,
    });
    expect(decoded.functionName).toBe('execute');
    const request = decoded.args?.[0];
    expect(request.batchedCall.calls).toEqual([
      {
        to: nativeQuote.quote.txData.tx.to,
        data: nativeQuote.quote.txData.tx.data,
        value: 5n,
      },
    ]);
    expect(metadata.src[0]?.tx_hash).toBe('0xeoa_native_tx');
  });

  it('dispatches all chains before waiting for receipts', async () => {
    const chainA = 42161;
    const chainB = 10;
    const quoteA = makeQuoteResponse(chainA);
    const quoteB = makeQuoteResponse(chainB);
    const waitForReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      transactionHash: '0xtx123' as Hex,
    });
    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      sourceExecutionPaths: new Map([
        [chainA, 'ephemeral'],
        [chainB, 'ephemeral'],
      ]),
      chainList: {
        getChainByID: vi.fn().mockImplementation((chainId: number) => ({
          id: chainId,
          name: `Chain ${chainId}`,
        })),
      } as unknown as ExecutionContext['chainList'],
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          multicall: vi.fn().mockResolvedValue([]),
          waitForTransactionReceipt: waitForReceipt,
        }),
      } as unknown as ExecutionContext['publicClientList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcSuccess(chainA, '0xaaa' as Hex)])
          .mockResolvedValueOnce([makeSbcSuccess(chainB, '0xbbb' as Hex)]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps({ swaps: [quoteA, quoteB], creationTime: Date.now(), srcBuffer: new Decimal(0) }, ctx, metadata);

    const submitCalls = vi.mocked(ctx.middlewareClient.submitSBCs).mock.invocationCallOrder;
    expect(submitCalls).toHaveLength(2);
    expect(submitCalls[1]).toBeLessThan(waitForReceipt.mock.invocationCallOrder[0]);
  });

  it('serializes source funding prompts across chains before dispatching the next chain', async () => {
    const chainA = 42161;
    const chainB = 137;
    const quoteA = makeQuoteResponse(chainA, {
      quote: {
        ...makeQuoteResponse(chainA).quote,
        input: {
          ...makeQuoteResponse(chainA).quote.input,
          contractAddress: USDC_ARB,
          amount: '3000',
          amountRaw: 3000000000n,
          decimals: 6,
          symbol: 'USDC',
        },
      },
      holding: { chainID: chainA, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
    });
    const quoteB = makeQuoteResponse(chainB, {
      quote: {
        ...makeQuoteResponse(chainB).quote,
        input: {
          ...makeQuoteResponse(chainB).quote.input,
          contractAddress: USDC_ARB,
          amount: '3000',
          amountRaw: 3000000000n,
          decimals: 6,
          symbol: 'USDC',
        },
      },
      holding: { chainID: chainB, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
    });
    let resolveFirstPermit: ((value: Hex) => void) | null = null;
    const firstPermit = new Promise<Hex>((resolve) => {
      resolveFirstPermit = resolve;
    });
    vi.mocked(signPermitForAddressAndValue)
      .mockImplementationOnce(() => firstPermit)
      .mockResolvedValue((`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex);

    const preparedExecution: PreparedSwapExecution = {
      parsedQuotes: [
        ...makePreparedExecution(quoteA).parsedQuotes,
        ...makePreparedExecution(quoteB).parsedQuotes,
      ],
      eoaToEphemeralTransfers: [
        {
          ...makePreparedExecution(quoteA).eoaToEphemeralTransfers[0],
          chainId: chainA,
          tokenAddress: USDC_ARB,
          amount: 3000000000n,
          authorization: {
            kind: 'permit',
            call: null,
            permit: {
              signature: null,
              permitVariant: 1,
              permitContractVersion: 2,
            },
          },
        },
        {
          ...makePreparedExecution(quoteB).eoaToEphemeralTransfers[0],
          chainId: chainB,
          tokenAddress: USDC_ARB,
          amount: 3000000000n,
          authorization: {
            kind: 'permit',
            call: null,
            permit: {
              signature: null,
              permitVariant: 1,
              permitContractVersion: 2,
            },
          },
        },
      ],
    };

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral', preparedExecution),
      sourceExecutionPaths: new Map([
        [chainA, 'ephemeral'],
        [chainB, 'ephemeral'],
      ]),
      chainList: {
        getChainByID: vi.fn().mockImplementation((chainId: number) => ({
          id: chainId,
          name: `Chain ${chainId}`,
        })),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcSuccess(chainA, '0xaaa' as Hex)])
          .mockResolvedValueOnce([makeSbcSuccess(chainB, '0xbbb' as Hex)]),
      }),
    };
    let currentChainId = chainA;
    vi.mocked(ctx.eoaWallet.getChainId).mockImplementation(async () => currentChainId);
    vi.mocked(ctx.eoaWallet.switchChain).mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    });

    const execution = executeSourceSwaps(
      { swaps: [quoteA, quoteB], creationTime: Date.now(), srcBuffer: new Decimal(0) },
      ctx,
      { src: [], dst: null, has_xcs: false, intent_request_hash: null }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(signPermitForAddressAndValue).toHaveBeenCalledTimes(1);
    expect(ctx.eoaWallet.switchChain).not.toHaveBeenCalledWith({ id: chainB });

    (resolveFirstPermit as ((value: Hex) => void) | null)?.((`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex);
    await execution;

    expect(signPermitForAddressAndValue).toHaveBeenCalledTimes(2);
  });

  it('requotes only failed chains and retries them once', async () => {
    const chainA = 42161;
    const chainB = 10;
    const quoteA = makeQuoteResponse(chainA);
    const requotedQuoteB = makeQuoteResponse(chainB, {
      quote: {
        ...makeQuoteResponse(chainB).quote,
        output: {
          ...makeQuoteResponse(chainB).quote.output,
          amount: '2990',
          amountRaw: 2990000000n,
        },
      },
    });
    const aggregatorB = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedQuoteB.quote]),
    } as unknown as Aggregator;
    const quoteB = makeQuoteResponse(chainB, { aggregator: aggregatorB });
    const waitForReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      transactionHash: '0xtx123' as Hex,
    });
    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      sourceExecutionPaths: new Map([
        [chainA, 'ephemeral'],
        [chainB, 'ephemeral'],
      ]),
      chainList: {
        getChainByID: vi.fn().mockImplementation((chainId: number) => ({
          id: chainId,
          name: `Chain ${chainId}`,
        })),
      } as unknown as ExecutionContext['chainList'],
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          multicall: vi.fn().mockResolvedValue([]),
          waitForTransactionReceipt: waitForReceipt,
        }),
      } as unknown as ExecutionContext['publicClientList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcSuccess(chainA, '0xaaa' as Hex)])
          .mockResolvedValueOnce([makeSbcFailure(chainB, 'retry me')])
          .mockResolvedValueOnce([makeSbcSuccess(chainB, '0xbbb' as Hex)]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    const assets = await executeSourceSwaps(
      { swaps: [quoteA, quoteB], creationTime: Date.now(), srcBuffer: new Decimal(20) },
      ctx,
      metadata
    );

    expect(aggregatorB.getQuotes).toHaveBeenCalledTimes(1);
    expect(aggregatorB.getQuotes).toHaveBeenCalledWith([
      {
        type: QuoteType.EXACT_IN,
        seriousness: QuoteSeriousness.SERIOUS,
        chainId: chainB,
        inputToken: quoteB.quote.input.contractAddress,
        outputToken: quoteB.quote.output.contractAddress,
        inputAmount: quoteB.holding.amountRaw,
        userAddress: ctx.ephemeralWallet.address,
        recipientAddress: ctx.ephemeralWallet.address,
      },
    ]);
    expect(vi.mocked(ctx.middlewareClient.submitSBCs)).toHaveBeenCalledTimes(3);
    expect(assets).toHaveLength(2);
  });

  it('requotes a failed source leg to the per-chain wrapper (ephemeral on 7702 chains)', async () => {
    // 7702 source: requote recipient = ephemeral wrapper. Same-chain COT destination would
    // route to EOA instead, but that case is exercised separately by the dst-tokenSwap=null
    // path.
    const requotedQuote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        output: { ...makeQuoteResponse().quote.output, amount: '2990', amountRaw: 2990000000n },
      },
    });
    const aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedQuote.quote]),
    } as unknown as Aggregator;
    const quote = makeQuoteResponse(ARB_CHAIN, { aggregator });
    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcFailure(ARB_CHAIN, 'retry me')])
          .mockResolvedValueOnce([makeSbcSuccess(ARB_CHAIN, '0xbbb' as Hex)]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeSourceSwaps(
      { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(20) },
      ctx,
      metadata
    );

    expect(aggregator.getQuotes).toHaveBeenCalledWith([
      expect.objectContaining({
        recipientAddress: ctx.ephemeralWallet.address,
        userAddress: ctx.ephemeralWallet.address,
      }),
    ]);
  });

  it('accepts a requote whose total output drop equals srcBuffer exactly', async () => {
    const quote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        output: {
          ...makeQuoteResponse().quote.output,
          amount: '0.001001',
          amountRaw: 1001n,
          decimals: 6,
        },
      },
    });
    const requotedQuote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...quote.quote,
        output: {
          ...quote.quote.output,
          amount: '0.000995',
          amountRaw: 995n,
          decimals: 6,
        },
      },
    });
    const aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedQuote.quote]),
    } as unknown as Aggregator;
    quote.aggregator = aggregator;

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcFailure(ARB_CHAIN, 'retry me')])
          .mockResolvedValueOnce([makeSbcSuccess(ARB_CHAIN, '0xbbb' as Hex)]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    // Drop is exactly 6 raw (0.000006 in decimal). srcBuffer of the same magnitude lets
    // the check pass on the boundary (newTotal >= minAcceptable).
    await expect(
      executeSourceSwaps(
        { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal('0.000006') },
        ctx,
        metadata
      )
    ).resolves.toHaveLength(1);

    expect(aggregator.getQuotes).toHaveBeenCalledTimes(1);
  });

  it('rejects a requote whose drop exceeds srcBuffer', async () => {
    const quote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        output: {
          ...makeQuoteResponse().quote.output,
          amount: '3000',
          amountRaw: 3000000000n,
          decimals: 6,
        },
      },
    });
    const requotedQuote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...quote.quote,
        output: {
          ...quote.quote.output,
          amount: '2950',
          amountRaw: 2950000000n,
          decimals: 6,
        },
      },
    });
    const aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedQuote.quote]),
    } as unknown as Aggregator;
    quote.aggregator = aggregator;

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcFailure(ARB_CHAIN, 'retry me')])
          .mockResolvedValueOnce([makeSbcSuccess(ARB_CHAIN, '0xbbb' as Hex)]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    // Drop = 50; srcBuffer = 10 → expect EXTERNAL_RATES_DRIFT_EXCEEDED on the buffer check.
    await expect(
      executeSourceSwaps(
        { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(10) },
        ctx,
        metadata
      )
    ).rejects.toThrow(/srcBuffer|drift/i);
  });

  it('srcBuffer null (EXACT_IN) requotes a drifted-down leg and proceeds with no drift guard', async () => {
    // EXACT_IN passes srcBuffer=null: a failed leg is re-quoted and the swap proceeds no matter how
    // far the re-quote drops — there is no pooled buffer check at all. (EXACT_OUT keeps the guard.)
    const quote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        output: { ...makeQuoteResponse().quote.output, amount: '3000', amountRaw: 3000000000n, decimals: 6 },
      },
    });
    const requotedQuote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...quote.quote,
        // −1000: a drop any finite buffer would reject.
        output: { ...quote.quote.output, amount: '2000', amountRaw: 2000000000n, decimals: 6 },
      },
    });
    const aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedQuote.quote]),
    } as unknown as Aggregator;
    quote.aggregator = aggregator;

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcFailure(ARB_CHAIN, 'retry me')])
          .mockResolvedValueOnce([makeSbcSuccess(ARB_CHAIN, '0xbbb' as Hex)]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await expect(
      executeSourceSwaps(
        { swaps: [quote], creationTime: Date.now(), srcBuffer: null },
        ctx,
        metadata
      )
    ).resolves.toHaveLength(1);
    expect(aggregator.getQuotes).toHaveBeenCalledTimes(1);
  });

  // Path A EXACT_OUT batches mix a toToken leg and a native gas leg on one chain. The pooled requote
  // guard is per pass (`outputRole`): the token group is checked against srcBuffer, the gas group
  // against gasSrcBuffer — a toToken over-quote can't paper over a native shortfall.
  const makeMixedLegs = (tokenOutRaw: bigint, gasOutRaw: bigint) => {
    const base = makeQuoteResponse().quote;
    const tokenLeg: QuoteResponse = {
      ...makeQuoteResponse(ARB_CHAIN, {
        quote: { ...base, output: { ...base.output, contractAddress: USDC_ARB, amount: '0', amountRaw: tokenOutRaw, decimals: 6 } },
        holding: { chainID: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'WETH' },
      }),
      outputRole: 'token',
    };
    const gasLeg: QuoteResponse = {
      ...makeQuoteResponse(ARB_CHAIN, {
        quote: {
          ...base,
          input: { ...base.input, contractAddress: USDC_ARB, decimals: 6 },
          output: { ...base.output, contractAddress: EADDRESS, amount: '0', amountRaw: gasOutRaw, decimals: 18, symbol: 'ETH' },
        },
        holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
      }),
      outputRole: 'gas',
    };
    return { tokenLeg, gasLeg };
  };
  const mixedCtx = () => ({
    ...makeCtx('ephemeral'),
    middlewareClient: makeSwapExecutionMiddlewareClient({
      submitSBCs: vi
        .fn()
        .mockResolvedValueOnce([makeSbcFailure(ARB_CHAIN, 'retry me')])
        .mockResolvedValueOnce([makeSbcSuccess(ARB_CHAIN, '0xbbb' as Hex)]),
    }),
  });
  const noMeta = (): SwapMetadata => ({ src: [], dst: null, has_xcs: false, intent_request_hash: null });

  it('per-output-token requote: accepts when each group drops within its own buffer', async () => {
    // toToken (USDC) drops 5 (< srcBuffer 10); native (ETH) drops 0.005 (< gasSrcBuffer 0.01) → both ok.
    const { tokenLeg, gasLeg } = makeMixedLegs(3000000000n, 1000000000000000000n);
    tokenLeg.aggregator = { supportsChain: () => true, getQuotes: vi.fn().mockResolvedValue([{ ...tokenLeg.quote, output: { ...tokenLeg.quote.output, amountRaw: 2995000000n } }]) } as unknown as Aggregator;
    gasLeg.aggregator = { supportsChain: () => true, getQuotes: vi.fn().mockResolvedValue([{ ...gasLeg.quote, output: { ...gasLeg.quote.output, amountRaw: 995000000000000000n } }]) } as unknown as Aggregator;

    // Resolves = the pooled guard accepted both groups (the returned assets coalesce per chain and
    // are unused on Path A, which has no bridge).
    await expect(
      executeSourceSwaps(
        { swaps: [tokenLeg, gasLeg], creationTime: Date.now(), srcBuffer: new Decimal(10), gasSrcBuffer: new Decimal('0.01') },
        mixedCtx(),
        noMeta()
      )
    ).resolves.toBeDefined();
  });

  it('per-output-token requote: an over-budget native drop throws even when the toToken group is fine', async () => {
    // toToken (USDC) drops 5 (< srcBuffer 10) but native (ETH) drops 0.1 (> gasSrcBuffer 0.01) → reject.
    const { tokenLeg, gasLeg } = makeMixedLegs(3000000000n, 1000000000000000000n);
    tokenLeg.aggregator = { supportsChain: () => true, getQuotes: vi.fn().mockResolvedValue([{ ...tokenLeg.quote, output: { ...tokenLeg.quote.output, amountRaw: 2995000000n } }]) } as unknown as Aggregator;
    gasLeg.aggregator = { supportsChain: () => true, getQuotes: vi.fn().mockResolvedValue([{ ...gasLeg.quote, output: { ...gasLeg.quote.output, amountRaw: 900000000000000000n } }]) } as unknown as Aggregator;

    await expect(
      executeSourceSwaps(
        { swaps: [tokenLeg, gasLeg], creationTime: Date.now(), srcBuffer: new Decimal(10), gasSrcBuffer: new Decimal('0.01') },
        mixedCtx(),
        noMeta()
      )
    ).rejects.toThrow(/drift/i);
  });

  it('per-pass requote: a native TOKEN leg (native toToken, no gas) is still checked against srcBuffer', async () => {
    // Regression: grouping by output-token native-ness skipped the drift check for a native toToken
    // (native output → gasSrcBuffer ?? null → null → accept). Tagging by pass keeps a 'token' leg on
    // srcBuffer even when its output is native. Drop 0.1 ETH > srcBuffer 0.01 → reject.
    const base = makeQuoteResponse().quote;
    const nativeTokenLeg: QuoteResponse = {
      ...makeQuoteResponse(ARB_CHAIN, {
        quote: { ...base, input: { ...base.input, contractAddress: USDC_ARB, decimals: 6 }, output: { ...base.output, contractAddress: EADDRESS, amount: '0', amountRaw: 1000000000000000000n, decimals: 18, symbol: 'ETH' } },
        holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
      }),
      outputRole: 'token', // native toToken delivery, NOT gas
    };
    nativeTokenLeg.aggregator = { supportsChain: () => true, getQuotes: vi.fn().mockResolvedValue([{ ...nativeTokenLeg.quote, output: { ...nativeTokenLeg.quote.output, amountRaw: 900000000000000000n } }]) } as unknown as Aggregator;

    await expect(
      executeSourceSwaps(
        { swaps: [nativeTokenLeg], creationTime: Date.now(), srcBuffer: new Decimal('0.01'), gasSrcBuffer: undefined },
        mixedCtx(),
        noMeta()
      )
    ).rejects.toThrow(/drift/i);
  });

  it('rejects when per-leg drops are each within srcBuffer but pool exceeds it', async () => {
    const chainA = 42161;
    const chainB = 10;

    const requotedA = makeQuoteResponse(chainA, {
      quote: {
        ...makeQuoteResponse(chainA).quote,
        output: {
          ...makeQuoteResponse(chainA).quote.output,
          amount: '2992',
          amountRaw: 2992000000n,
        },
      },
    });
    const requotedB = makeQuoteResponse(chainB, {
      quote: {
        ...makeQuoteResponse(chainB).quote,
        output: {
          ...makeQuoteResponse(chainB).quote.output,
          amount: '2993',
          amountRaw: 2993000000n,
        },
      },
    });
    const aggregatorA = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedA.quote]),
    } as unknown as Aggregator;
    const aggregatorB = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedB.quote]),
    } as unknown as Aggregator;
    const quoteA = makeQuoteResponse(chainA, { aggregator: aggregatorA });
    const quoteB = makeQuoteResponse(chainB, { aggregator: aggregatorB });

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      sourceExecutionPaths: new Map([
        [chainA, 'ephemeral'],
        [chainB, 'ephemeral'],
      ]),
      chainList: {
        getChainByID: vi.fn().mockImplementation((chainId: number) => ({
          id: chainId,
          name: `Chain ${chainId}`,
        })),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcFailure(chainA, 'retry me')])
          .mockResolvedValueOnce([makeSbcFailure(chainB, 'retry me')]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    // Per-leg drops: A drops 8 (3000 → 2992), B drops 7 (3000 → 2993). Buffer of 10 would
    // pass each leg individually but aggregate drop of 15 exceeds it — must throw.
    await expect(
      executeSourceSwaps(
        { swaps: [quoteA, quoteB], creationTime: Date.now(), srcBuffer: new Decimal(10) },
        ctx,
        metadata
      )
    ).rejects.toThrow(/srcBuffer|drift/i);
  });

  it('accepts requotes where one leg over-quotes and offsets another under-quoting', async () => {
    const chainA = 42161;
    const chainB = 10;

    // Leg A requotes 50 worse, leg B requotes 50 better. Net = 0 drop → fits any buffer ≥ 0.
    const requotedA = makeQuoteResponse(chainA, {
      quote: {
        ...makeQuoteResponse(chainA).quote,
        output: {
          ...makeQuoteResponse(chainA).quote.output,
          amount: '2950',
          amountRaw: 2950000000n,
        },
      },
    });
    const requotedB = makeQuoteResponse(chainB, {
      quote: {
        ...makeQuoteResponse(chainB).quote,
        output: {
          ...makeQuoteResponse(chainB).quote.output,
          amount: '3050',
          amountRaw: 3050000000n,
        },
      },
    });
    const aggregatorA = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedA.quote]),
    } as unknown as Aggregator;
    const aggregatorB = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedB.quote]),
    } as unknown as Aggregator;
    const quoteA = makeQuoteResponse(chainA, { aggregator: aggregatorA });
    const quoteB = makeQuoteResponse(chainB, { aggregator: aggregatorB });

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      sourceExecutionPaths: new Map([
        [chainA, 'ephemeral'],
        [chainB, 'ephemeral'],
      ]),
      chainList: {
        getChainByID: vi.fn().mockImplementation((chainId: number) => ({
          id: chainId,
          name: `Chain ${chainId}`,
        })),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcFailure(chainA, 'retry me')])
          .mockResolvedValueOnce([makeSbcFailure(chainB, 'retry me')])
          .mockResolvedValueOnce([makeSbcSuccess(chainA, '0xaaa' as Hex)])
          .mockResolvedValueOnce([makeSbcSuccess(chainB, '0xbbb' as Hex)]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await expect(
      executeSourceSwaps(
        { swaps: [quoteA, quoteB], creationTime: Date.now(), srcBuffer: new Decimal(0) },
        ctx,
        metadata
      )
    ).resolves.toHaveLength(2);
  });

  it('with srcBuffer=0, any drop on requote is rejected (boundary)', async () => {
    const quote = makeQuoteResponse(ARB_CHAIN);
    const requotedQuote = makeQuoteResponse(ARB_CHAIN, {
      quote: {
        ...makeQuoteResponse().quote,
        output: {
          ...makeQuoteResponse().quote.output,
          amount: '2999.999999',
          amountRaw: 2999999999n,
        },
      },
    });
    const aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([requotedQuote.quote]),
    } as unknown as Aggregator;
    quote.aggregator = aggregator;

    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcFailure(ARB_CHAIN, 'retry me')])
          .mockResolvedValueOnce([makeSbcSuccess(ARB_CHAIN, '0xbbb' as Hex)]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await expect(
      executeSourceSwaps(
        { swaps: [quote], creationTime: Date.now(), srcBuffer: new Decimal(0) },
        ctx,
        metadata
      )
    ).rejects.toThrow(/srcBuffer|drift/i);
  });

  it('rethrows after a retry still fails without submitting a separate cleanup sweep', async () => {
    const chainA = 42161;
    const chainB = 10;
    const quoteA = makeQuoteResponse(chainA);
    const aggregatorB = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([makeQuoteResponse(chainB).quote]),
    } as unknown as Aggregator;
    const quoteB = makeQuoteResponse(chainB, { aggregator: aggregatorB });
    const waitForReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      transactionHash: '0xtx123' as Hex,
    });
    const ctx: SrcCtx = {
      ...makeCtx('ephemeral'),
      sourceExecutionPaths: new Map([
        [chainA, 'ephemeral'],
        [chainB, 'ephemeral'],
      ]),
      chainList: {
        getChainByID: vi.fn().mockImplementation((chainId: number) => ({
          id: chainId,
          name: `Chain ${chainId}`,
        })),
      } as unknown as ExecutionContext['chainList'],
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          multicall: vi.fn().mockResolvedValue([]),
          waitForTransactionReceipt: waitForReceipt,
        }),
      } as unknown as ExecutionContext['publicClientList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi
          .fn()
          .mockResolvedValueOnce([makeSbcSuccess(chainA, '0xaaa' as Hex)])
          .mockResolvedValueOnce([makeSbcFailure(chainB, 'retry me')])
          .mockResolvedValueOnce([makeSbcFailure(chainB, 'still broken')]),
      }),
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await expect(
      executeSourceSwaps({ swaps: [quoteA, quoteB], creationTime: Date.now(), srcBuffer: new Decimal(0) }, ctx, metadata)
    ).rejects.toThrow(/still broken|retry/i);

    expect(createSBCTxFromCalls).toHaveBeenCalledTimes(3);
    expect(createSweeperTxs).not.toHaveBeenCalled();
  });
});
