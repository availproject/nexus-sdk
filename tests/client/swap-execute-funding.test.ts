import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { createNexusClient, type SwapAndExecuteParams } from '../../src';
import { ZERO_ADDRESS } from '../../src/domain';
import * as runtime from '../../src/execute/runtime';
import { normalizeIntentQuote } from '../../src/intent/normalize';
import type { IntentBalance, IntentQuoteRequest } from '../../src/intent/types';
import { testChains } from '../fixtures/chains';
import { makeTokenFetcher } from '../helpers/catalog';
import { makeMiddlewareClient } from '../helpers/middleware-client';

const rpc = vi.hoisted(() => ({
  readContract: vi.fn(),
  estimateGas: vi.fn(),
  estimateFeesPerGas: vi.fn(),
  getFeeHistory: vi.fn(),
}));
vi.mock('viem', async () => ({
  ...await vi.importActual<typeof import('viem')>('viem'),
  createPublicClient: vi.fn(() => rpc),
}));

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as const;
const TARGET = '0x00000000000000000000000000000000000000bb' as const;
const TOKEN = testChains[0].tokens[1].address;
const SIGNATURE = `0x${'22'.repeat(65)}` as Hex;
const history = (baseFee = 100n) => ({ baseFeePerGas: [baseFee], reward: [[10n, 20n, 30n]] });

const quote = (request: IntentQuoteRequest, index: number) => {
  const id = `0x${index.toString(16).padStart(64, '0')}` as Hex;
  return normalizeIntentQuote({
    quoteId: id, provider: 'nexus-v2', tradeType: 'exactOutput', input: [],
    isExecutable: true, executionWarnings: [],
    output: { chainId: request.output.chainId, tokenAddress: request.output.token,
      amount: request.output.amount, amountUsd: '1' },
    minAmountOut: request.output.amount, minAmountOutUsd: '1',
    fees: { deposit: '0', depositUsd: '0', fulfillment: '0', fulfillmentUsd: '0',
      protocol: '0', protocolUsd: '0', solver: '0', solverUsd: '0' },
    expiry: '2000000000', rff: { quoteId: id }, rffHash: id,
    allowances: [], nativeTransactions: [],
    submitRequirements: { requiredSignatures: [{
      kind: 'intent', universe: 'EVM', signingScheme: 'personal_sign',
      data: { messagePrefix: 'Sign this intent to proceed', message: '0x1234', hash: id },
    }], requiresApprovals: false, requiresNativeTxReceipts: false },
  });
};

const balance = (chainId: number, tokenAddress: Hex, balanceRaw: bigint): IntentBalance => ({
  chainId, tokenAddress, balanceRaw, isNative: tokenAddress === ZERO_ADDRESS, verified: true,
  symbol: tokenAddress === ZERO_ADDRESS ? 'ETH' : 'USDC',
  name: tokenAddress === ZERO_ADDRESS ? 'Ether' : 'USD Coin',
  decimals: tokenAddress === ZERO_ADDRESS ? 18 : 6,
  providers: [{ id: 'nexus-v2' }], usable: true, valueUsd: null, priceSource: null,
});

const clients: ReturnType<typeof createNexusClient>[] = [];
beforeEach(() => {
  rpc.readContract.mockReset().mockImplementation(async ({ functionName }) => {
    if (functionName === 'getL1Fee') return 25n;
    if (functionName === 'gasEstimateL1Component') return [20n, 1n, 0n];
    return 0n;
  });
  rpc.estimateGas.mockReset().mockImplementation(async ({ to }) => {
    if (to === TOKEN) return 50_000n;
    throw new Error('execution is unfunded');
  });
  rpc.estimateFeesPerGas.mockReset().mockResolvedValue({ gasPrice: 1n });
  rpc.getFeeHistory.mockReset().mockResolvedValue(history());
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.destroy());
  vi.restoreAllMocks();
});

