import { describe, expect, it, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  type PrivateKeyAccount,
  type WalletClient,
} from 'viem';

vi.mock('../../../src/services/sbc', () => ({
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
}));

vi.mock('../../../src/swap/wallet/eoa-executor', () => ({
  executeViaEoa: vi.fn(),
}));

vi.mock('../../../src/swap/sweep', () => ({
  createSweeperTxs: vi.fn().mockReturnValue([
    { to: '0xSweeper' as any, data: '0xsweep' as any, value: 0n },
  ]),
}));

vi.mock('../../../src/services/safe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/services/safe')>();
  return {
    ...orig,
    createSafeExecuteTxFromCalls: vi.fn().mockResolvedValue({
      chainId: 42161,
      safeAddress: '0xacc1ffaf0000000000000000000000000000beef',
      to: '0xacc1ffaf0000000000000000000000000000beef',
      value: '0x0',
      data: '0xdeadbeef',
      operation: 0,
      safeTxGas: '0x0',
      baseGas: '0x0',
      gasPrice: '0x0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      signature: '0x',
    }),
    ensureSafeForEphemeral: vi.fn().mockResolvedValue({
      chainId: 42161,
      owner: '0xbbbb000000000000000000000000000000000002',
      address: '0xacc1ffaf0000000000000000000000000000beef',
      factoryAddress: '0x0',
      exists: true,
    }),
  };
});

import { executeDestinationSwap } from '../../../src/swap/execution/destination-swap';
import { createSBCTxFromCalls } from '../../../src/services/sbc';
import { createSafeExecuteTxFromCalls } from '../../../src/services/safe';
import { executeViaEoa } from '../../../src/swap/wallet/eoa-executor';
import { createSweeperTxs } from '../../../src/swap/sweep';
import { makeSwapExecutionMiddlewareClient } from '../../helpers/middleware-client';
import {
  type DestinationSwap,
  type ExecutionContext,
  type PreparedSwapExecution,
  SwapMode,
  type SwapMetadata,
  type SwapRoute,
} from '../../../src/swap/types';
import type { QuoteResponse, Aggregator } from '../../../src/swap/aggregators/types';
import type { TokenInfo } from '../../../src/domain';

const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
const ARB_CHAIN = 42161;

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

const makeQuoteResponse = (overrides?: Partial<QuoteResponse>): QuoteResponse => ({
  chainID: ARB_CHAIN,
  quote: {
    input: { contractAddress: USDC_ARB, amount: '3000', amountRaw: 3000000000n, decimals: 6, value: 3000, symbol: 'USDC' },
    output: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
    },
  },
  holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
  aggregator: {} as Aggregator,
  ...overrides,
});

const makeDestination = (overrides?: {
  tokenSwap?: QuoteResponse | null;
  gasSwap?: QuoteResponse | null;
}) => ({
  chainId: ARB_CHAIN,
  eoaToEphemeral: null,
  inputAmount: { min: new Decimal('3000'), max: new Decimal('3150') },
  swap: {
    tokenSwap: overrides && 'tokenSwap' in overrides ? overrides.tokenSwap : makeQuoteResponse(),
    gasSwap: overrides?.gasSwap ?? null,
  } as DestinationSwap,
  getDstSwap: vi.fn().mockResolvedValue(null),
});

type DstCtx = Pick<
  ExecutionContext,
  | 'chainList'
  | 'eoaAddress'
  | 'eoaWallet'
  | 'ephemeralWallet'
  | 'publicClientList'
  | 'middlewareClient'
  | 'cache'
  | 'preparedExecution'
  | 'onProgress'
  | 'slippage'
>;

const makePreparedExecution = (tokenSwap: QuoteResponse | null): PreparedSwapExecution => ({
  parsedQuotes: [
    ...(tokenSwap
      ? [
          {
            chainId: tokenSwap.chainID,
            quote: tokenSwap.quote,
            approval: {
              to: tokenSwap.quote.input.contractAddress,
              data: '0xaaa1' as Hex,
              value: 0n,
            },
            swap: {
              to: tokenSwap.quote.txData.tx.to,
              data: '0xbbb1' as Hex,
              value: BigInt(tokenSwap.quote.txData.tx.value),
            },
          },
        ]
      : []),
  ],
  eoaToEphemeralTransfers: [
    {
      reason: 'destination',
      chainId: ARB_CHAIN,
      tokenAddress: USDC_ARB,
      amount: 3000000000n,
      targetAddress: '0xbbbb000000000000000000000000000000000002' as Hex,
      authorization: {
        kind: 'permit',
        call: {
          to: USDC_ARB,
          data: '0xperm1' as Hex,
          value: 0n,
        },
        permit: {
          signature: '0x1234' as Hex,
          permitVariant: 1 as any,
          permitContractVersion: 2,
        },
      },
      transferCall: {
        to: USDC_ARB,
        data: '0xtran1' as Hex,
        value: 0n,
      },
    },
  ],
});