const setup = async (chainId = 1, balances: IntentBalance[] = []) => {
  const chains = [
    { ...structuredClone(testChains[0]), id: chainId,
      tokens: testChains[0].tokens.map((token) => ({ ...token, chainId })) },
    structuredClone(testChains[1]),
  ];
  let quoteIndex = 0;
  const getIntentQuote = vi.fn(async (request: IntentQuoteRequest) => quote(request, ++quoteIndex));
  const getIntentBalances = vi.fn(async () => ({ balances, errored: false }));
  const submitIntent = vi.fn(async () => ({ quoteId: '0x11' as Hex, status: 'created' as const }));
  const client = createNexusClient({ clientId: 'swap-execute-funding', analytics: { enabled: false },
    internal: { middlewareClient: makeMiddlewareClient({
      getIntentChains: async () => chains,
      getIntentTokens: makeTokenFetcher(chains), getIntentQuote, getIntentBalances, submitIntent,
      getIntentStatus: async (id) => ({ id, provider: 'nexus-v2', status: 'fulfilled', substatus: 'completed', legs: [] }),
    }) },
  });
  clients.push(client);
  await client.initialize();
  await client.setEVMProvider({
    request: vi.fn(async ({ method }) => {
      if (method === 'eth_accounts') return [ACCOUNT];
      if (method === 'personal_sign') return SIGNATURE;
      return '0x1';
    }), on: vi.fn(), removeListener: vi.fn(),
  });
  const send = vi.spyOn(runtime, 'sendExecuteTransactions').mockResolvedValue({
    txHash: '0x1234', receipt: undefined, approvalHash: undefined,
  });
  const params: SwapAndExecuteParams = {
    toChainId: chainId, toTokenAddress: TOKEN, toAmountRaw: 1000n,
    execute: { to: TARGET, data: '0x1234', gas: 100_000n },
  };
  return { client, params, send, getIntentQuote, getIntentBalances, submitIntent };
};

describe('swap execution preparation and fees', () => {
  it.each([
    { chainId: 1, gas: 120_000n, price: 168n, cost: 30_240_000n, legacy: false },
    { chainId: 8453, gas: 120_000n, price: 154n, cost: 27_720_064n, legacy: false },
    { chainId: 42161, gas: 120_024n, price: 196n, cost: 35_284_704n, legacy: true },
  ])('funds and sends chain $chainId with the same buffered gas and fee settings', async ({ chainId, gas, price, cost, legacy }) => {
    const ctx = await setup(chainId);
    ctx.params.execute.tokenApproval = { toTokenAddress: TOKEN, amount: 1000n, spender: TARGET };
    await ctx.client.swapAndExecute(ctx.params);
    expect(ctx.getIntentQuote.mock.calls[0][0].gasDrop).toEqual({ amount: cost.toString() });
    expect(ctx.send).toHaveBeenCalledWith(expect.objectContaining({
      tx: expect.objectContaining({ gas }),
      approvalTx: expect.objectContaining({ gas: 60_000n }),
      feeParams: legacy ? { type: 'legacy', gasPrice: price }
        : { type: 'eip1559', maxFeePerGas: price, maxPriorityFeePerGas: 20n },
    }), expect.anything());
    expect(rpc.estimateGas).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: TOKEN }));
    expect(rpc.readContract.mock.calls.filter(([call]) => call.functionName === 'allowance')).toHaveLength(1);
  });

  it('uses 70,000 approval gas only when approval estimation fails', async () => {
    const ctx = await setup();
    ctx.params.execute.tokenApproval = { toTokenAddress: TOKEN, amount: 1000n, spender: TARGET };
    rpc.estimateGas.mockRejectedValue(new Error('no native balance'));
    await ctx.client.swapAndExecute(ctx.params);
    expect(ctx.getIntentQuote.mock.calls[0][0].gasDrop).toEqual({ amount: '34272000' });
    expect(ctx.send.mock.calls[0][0].approvalTx?.gas).toBe(84_000n);
  });

  it('honors the selected fee tier and skips approval estimation when allowance suffices', async () => {
    const ctx = await setup();
    ctx.params.execute.gasPrice = 'high';
    ctx.params.execute.tokenApproval = { toTokenAddress: TOKEN, amount: 1000n, spender: TARGET };
    rpc.readContract.mockResolvedValue(1000n);
    await ctx.client.swapAndExecute(ctx.params);
    expect(ctx.getIntentQuote.mock.calls[0][0].gasDrop).toEqual({ amount: '21600000' });
    expect(ctx.send.mock.calls[0][0]).toMatchObject({
      approvalTx: null, feeParams: { maxFeePerGas: 180n, maxPriorityFeePerGas: 30n },
    });
    expect(rpc.estimateGas).not.toHaveBeenCalled();
  });
});

describe('swap execution fee refresh', () => {
  it('shows the composite requirement and balances even when no swap is needed', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 1000n), balance(1, ZERO_ADDRESS, 30_000_000n)]);
    const onIntent = vi.fn(({ intent, allow }) => {
      expect(intent).toMatchObject({
        swapRequired: false, available: { token: { amountRaw: 1000n }, gas: { amountRaw: 30_000_000n } },
        executeRequirement: { token: { amountRaw: 1000n }, gas: { amountRaw: 20_160_000n, estimatedGasUnits: 120_000n } },
        shortfall: { token: { amountRaw: 0n }, gas: { amountRaw: 0n } },
      });
      expect(intent.quote).toBeUndefined();
      expect(ctx.send).not.toHaveBeenCalled();
      allow();
    });
    const result = await ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent } });
    expect(onIntent).toHaveBeenCalledOnce();
    expect(result.swapSkipped).toBe(true);
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.submitIntent).not.toHaveBeenCalled();
  });

  it('refreshes from funding required to fully funded, then executes only after allow', async () => {
    rpc.getFeeHistory.mockResolvedValue(history(200n));
    const ctx = await setup(1, [balance(1, TOKEN, 1000n), balance(1, ZERO_ADDRESS, 30_000_000n)]);
    const result = await ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent: async ({ intent, refresh, allow }) => {
      expect(intent.swapRequired).toBe(true);
      rpc.getFeeHistory.mockResolvedValue(history());
      const next = await refresh();
      expect(next.swapRequired).toBe(false);
      expect(next.quote).toBeUndefined();
      expect(next.shortfall.gas.amountRaw).toBe(0n);
      expect(ctx.send).not.toHaveBeenCalled();
      allow();
    } } });
    expect(result.swapSkipped).toBe(true);
    expect(ctx.getIntentQuote).toHaveBeenCalledTimes(1);
    expect(ctx.submitIntent).not.toHaveBeenCalled();
    expect(ctx.send.mock.calls[0][0]).toMatchObject({ feeParams: { maxFeePerGas: 168n } });
  });

  it('can refresh a fully funded preview into a funding quote when prices rise', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 1000n), balance(1, ZERO_ADDRESS, 30_000_000n)]);
    const result = await ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent: async ({ intent, refresh, allow }) => {
      expect(intent.swapRequired).toBe(false);
      rpc.getFeeHistory.mockResolvedValue(history(200n));
      const next = await refresh();
      expect(next).toMatchObject({ swapRequired: true, shortfall: { token: { amountRaw: 0n }, gas: { amountRaw: 7_440_000n } } });
      expect(next.quote).toBeDefined();
      allow();
    } } });
    expect(result.swapSkipped).toBe(false);
    expect(ctx.getIntentQuote.mock.calls[0][0]).toMatchObject({ output: { amount: '1' }, gasDrop: { amount: '7440000' } });
  });

  it('waits for queued refreshes before accepting their matching fee settings', async () => {
    const ctx = await setup();
    let release!: (value: ReturnType<typeof history>) => void;
    await ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent: async ({ refresh, allow }) => {
      rpc.getFeeHistory.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
      const first = refresh();
      const second = refresh();
      allow();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      expect(ctx.submitIntent).not.toHaveBeenCalled();
      expect(ctx.send).not.toHaveBeenCalled();
      release(history(200n));
      await first;
      await second;
    } } });
    expect(ctx.getIntentQuote.mock.calls.map(([request]) => request.gasDrop?.amount)).toEqual(['20160000', '37440000', '20160000']);
    expect(ctx.send.mock.calls[0][0]).toMatchObject({ feeParams: { maxFeePerGas: 168n } });
  });

  it('does not sign or execute after denying a composite preview', async () => {
    const ctx = await setup();
    await expect(ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent: ({ deny }) => deny() } })).rejects.toThrow();
    expect(ctx.submitIntent).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('refreshes fees using the same raw gas and balance snapshot, then sends the accepted settings', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 40n), balance(1, ZERO_ADDRESS, 100n)]);
    ctx.params.execute.tokenApproval = { toTokenAddress: TOKEN, amount: 1000n, spender: TARGET };
    await ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent: async ({ refresh, allow }) => {
      rpc.getFeeHistory.mockResolvedValue(history(200n));
      await refresh();
      await refresh();
      allow();
    } } });
    expect(ctx.getIntentQuote.mock.calls.map(([request]) => request.output.amount)).toEqual(['960', '960', '960']);
    expect(ctx.getIntentQuote.mock.calls.map(([request]) => request.gasDrop?.amount)).toEqual(['30239900', '56159900', '56159900']);
    expect(ctx.getIntentBalances).toHaveBeenCalledTimes(1);
    expect(rpc.getFeeHistory).toHaveBeenCalledTimes(3);
    expect(rpc.estimateGas).toHaveBeenCalledTimes(1);
    expect(rpc.readContract.mock.calls.filter(([call]) => call.functionName === 'allowance')).toHaveLength(1);
    expect(ctx.send.mock.calls[0][0]).toMatchObject({
      tx: { gas: 120_000n }, approvalTx: { gas: 60_000n },
      feeParams: { maxFeePerGas: 312n, maxPriorityFeePerGas: 20n },
    });
  });

  it('filters snapshot balances by new sources and retains the last successful selection', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 40n), balance(1, ZERO_ADDRESS, 100n), balance(11155111, TOKEN, 1000n)]);
    ctx.params.sources = [{ chainId: 11155111, tokenAddress: TOKEN }];
    await ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent: async ({ refresh, allow }) => {
      await refresh([{ chainId: 1 }]);
      await refresh();
      await refresh([{ chainId: 1, tokenAddress: TOKEN }]);
      allow();
    } } });
    expect(ctx.getIntentQuote.mock.calls.map(([request]) => [request.output.amount, request.gasDrop?.amount])).toEqual([
      ['1000', '20160000'], ['960', '20159900'], ['960', '20159900'], ['960', '20160000'],
    ]);
    expect(ctx.getIntentQuote.mock.calls[2][0].sources).toEqual([{ chainId: 'EVM_1' }]);
    expect(ctx.getIntentBalances).toHaveBeenCalledTimes(1);
  });

  it.each(['rpc', 'quote', 'expired'] as const)('keeps prior settings when a refresh fails at %s', async (failure) => {
    const ctx = await setup(1, [balance(1, TOKEN, 40n), balance(11155111, TOKEN, 1000n)]);
    ctx.params.sources = [{ chainId: 1, tokenAddress: TOKEN }];
    await ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent: async ({ refresh, allow }) => {
      rpc.getFeeHistory.mockResolvedValue(history(200n));
      if (failure === 'rpc') rpc.getFeeHistory.mockRejectedValueOnce(new Error('fee RPC failed'));
      if (failure === 'quote') ctx.getIntentQuote.mockRejectedValueOnce(new Error('quote failed'));
      if (failure === 'expired') ctx.getIntentQuote.mockImplementationOnce(async (request) => {
        const expired = quote(request, 99);
        expired.quote.expiresAt = 1;
        return expired;
      });
      await expect(refresh([{ chainId: 11155111 }])).rejects.toThrow();
      allow();
    } } });
    expect(ctx.send.mock.calls[0][0]).toMatchObject({ tx: { gas: 120_000n }, feeParams: { maxFeePerGas: 168n } });
    expect(ctx.submitIntent.mock.calls[0]).toBeDefined();
  });

  it('updates native output funding when fees change', async () => {
    const ctx = await setup(1, [balance(1, ZERO_ADDRESS, 100n)]);
    ctx.params.toTokenAddress = ZERO_ADDRESS;
    ctx.params.execute.value = 20n;
    await ctx.client.swapAndExecute(ctx.params, { hooks: { onIntent: async ({ refresh, allow }) => {
      rpc.getFeeHistory.mockResolvedValue(history(200n));
      await refresh();
      allow();
    } } });
    expect(ctx.getIntentQuote.mock.calls.map(([request]) => request.output.amount)).toEqual(['20160920', '37440920']);
    expect(ctx.getIntentQuote.mock.calls.every(([request]) => !request.gasDrop)).toBe(true);
  });

  it('preserves beforeExecute overrides along with the prepared fee settings', async () => {
    const ctx = await setup();
    await ctx.client.swapAndExecute(ctx.params, {
      beforeExecute: async () => ({ data: '0xbeef', value: 1n, gas: 200_000n }),
    });
    expect(ctx.send.mock.calls[0][0]).toMatchObject({
      tx: { data: '0xbeef', value: 1n, gas: 200_000n }, feeParams: { maxFeePerGas: 168n },
    });
  });
});