const makeCtx = (
  walletPath: 'eoa' | 'ephemeral' = 'ephemeral',
  preparedExecution?: PreparedSwapExecution
): DstCtx => ({
  chainList: { getChainByID: vi.fn().mockReturnValue({ id: ARB_CHAIN, name: 'Arbitrum' }) } as unknown as ExecutionContext['chainList'],
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
    waitForCallsStatus: vi.fn().mockResolvedValue({ status: 'success', receipts: [{ transactionHash: '0xeoa_dst' as Hex }] }),
    writeContract: vi.fn().mockResolvedValue('0xeoa_approval' as Hex),
  } as unknown as WalletClient,
  publicClientList: {
    get: vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        transactionHash: '0xdst_tx' as Hex,
      }),
    }),
  } as unknown as ExecutionContext['publicClientList'],
  middlewareClient: makeSwapExecutionMiddlewareClient({
    submitSBCs: vi.fn().mockResolvedValue([
      {
        chainId: ARB_CHAIN,
        address: '0x0000000000000000000000000000000000000abc' as Hex,
        errored: false,
        txHash: '0xdst_tx' as Hex,
      },
    ]),
  }),
  cache: {
    getAllowance: vi.fn().mockReturnValue(0n),
    hasAuthCodeSet: vi.fn().mockReturnValue(false),
  } as unknown as ExecutionContext['cache'],
  preparedExecution,
  onProgress: vi.fn(),
  slippage: 0.005,
});

const makeDstTokenInfo = (): TokenInfo => ({
  contractAddress: WETH,
  decimals: 18,
  symbol: 'WETH',
  name: 'Wrapped Ether',
  logo: '',
});

describe('executeDestinationSwap', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

    vi.mocked(executeViaEoa).mockResolvedValue({ txHash: '0xeoa_dst' as Hex });
  });

  it('no destination swap step → no-op, emits no lifecycle progress', async () => {
    // When the route resolved with `tokenSwap === null` (destination is COT), the bridge fill
    // already delivered to the EOA; there's nothing for the destination step to dispatch.
    const ctx = makeCtx('ephemeral');
    const destination = makeDestination({ tokenSwap: null });
    const metadata: SwapMetadata = {
      src: [],
      dst: null,
      has_xcs: false,
      intent_request_hash: null,
    };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    expect(createSweeperTxs).not.toHaveBeenCalled();
    expect(createSBCTxFromCalls).not.toHaveBeenCalled();
    expect(metadata.dst).toBeNull();
    expect(vi.mocked(ctx.onProgress)).not.toHaveBeenCalled();
  });

  it('requotes expired destination quotes before execution', async () => {
    const baseQuote = makeQuoteResponse();
    const expiredQuote = makeQuoteResponse({
      quote: {
        ...baseQuote.quote,
        expiry: Math.floor(Date.now() / 1000) - 60,
      },
    });
    const refreshedQuote = makeQuoteResponse({
      quote: {
        ...baseQuote.quote,
        txData: {
          ...baseQuote.quote.txData,
          tx: {
            ...baseQuote.quote.txData.tx,
            to: '0x3333333333333333333333333333333333333333' as Hex,
            data: '0x1234' as Hex,
          },
        },
      },
    });
    const destination = makeDestination({ tokenSwap: expiredQuote });
    destination.getDstSwap = vi.fn().mockResolvedValue({
      tokenSwap: refreshedQuote,
      gasSwap: null,
    });

    const ctx = makeCtx('ephemeral');
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    expect(destination.getDstSwap).toHaveBeenCalledTimes(1);
    const sbcInput = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0];
    expect(sbcInput.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: refreshedQuote.quote.txData.tx.to,
          data: refreshedQuote.quote.txData.tx.data,
        }),
      ])
    );
  });

  // EXACT_IN destination reclaim (Seam 2): size the dst swap from the COT that actually landed at
  // the wrapper, not the route-time conservative `cotAvailable - srcBuffer`.
  const withReclaimClient = (ctx: DstCtx, balanceRaw: bigint) => {
    const readContract = vi.fn().mockResolvedValue(balanceRaw);
    (ctx.publicClientList.get as unknown) = vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ status: 'success', transactionHash: '0xdst_tx' as Hex }),
      readContract,
    });
    return readContract;
  };

  it('EXACT_IN reclaim: re-sizes the destination swap from the actual wrapper COT balance', async () => {
    const planned = makeQuoteResponse(); // route-time input = 3000 USDC (the conservative floor)
    const resized = makeQuoteResponse({
      quote: {
        ...planned.quote,
        input: { ...planned.quote.input, amount: '3149.685', amountRaw: 3149685000n },
        output: { ...planned.quote.output, amount: '1.05', amountRaw: 1050000000000000000n },
      },
    });
    const destination = makeDestination({ tokenSwap: planned });
    destination.getDstSwap = vi.fn().mockResolvedValue({ tokenSwap: resized, gasSwap: null });

    const ctx = makeCtx('ephemeral');
    const readContract = withReclaimClient(ctx, 3150000000n); // actual COT at wrapper > planned 3000
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    // balanceOf(COT, ephemeral wrapper) read once
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: USDC_ARB,
        functionName: 'balanceOf',
        args: ['0xbbbb000000000000000000000000000000000002'],
      })
    );
    // grew the input from the actual balance (3150), not the route-time planned input (3000)
    expect(destination.getDstSwap).toHaveBeenCalledWith(3150000000n);
    // executed swap used the larger quote → bigger input + output recorded
    expect(metadata.dst?.swaps[0].inputAmount).toBe(3149685000n);
    expect(metadata.dst?.swaps[0].outputAmount).toBe(1050000000000000000n);
  });

  it('EXACT_IN reclaim: skips the grow when the actual balance is not above the planned input', async () => {
    const planned = makeQuoteResponse();
    const destination = makeDestination({ tokenSwap: planned });

    const ctx = makeCtx('ephemeral');
    withReclaimClient(ctx, 3000000000n); // equal to planned → grow gate stays closed
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    expect(destination.getDstSwap).not.toHaveBeenCalled();
    expect(metadata.dst?.swaps[0].inputAmount).toBe(3000000000n); // original quote
  });

  it('EXACT_IN reclaim: falls back to the route-time quote when the grow re-quote fails', async () => {
    const planned = makeQuoteResponse();
    const destination = makeDestination({ tokenSwap: planned });
    destination.getDstSwap = vi.fn().mockRejectedValue(new Error('aggregator down'));

    const ctx = makeCtx('ephemeral');
    withReclaimClient(ctx, 3150000000n);
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    // the grow is best-effort: a failed re-quote must not abort the swap
    expect(destination.getDstSwap).toHaveBeenCalled();
    expect(metadata.dst?.swaps[0].inputAmount).toBe(3000000000n); // original quote executed
  });

  // EXACT_OUT surplus return (Seam 2): the output is fixed, so the COT that arrived beyond what the
  // swap consumes is returned to the EOA by ONE direct transfer, replacing the blind Sweeper drain.
  const findCotTransfer = (
    calls: Array<{ to: Hex; data: Hex; value: bigint }>,
    cot: Hex
  ): readonly [Hex, bigint] | null => {
    for (const c of calls) {
      if (c.to.toLowerCase() !== cot.toLowerCase()) continue;
      try {
        const decoded = decodeFunctionData({ abi: erc20Abi, data: c.data });
        if (decoded.functionName === 'transfer') return decoded.args as readonly [Hex, bigint];
      } catch {
        /* not an erc20 call */
      }
    }
    return null;
  };
  const lastSbcCalls = () =>
    vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0]?.calls as Array<{
      to: Hex;
      data: Hex;
      value: bigint;
    }>;
  const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;

  // EXACT_OUT keeps the output fixed, so the COT that arrives beyond what the swap consumes is the
  // surplus — returned by ONE direct transfer (the leftover is exact: `B − consumed`).
  it('EXACT_OUT surplus: returns B − input by a single direct transfer, not a COT Sweeper', async () => {
    const tokenSwap = makeQuoteResponse(); // input USDC_ARB 3000 (the consumed COT, DI2)
    const destination = makeDestination({ tokenSwap });
    const ctx = makeCtx('ephemeral');
    withReclaimClient(ctx, 3120000000n); // B = balanceOf(dstWrapper) = 3120 USDC
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_OUT, makeDstTokenInfo(),
      ctx,
      metadata
    );

    // one transfer of the surplus (3120 − 3000 = 120 USDC, less the 1bp margin) to the EOA
    const transfer = findCotTransfer(lastSbcCalls(), USDC_ARB);
    expect(transfer?.[0].toLowerCase()).toBe(EOA);
    expect(transfer?.[1]).toBe(120000000n); // exact B − consumed (3120 − 3000)
    // and NO blind Sweeper for the COT
    expect(createSweeperTxs).not.toHaveBeenCalledWith(USDC_ARB, expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it('EXACT_OUT surplus: subtracts the gas-swap COT input too', async () => {
    const tokenSwap = makeQuoteResponse(); // input USDC_ARB 3000
    const gasSwap = makeQuoteResponse({
      quote: {
        input: { contractAddress: USDC_ARB, amount: '50', amountRaw: 50000000n, decimals: 6, value: 50, symbol: 'USDC' },
        output: { contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex, amount: '0.02', amountRaw: 20000000000000000n, decimals: 18, value: 50, symbol: 'ETH' },
        txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
      },
    });
    const destination = makeDestination({ tokenSwap, gasSwap });
    const ctx = makeCtx('ephemeral');
    withReclaimClient(ctx, 3120000000n); // B = 3120; leftover = 3120 − 3000 − 50 = 70
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_OUT, makeDstTokenInfo(),
      ctx,
      metadata
    );

    const transfer = findCotTransfer(lastSbcCalls(), USDC_ARB);
    expect(transfer?.[0].toLowerCase()).toBe(EOA);
    expect(transfer?.[1]).toBe(70000000n); // exact B − tokenInput − gasInput (3120 − 3000 − 50)
  });

  it('EXACT_OUT surplus: emits no transfer when B equals the consumed input (≤ 0 surplus)', async () => {
    const tokenSwap = makeQuoteResponse(); // input 3000
    const destination = makeDestination({ tokenSwap });
    const ctx = makeCtx('ephemeral');
    withReclaimClient(ctx, 3000000000n); // B = 3000 → leftover 0
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_OUT, makeDstTokenInfo(),
      ctx,
      metadata
    );

    expect(findCotTransfer(lastSbcCalls(), USDC_ARB)).toBeNull();
    expect(createSweeperTxs).not.toHaveBeenCalledWith(USDC_ARB, expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it('EXACT_OUT surplus: falls back to the Sweeper when the balance read fails', async () => {
    const tokenSwap = makeQuoteResponse();
    const destination = makeDestination({ tokenSwap });
    const ctx = makeCtx('ephemeral');
    (ctx.publicClientList.get as unknown) = vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', transactionHash: '0xdst_tx' as Hex }),
      readContract: vi.fn().mockRejectedValue(new Error('rpc down')),
    });
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_OUT, makeDstTokenInfo(),
      ctx,
      metadata
    );

    // no deterministic transfer, but the blind COT Sweeper still drains the leftover
    expect(findCotTransfer(lastSbcCalls(), USDC_ARB)).toBeNull();
    expect(createSweeperTxs).toHaveBeenCalledWith(USDC_ARB, EOA, ARB_CHAIN, expect.anything(), expect.anything());
  });

  it('EXACT_OUT surplus: skips the output-token dust sweep when its wrapper balance is zero', async () => {
    const tokenSwap = makeQuoteResponse(); // input USDC_ARB 3000, output WETH (delivered to the EOA)
    const destination = makeDestination({ tokenSwap });
    const ctx = makeCtx('ephemeral');
    // COT B = 3120; the output token (WETH) fully landed at the EOA → 0 at the wrapper.
    const readContract = vi.fn().mockImplementation(({ address }: { address: Hex }) =>
      Promise.resolve(address.toLowerCase() === WETH.toLowerCase() ? 0n : 3120000000n)
    );
    (ctx.publicClientList.get as unknown) = vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', transactionHash: '0xdst_tx' as Hex }),
      readContract,
    });
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_OUT, makeDstTokenInfo(),
      ctx,
      metadata
    );

    // COT surplus returned by transfer; the zero-balance WETH dust sweep is skipped entirely
    expect(findCotTransfer(lastSbcCalls(), USDC_ARB)?.[1]).toBe(120000000n);
    expect(createSweeperTxs).not.toHaveBeenCalled();
  });

  it('ephemeral path prepends prepared destination transfer and parsed approvals before swap calls', async () => {
    const tokenSwap = makeQuoteResponse();

    vi.mocked(createSweeperTxs).mockImplementation((tokenAddress) => [
      { to: tokenAddress as Hex, data: '0xsweep' as Hex, value: 0n },
    ]);

    const ctx = makeCtx('ephemeral', makePreparedExecution(tokenSwap));
    const destination = makeDestination({ tokenSwap });
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    const sbcInput = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0];
    expect(sbcInput.calls).toEqual([
      { to: USDC_ARB, data: '0xperm1', value: 0n },
      { to: USDC_ARB, data: '0xtran1', value: 0n },
      { to: USDC_ARB, data: '0xaaa1', value: 0n },
      { to: tokenSwap.quote.txData.tx.to, data: '0xbbb1', value: 0n },
      { to: tokenSwap.quote.output.contractAddress, data: '0xsweep', value: 0n },
      { to: USDC_ARB, data: '0xsweep', value: 0n },
    ]);
  });

  it('keeps the EOA funding approve out of the destination SBC calldata when permit support is unavailable', async () => {
    const tokenSwap = makeQuoteResponse();
    const expectedFundingApprove = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: ['0xbbbb000000000000000000000000000000000002' as Hex, 3000000000n],
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
    const expectedRouterApprove = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [tokenSwap.quote.txData.approvalAddress, 3000000000n],
    });

    const preparedExecution = makePreparedExecution(tokenSwap);
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
    const destination = makeDestination({ tokenSwap });
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

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
    expect(sbcInput.calls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: USDC_ARB,
          data: expectedFundingApprove,
        }),
      ])
    );
    expect(sbcInput.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: USDC_ARB,
          data: expectedTransferFrom,
        }),
        expect.objectContaining({
          to: USDC_ARB,
          data: expectedRouterApprove,
        }),
      ])
    );
  });

  it('switches the EOA wallet to the destination funding chain before a paid approval fallback', async () => {
    const fundingChainId = 137;
    const tokenSwap = makeQuoteResponse({
      chainID: fundingChainId,
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
      holding: { chainID: fundingChainId, tokenAddress: USDC_ARB, amountRaw: 3000000000n, decimals: 6, symbol: 'USDC' },
    });
    const expectedFundingApprove = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: ['0xbbbb000000000000000000000000000000000002' as Hex, 3000000000n],
    });
    const preparedExecution = makePreparedExecution(tokenSwap);
    preparedExecution.eoaToEphemeralTransfers[0] = {
      ...preparedExecution.eoaToEphemeralTransfers[0],
      chainId: fundingChainId,
      authorization: {
        kind: 'approve',
        call: {
          to: USDC_ARB,
          data: expectedFundingApprove,
          value: 0n,
        },
        permit: null,
      },
    };

    const ctx: DstCtx = {
      ...makeCtx('ephemeral', preparedExecution),
      chainList: {
        getChainByID: vi.fn().mockImplementation((chainId: number) => ({
          id: chainId,
          name: `Chain ${chainId}`,
        })),
        getTokenByAddress: vi.fn().mockReturnValue({
          contractAddress: USDC_ARB,
          decimals: 6,
          symbol: 'USDC',
        }),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([
          {
            chainId: fundingChainId,
            address: '0x0000000000000000000000000000000000000abc' as Hex,
            errored: false,
            txHash: '0x137dst' as Hex,
          },
        ]),
      }),
    };
    let currentChainId = ARB_CHAIN;
    vi.mocked(ctx.eoaWallet.getChainId).mockImplementation(async () => currentChainId);
    vi.mocked(ctx.eoaWallet.switchChain).mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    });
    const destination = {
      ...makeDestination({ tokenSwap }),
      chainId: fundingChainId,
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    expect(ctx.eoaWallet.switchChain).toHaveBeenCalledWith({ id: fundingChainId });
  });

  it('Case C: ephemeral path → SBC + submit', async () => {
    const ctx = makeCtx('ephemeral');
    const destination = makeDestination();
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(destination as unknown as SwapRoute['destination'], SwapMode.EXACT_IN, makeDstTokenInfo(), ctx, metadata);

    expect(createSBCTxFromCalls).toHaveBeenCalled();
    expect(ctx.middlewareClient.submitSBCs).toHaveBeenCalled();
    expect(metadata.dst).not.toBeNull();
    expect(metadata.dst!.chid).toBe(ARB_CHAIN);
  });

  it('emits typed destination_swap progress', async () => {
    const ctx = makeCtx('ephemeral');
    const destination = makeDestination();
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(destination as unknown as SwapRoute['destination'], SwapMode.EXACT_IN, makeDstTokenInfo(), ctx, metadata);

    const progress = vi.mocked(ctx.onProgress!).mock.calls.map(([update]) => update);

    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepType: 'destination_swap',
          state: 'started',
          chainId: ARB_CHAIN,
        }),
        expect.objectContaining({
          stepType: 'destination_swap',
          state: 'submitted',
          chainId: ARB_CHAIN,
          txHash: '0xdst_tx',
        }),
        expect.objectContaining({
          stepType: 'destination_swap',
          state: 'confirmed',
          chainId: ARB_CHAIN,
          txHash: '0xdst_tx',
        }),
      ])
    );
  });

  it('ephemeral path calls createSweeperTxs for token swap output', async () => {
    const ctx = makeCtx('ephemeral');
    const destination = makeDestination();
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(destination as unknown as SwapRoute['destination'], SwapMode.EXACT_IN, makeDstTokenInfo(), ctx, metadata);

    expect(createSweeperTxs).toHaveBeenCalled();
  });

  it('metadata populated with destination swap data', async () => {
    const ctx = makeCtx('ephemeral');
    const destination = makeDestination();
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(destination as unknown as SwapRoute['destination'], SwapMode.EXACT_IN, makeDstTokenInfo(), ctx, metadata);

    expect(metadata.dst!.swaps).toHaveLength(1);
    expect(metadata.dst!.tx_hash).toBeDefined();
  });

  it('metadata records both token swap and gas swap entries when present', async () => {
    const tokenSwap = makeQuoteResponse();
    const gasSwap: QuoteResponse = {
      chainID: ARB_CHAIN,
      quote: {
        input: { contractAddress: USDC_ARB, amount: '25', amountRaw: 25_000_000n, decimals: 6, value: 25, symbol: 'USDC' },
        output: {
          contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
          amount: '0.001', amountRaw: 1_000_000_000_000_000n, decimals: 18, value: 25, symbol: 'ETH',
        },
        txData: {
          approvalAddress: '0x4444444444444444444444444444444444444444' as Hex,
          tx: { to: '0x5555555555555555555555555555555555555555' as Hex, data: '0xfeedface' as Hex, value: '0x0' as Hex },
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 25_000_000n, decimals: 6, symbol: 'USDC' },
      aggregator: {} as Aggregator,
    };
    const ctx = makeCtx('ephemeral');
    const destination = makeDestination({ tokenSwap, gasSwap });
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(destination as unknown as SwapRoute['destination'], SwapMode.EXACT_IN, makeDstTokenInfo(), ctx, metadata);

    expect(metadata.dst!.swaps).toHaveLength(2);
    expect(metadata.dst!.swaps[0].outputContract).toBe(tokenSwap.quote.output.contractAddress);
    expect(metadata.dst!.swaps[1].outputContract).toBe(gasSwap.quote.output.contractAddress);
  });

  it('ephemeral path throws when middleware reports SBC submission failure', async () => {
    const ctx = makeCtx('ephemeral');
    ctx.middlewareClient.submitSBCs = vi
      .fn()
      .mockResolvedValue([
        {
          chainId: ARB_CHAIN,
          address: '0x0000000000000000000000000000000000000abc' as Hex,
          errored: true,
          message: 'destination failed',
        },
      ]) as any;

    const destination = makeDestination();
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await expect(
      executeDestinationSwap(
        destination as unknown as SwapRoute['destination'],
        SwapMode.EXACT_IN, makeDstTokenInfo(),
        ctx,
        metadata
      )
    ).rejects.toThrow(/destination failed|SBC submission|Quote failed/i);
  });

  it('retries destination execution twice with forced requotes, then rethrows without a fallback sweep', async () => {
    const ctx = makeCtx('ephemeral');
    ctx.middlewareClient.submitSBCs = (
      vi
        .fn()
        .mockResolvedValueOnce([
          {
            chainId: ARB_CHAIN,
            address: '0x0000000000000000000000000000000000000abc' as Hex,
            errored: true,
            message: 'attempt 1 failed',
          },
        ])
        .mockResolvedValueOnce([
          {
            chainId: ARB_CHAIN,
            address: '0x0000000000000000000000000000000000000abc' as Hex,
            errored: true,
            message: 'attempt 2 failed',
          },
        ])
        .mockResolvedValueOnce([
          {
            chainId: ARB_CHAIN,
            address: '0x0000000000000000000000000000000000000abc' as Hex,
            errored: true,
            message: 'attempt 3 failed',
          },
        ])
    ) as any;

    const baseQuote = makeQuoteResponse();
    const requotedA = makeQuoteResponse({
      quote: {
        ...baseQuote.quote,
        txData: {
          ...baseQuote.quote.txData,
          tx: { ...baseQuote.quote.txData.tx, data: '0x1111' as Hex },
        },
      },
    });
    const requotedB = makeQuoteResponse({
      quote: {
        ...baseQuote.quote,
        txData: {
          ...baseQuote.quote.txData,
          tx: { ...baseQuote.quote.txData.tx, data: '0x2222' as Hex },
        },
      },
    });

    const destination = makeDestination();
    destination.getDstSwap = vi
      .fn()
      .mockResolvedValueOnce({ tokenSwap: requotedA, gasSwap: null })
      .mockResolvedValueOnce({ tokenSwap: requotedB, gasSwap: null });

    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await expect(
      executeDestinationSwap(
        destination as unknown as SwapRoute['destination'],
        SwapMode.EXACT_IN, makeDstTokenInfo(),
        ctx,
        metadata
      )
    ).rejects.toThrow(/attempt 3 failed|SBC submission/i);

    expect(destination.getDstSwap).toHaveBeenCalledTimes(2);
    expect(createSBCTxFromCalls).toHaveBeenCalledTimes(3);
  });

  it('Safe path: dispatches destination swap via Safe.execTransaction (not SBC) on non-7702 destination', async () => {
    // Destination chain advertises supports7702=false, so the wrapper resolved by
    // chainSupports7702() is 'safe'. Safe.execTransaction takes the bridge-filled COT and runs
    // the dst aggregator swap, delivering output to the EOA.
    const tokenSwap = makeQuoteResponse();
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe_dst_tx' as Hex });
    const base = makeCtx('ephemeral', makePreparedExecution(tokenSwap));
    const ctx = {
      ...base,
      chainList: {
        getChainByID: vi.fn().mockReturnValue({
          id: ARB_CHAIN,
          name: 'NonPectraChain',
          supports7702: false,
        }),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([]),
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({
          address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
        }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as DstCtx;
    const destination = makeDestination({ tokenSwap });
    const metadata: SwapMetadata = {
      src: [],
      dst: null,
      has_xcs: false,
      intent_request_hash: null,
    };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    expect(createSafeExecuteTx).toHaveBeenCalledTimes(1);
    expect(createSafeExecuteTxFromCalls).toHaveBeenCalledTimes(1);
    expect(createSBCTxFromCalls).not.toHaveBeenCalled();

    // Sweeper sender = Safe address so Sweeper.sweepERC20 pulls the residual COT/output from
    // the Safe wrapper (not the ephemeral).
    const sweepCallArgs = vi.mocked(createSweeperTxs).mock.calls[0];
    const sweeperSender = sweepCallArgs?.[4]; // 5th arg is the sender address override
    expect(sweeperSender?.toLowerCase()).toBe(
      '0x2d7E4C3ef02B86D271624742C6e81636f4c9e663'.toLowerCase()
    );
  });

  it('Safe path: moves EOA-held direct COT into the Safe before the destination swap', async () => {
    // Parity with v1: when the destination holds direct EOA COT (eoaToEphemeral set) on a non-7702
    // chain, the COT must be moved EOA -> Safe (permit/approve spender = Safe) inside the Safe batch
    // before the aggregator swap runs as the Safe. Without it the Safe holds zero COT and the swap
    // reverts (GS013).
    const SAFE = '0x2d7E4C3ef02B86D271624742C6e81636f4c9e663' as Hex; // predictSafe(0xbbbb...0002)
    const tokenSwap = makeQuoteResponse();
    const prepared = makePreparedExecution(tokenSwap);
    prepared.eoaToEphemeralTransfers[0] = {
      ...prepared.eoaToEphemeralTransfers[0],
      targetAddress: SAFE,
    };
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe_dst_fund' as Hex });
    const base = makeCtx('ephemeral', prepared);
    const ctx = {
      ...base,
      chainList: {
        getChainByID: vi.fn().mockReturnValue({
          id: ARB_CHAIN,
          name: 'NonPectraChain',
          supports7702: false,
        }),
        getTokenByAddress: vi.fn().mockReturnValue({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC' }),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([]),
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({ address: SAFE }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as DstCtx;
    const destination = {
      ...makeDestination({ tokenSwap }),
      eoaToEphemeral: { amount: 3000000000n, contractAddress: USDC_ARB },
    };
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    const safeCalls = vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]?.[0]?.calls ?? [];
    const datas = safeCalls.map((call) => call.data);
    // The EOA->Safe COT transfer must be in the batch, ahead of the router approval/swap.
    expect(datas).toContain('0xtran1');
    expect(datas.indexOf('0xtran1')).toBeLessThan(datas.indexOf('0xaaa1'));
  });

  it('Safe path: does NOT sweep the output token (aggregator delivers to EOA; avoids GS013 on native output)', async () => {
    // Regression: when the dst output is native (e.g. HYPE on HyperEVM), the previous code
    // pushed the output address into sweepTokens. createSweeperTxs treats EADDRESS as a
    // Calibur approveNative call targeting `senderAddress` — on Safe paths that targets the
    // Safe, which doesn't implement approveNative, and the inner call reverts (GS013).
    const tokenSwap = makeQuoteResponse({
      quote: {
        input: { contractAddress: USDC_ARB, amount: '5', amountRaw: 5_000_000n, decimals: 6, value: 5, symbol: 'USDC' },
        output: {
          // EADDRESS — native HYPE on HyperEVM is the destination output.
          contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
          amount: '0.001',
          amountRaw: 1_000_000_000_000_000n,
          decimals: 18,
          value: 5,
          symbol: 'HYPE',
        },
        txData: {
          approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
          tx: {
            to: '0x2222222222222222222222222222222222222222' as Hex,
            data: '0xabcdef' as Hex,
            value: '0x0' as Hex,
          },
        },
      },
    });
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe_dst_tx2' as Hex });
    const base = makeCtx('ephemeral', makePreparedExecution(tokenSwap));
    const ctx = {
      ...base,
      chainList: {
        getChainByID: vi.fn().mockReturnValue({
          id: ARB_CHAIN,
          name: 'NonPectraChain',
          supports7702: false,
        }),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([]),
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({
          address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
        }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as DstCtx;
    const destination = makeDestination({ tokenSwap });
    const metadata: SwapMetadata = {
      src: [],
      dst: null,
      has_xcs: false,
      intent_request_hash: null,
    };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    const sweptTokens = vi
      .mocked(createSweeperTxs)
      .mock.calls.map((args) => (args[0] as string).toLowerCase());
    expect(sweptTokens).not.toContain('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    // Input COT must still be swept so residual COT at Safe drains to EOA.
    expect(sweptTokens).toContain(USDC_ARB.toLowerCase());
  });

  it('Safe path: includes gas-swap approve+swap in the same batch, no raw native value-send', async () => {
    // After the gas-via-aggregator refactor, native gas comes from a dst aggregator swap
    // (COT → native, receiver = EOA) that runs inside the same Safe.execTransaction as the
    // token swap. The previous Safe → EOA value-send is gone — the aggregator delivers
    // native directly to the EOA.
    const tokenSwap = makeQuoteResponse();
    const gasSwap: QuoteResponse = {
      chainID: ARB_CHAIN,
      quote: {
        input: { contractAddress: USDC_ARB, amount: '25', amountRaw: 25_000_000n, decimals: 6, value: 25, symbol: 'USDC' },
        output: {
          contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
          amount: '0.001', amountRaw: 1_000_000_000_000_000n, decimals: 18, value: 25, symbol: 'ETH',
        },
        txData: {
          approvalAddress: '0x4444444444444444444444444444444444444444' as Hex,
          tx: { to: '0x5555555555555555555555555555555555555555' as Hex, data: '0xfeedface' as Hex, value: '0x0' as Hex },
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 25_000_000n, decimals: 6, symbol: 'USDC' },
      aggregator: {} as Aggregator,
    };
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe_gas_tx' as Hex });
    const base = makeCtx('ephemeral', makePreparedExecution(tokenSwap));
    const ctx = {
      ...base,
      chainList: {
        getChainByID: vi.fn().mockReturnValue({
          id: ARB_CHAIN,
          name: 'NonPectraChain',
          supports7702: false,
        }),
      } as unknown as ExecutionContext['chainList'],
      middlewareClient: makeSwapExecutionMiddlewareClient({
        submitSBCs: vi.fn().mockResolvedValue([]),
        createSafeExecuteTx,
        getSafeAccountAddress: vi.fn().mockResolvedValue({
          address: '0xacc1ffaf0000000000000000000000000000beef' as Hex,
        }),
        ensureSafeAccount: vi.fn().mockResolvedValue({}),
      }),
    } as DstCtx;
    const destination = makeDestination({ tokenSwap, gasSwap });
    const metadata: SwapMetadata = {
      src: [],
      dst: null,
      has_xcs: false,
      intent_request_hash: null,
    };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    const safeCallArgs = vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]?.[0]?.calls ?? [];
    // Includes gas-swap calldata.
    const gasSwapCall = safeCallArgs.find((call) => call.to === gasSwap.quote.txData.tx.to);
    expect(gasSwapCall).toBeDefined();
    // No raw native value-send to the EOA — aggregator delivers native directly.
    const nativeValueSend = safeCallArgs.find(
      (call) =>
        call.to.toLowerCase() === ctx.eoaAddress.toLowerCase() && call.value > 0n
    );
    expect(nativeValueSend).toBeUndefined();

    // We must NOT push EADDRESS through createSweeperTxs.
    const sweptTokens = vi
      .mocked(createSweeperTxs)
      .mock.calls.map((args) => (args[0] as string).toLowerCase());
    expect(sweptTokens).not.toContain('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  });

  it('ephemeral path: includes gas-swap approve+swap in the SBC batch, no EADDRESS sweep', async () => {
    const tokenSwap = makeQuoteResponse();
    const gasSwap: QuoteResponse = {
      chainID: ARB_CHAIN,
      quote: {
        input: { contractAddress: USDC_ARB, amount: '25', amountRaw: 25_000_000n, decimals: 6, value: 25, symbol: 'USDC' },
        output: {
          contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
          amount: '0.001', amountRaw: 1_000_000_000_000_000n, decimals: 18, value: 25, symbol: 'ETH',
        },
        txData: {
          approvalAddress: '0x4444444444444444444444444444444444444444' as Hex,
          tx: { to: '0x5555555555555555555555555555555555555555' as Hex, data: '0xfeedface' as Hex, value: '0x0' as Hex },
        },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 25_000_000n, decimals: 6, symbol: 'USDC' },
      aggregator: {} as Aggregator,
    };

    const ctx = makeCtx('ephemeral');
    const destination = makeDestination({ tokenSwap, gasSwap });
    const metadata: SwapMetadata = { src: [], dst: null, has_xcs: false, intent_request_hash: null };

    await executeDestinationSwap(
      destination as unknown as SwapRoute['destination'],
      SwapMode.EXACT_IN, makeDstTokenInfo(),
      ctx,
      metadata
    );

    const sbcInput = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0];
    const sbcCallTos = sbcInput.calls.map((c) => c.to);
    expect(sbcCallTos).toContain(gasSwap.quote.txData.tx.to);

    const sweptTokens = vi
      .mocked(createSweeperTxs)
      .mock.calls.map((args) => (args[0] as string).toLowerCase());
    // EADDRESS (native) must NOT be swept; aggregator delivers it direct to EOA.
    expect(sweptTokens).not.toContain('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  });
});
