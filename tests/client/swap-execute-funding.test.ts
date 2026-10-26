import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, type Hex } from 'viem';
import { createNexusClient, type SwapAndExecuteParams } from '../../src';
import { ZERO_ADDRESS } from '../../src/domain';
import ERC20ABI from '../../src/domain/erc20-abi';
import * as runtime from '../../src/execute/runtime';
import { normalizeIntentQuote } from '../../src/intent/normalize';
import type { IntentBalance, IntentQuoteRequest } from '../../src/intent/types';
import { testChains } from '../fixtures/chains';
import { makeTokenFetcher } from '../helpers/catalog';
import { makeMiddlewareClient } from '../helpers/middleware-client';

const rpc = vi.hoisted(() => ({
  readContract: vi.fn(),
  balanceOf: vi.fn(),
  getBalance: vi.fn(),
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

const quote = (request: IntentQuoteRequest, index: number, amount = request.output.amount ?? '1000', minimum = amount) => {
  const id = `0x${index.toString(16).padStart(64, '0')}` as Hex;
  return normalizeIntentQuote({
    quoteId: id, provider: 'nexus-v2', tradeType: request.tradeType, input: [],
    quoteSignature: `0x${index.toString(16).padStart(2, '0').repeat(65)}`,
    isExecutable: true, executionWarnings: [],
    output: { chainId: request.output.chainId, tokenAddress: request.output.token,
      amount, amountUsd: '1' },
    minAmountOut: minimum, minAmountOutUsd: '1',
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
  actualBalanceRaw: balanceRaw, usableBalanceRaw: balanceRaw,
  chainId, tokenAddress, balanceRaw, isNative: tokenAddress === ZERO_ADDRESS, verified: true,
  symbol: tokenAddress === ZERO_ADDRESS ? 'ETH' : 'USDC',
  name: tokenAddress === ZERO_ADDRESS ? 'Ether' : 'USD Coin',
  decimals: tokenAddress === ZERO_ADDRESS ? 18 : 6,
  providers: [{ id: 'nexus-v2' }], usable: true, valueUsd: null, priceSource: null,
});

const clients: ReturnType<typeof createNexusClient>[] = [];
beforeEach(() => {
  rpc.balanceOf.mockReset().mockResolvedValue(0n);
  rpc.getBalance.mockReset().mockResolvedValue(0n);
  rpc.readContract.mockReset().mockImplementation(async (call) => {
    const { functionName } = call;
    if (functionName === 'balanceOf') return rpc.balanceOf(call);
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
    ...(chainId === 8453 ? [] : [{ ...structuredClone(testChains[0]), id: 8453,
      tokens: testChains[0].tokens.map((token) => ({ ...token, chainId: 8453 })) }]),
  ];
  let quoteIndex = 0;
  let delivery: { request: IntentQuoteRequest; amountRaw: bigint } | undefined;
  const getIntentQuote = vi.fn(async (request: IntentQuoteRequest) => quote(request, ++quoteIndex));
  const getIntentBalances = vi.fn(async () => ({ balances, errored: false }));
  const submitIntent = vi.fn(async () => ({ quoteId: '0x11' as Hex, status: 'created' as const }));
  rpc.balanceOf.mockImplementation(async ({ address }) => {
    const initial = balances.find((entry) => entry.chainId === chainId && entry.tokenAddress === address)?.actualBalanceRaw ?? 0n;
    return initial + (delivery && delivery.request.output.token === address ? delivery.amountRaw : 0n);
  });
  rpc.getBalance.mockImplementation(async () => {
    const initial = balances.find((entry) => entry.chainId === chainId && entry.isNative)?.actualBalanceRaw ?? 0n;
    const spent = delivery?.request.input?.reduce((total, source) =>
      source.chainId === `EVM_${chainId}` && source.token === ZERO_ADDRESS
        ? total + BigInt(source.amount) : total, 0n) ?? 0n;
    return initial - spent + (delivery?.request.output.token === ZERO_ADDRESS ? delivery.amountRaw : 0n)
      + BigInt(delivery?.request.gasDrop?.amount ?? '0');
  });
  const client = createNexusClient({ clientId: 'swap-execute-funding', analytics: { enabled: false },
    internal: { middlewareClient: makeMiddlewareClient({
      getIntentChains: async () => chains,
      getIntentTokens: makeTokenFetcher(chains), getIntentQuote, getIntentBalances, submitIntent,
      getIntentStatus: async (id) => {
        for (let index = 0; index < getIntentQuote.mock.results.length; index++) {
          const response = await Promise.resolve(getIntentQuote.mock.results[index].value).catch(() => undefined);
          if (response?.quote.id === id) delivery = {
            request: getIntentQuote.mock.calls[index][0], amountRaw: response.quote.output.amountRaw,
          };
        }
        return { id, provider: 'nexus-v2', status: 'fulfilled', substatus: 'completed', legs: [] };
      },
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

describe('actual exact-input execution amounts', () => {
  it('keeps local inputs and deposits the measured proceeds plus the selected local amount', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 10_000_000n), balance(1, ZERO_ADDRESS, 100_000_000n)]);
    ctx.getIntentQuote.mockImplementation(async (request) => quote(request, 1, '125000000', '120000000'));
    rpc.balanceOf.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(140_000_000n);
    const beforeExecute = vi.fn(async ({ receivedAmountRaw, executeAmountRaw }) => {
      expect(receivedAmountRaw).toBe(130_000_000n);
      expect(executeAmountRaw).toBe(135_000_000n);
      expect(ctx.submitIntent).toHaveBeenCalledOnce();
      expect(ctx.send).not.toHaveBeenCalled();
      return { data: '0xbeef' as const };
    });
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [
        { chainId: 1, tokenAddress: TOKEN, amountRaw: 5_000_000n },
        { chainId: 11155111, tokenAddress: ZERO_ADDRESS, amountRaw: 100_000_000_000_000_000n },
        { chainId: 8453, tokenAddress: TOKEN, amountRaw: 4_000_000n },
      ],
      execute: { ...ctx.params.execute,
        tokenApproval: { toTokenAddress: TOKEN, amount: 120_000_000n, spender: TARGET } },
    }, { beforeExecute });
    expect(ctx.getIntentQuote.mock.calls[0][0].input).toEqual([
      { chainId: 'EVM_11155111', token: ZERO_ADDRESS, amount: '100000000000000000' },
      { chainId: 'EVM_8453', token: TOKEN, amount: '4000000' },
    ]);
    expect(beforeExecute).toHaveBeenCalledOnce();
    expect(rpc.balanceOf).toHaveBeenCalledTimes(2);
    expect(ctx.send.mock.calls[0][0]).toMatchObject({
      tx: { data: '0xbeef' },
      approvalTx: { data: encodeFunctionData({ abi: ERC20ABI, functionName: 'approve', args: [TARGET, 135_000_000n] }) },
      plan: { approvalStep: { amountRaw: '135000000' } },
    });
  });

  it('uses a fresh balance after review rather than the middleware snapshot', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 10_000_000n), balance(1, ZERO_ADDRESS, 100_000_000n)]);
    rpc.balanceOf.mockResolvedValueOnce(11_000_000n).mockResolvedValueOnce(140_000_000n);
    const beforeExecute = vi.fn(async (amounts) => {
      expect(amounts).toEqual({ receivedAmountRaw: 129_000_000n, executeAmountRaw: 134_000_000n });
      return {};
    });
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: TOKEN, amountRaw: 5_000_000n },
        { chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    }, { hooks: { onIntent: ({ allow }) => {
      expect(rpc.balanceOf).not.toHaveBeenCalled();
      allow();
    } }, beforeExecute });
    expect(beforeExecute).toHaveBeenCalledOnce();
  });

  it('skips swapping when every selected input is already the destination token', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 10_000_000n), balance(1, ZERO_ADDRESS, 100_000_000n)]);
    const beforeExecute = vi.fn(async (amounts) => {
      expect(amounts).toEqual({ receivedAmountRaw: 0n, executeAmountRaw: 5_000_000n });
      return {};
    });
    const result = await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: TOKEN, amountRaw: 5_000_000n }],
      execute: ctx.params.execute,
    }, { hooks: { onIntent: ({ intent, allow }) => {
      expect(intent.swapRequired).toBe(false);
      expect(intent.executeRequirement.token.amountRaw).toBe(5_000_000n);
      allow();
    } }, beforeExecute });
    expect(result.swapSkipped).toBe(true);
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.submitIntent).not.toHaveBeenCalled();
    expect(beforeExecute).toHaveBeenCalledOnce();
  });

  it('reserves approval gas when the actual amount can exceed the existing allowance', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 10_000_000n)]);
    const readContract = rpc.readContract.getMockImplementation();
    rpc.readContract.mockImplementation((call) => call.functionName === 'allowance'
      ? Promise.resolve(130_000_000n) : readContract?.(call));
    rpc.balanceOf.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(140_000_000n);
    ctx.getIntentQuote.mockImplementation(async (request) => quote(request, 1, '125000000', '120000000'));
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: TOKEN, amountRaw: 5_000_000n },
        { chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: { ...ctx.params.execute,
        tokenApproval: { toTokenAddress: TOKEN, amount: 120_000_000n, spender: TARGET } },
    }, { hooks: { onIntent: ({ intent, allow }) => {
      expect(intent.executeRequirement.tokenApproval?.amountRaw).toBe(125_000_000n);
      allow();
    } } });
    expect(ctx.getIntentQuote.mock.calls[0][0].gasDrop).toEqual({ amount: '30240000' });
    expect(ctx.send.mock.calls[0][0].approvalTx).toMatchObject({
      gas: 60_000n,
      data: encodeFunctionData({ abi: ERC20ABI, functionName: 'approve', args: [TARGET, 135_000_000n] }),
    });
  });

  it('skips the reserved approval when allowance covers the actual amount', async () => {
    const ctx = await setup();
    const readContract = rpc.readContract.getMockImplementation();
    rpc.readContract.mockImplementation((call) => call.functionName === 'allowance'
      ? Promise.resolve(2000n) : readContract?.(call));
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: { ...ctx.params.execute,
        tokenApproval: { toTokenAddress: TOKEN, amount: 0n, spender: TARGET } },
    });
    expect(ctx.getIntentQuote.mock.calls[0][0].gasDrop).toEqual({ amount: '30240000' });
    expect(ctx.send.mock.calls[0][0].approvalTx).toBeNull();
    expect(ctx.send.mock.calls[0][0].plan.approvalStep).toBeUndefined();
  });

  it('does not submit a swap when the selected local amount is no longer available', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 10_000_000n), balance(1, ZERO_ADDRESS, 100_000_000n)]);
    rpc.balanceOf.mockResolvedValue(4_000_000n);
    await expect(ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: TOKEN, amountRaw: 5_000_000n },
        { chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    })).rejects.toMatchObject({ code: 'validation/insufficient_balance' });
    expect(ctx.submitIntent).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it.each([0n, -1n])('does not execute when fulfillment leaves a non-positive balance difference %s', async (difference) => {
    const ctx = await setup(1, [balance(1, TOKEN, 10_000_000n)]);
    rpc.balanceOf.mockResolvedValueOnce(10_000_000n).mockResolvedValueOnce(10_000_000n + difference);
    const beforeExecute = vi.fn(async () => ({}));
    await expect(ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    }, { beforeExecute })).rejects.toMatchObject({ code: 'validation/insufficient_balance' });
    expect(ctx.submitIntent).toHaveBeenCalledOnce();
    expect(beforeExecute).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('reports destination balance RPC failures without executing', async () => {
    const ctx = await setup();
    rpc.balanceOf.mockResolvedValueOnce(0n).mockRejectedValueOnce(new Error('balance RPC unavailable'));
    const beforeExecute = vi.fn(async () => ({}));
    await expect(ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    }, { beforeExecute })).rejects.toMatchObject({
      code: 'execution/error', context: { service: 'rpc', chainId: 1 },
      message: expect.stringContaining('balance RPC unavailable'),
    });
    expect(ctx.submitIntent).toHaveBeenCalledOnce();
    expect(beforeExecute).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('requires native gas when only local ERC-20 inputs are selected', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 10_000_000n)]);
    await expect(ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: TOKEN, amountRaw: 5_000_000n }],
      execute: ctx.params.execute,
    })).rejects.toMatchObject({ code: 'validation/insufficient_balance' });
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('uses only execute gas for fully local inputs when allowance already covers the known amount', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 10_000_000n), balance(1, ZERO_ADDRESS, 20_160_000n)]);
    const readContract = rpc.readContract.getMockImplementation();
    rpc.readContract.mockImplementation((call) => call.functionName === 'allowance'
      ? Promise.resolve(5_000_000n) : readContract?.(call));
    const result = await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: TOKEN, amountRaw: 5_000_000n }],
      execute: { ...ctx.params.execute,
        tokenApproval: { toTokenAddress: TOKEN, amount: 0n, spender: TARGET } },
    });
    expect(result.swapSkipped).toBe(true);
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.send.mock.calls[0][0].approvalTx).toBeNull();
  });

  it('reserves gas from local native inputs before supplying the execution amount', async () => {
    const ctx = await setup(1, [balance(1, ZERO_ADDRESS, 30_000_000n)]);
    const result = await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: ZERO_ADDRESS,
      sources: [{ chainId: 1, tokenAddress: ZERO_ADDRESS, amountRaw: 30_000_000n }],
      execute: ctx.params.execute,
    }, { beforeExecute: async (amounts) => {
      expect(amounts).toEqual({ receivedAmountRaw: 0n, executeAmountRaw: 9_840_000n });
      return { value: amounts.executeAmountRaw };
    } });
    expect(result.swapSkipped).toBe(true);
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.send.mock.calls[0][0].tx.value).toBe(9_840_000n);
    expect(rpc.getBalance).toHaveBeenCalledOnce();
  });

  it('uses actual native output and keeps enough for execution gas', async () => {
    const ctx = await setup(1, [balance(1, ZERO_ADDRESS, 100n)]);
    ctx.getIntentQuote.mockImplementation(async (request) => quote(request, 1, '30000000', '25000000'));
    const beforeExecute = vi.fn(async (amounts) => {
      expect(amounts).toEqual({ receivedAmountRaw: 30_000_000n, executeAmountRaw: 9_840_100n });
      return { value: amounts.executeAmountRaw };
    });
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: ZERO_ADDRESS,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    }, { beforeExecute });
    expect(beforeExecute).toHaveBeenCalledOnce();
    expect(rpc.getBalance).toHaveBeenCalledTimes(2);
    expect(rpc.balanceOf).not.toHaveBeenCalled();
    expect(ctx.send.mock.calls[0][0].tx.value).toBe(9_840_100n);
  });

  it('validates missing token addresses on destination-chain sources', async () => {
    const ctx = await setup();
    await expect(ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: null, amountRaw: 2000n }],
      execute: ctx.params.execute,
    } as unknown as SwapAndExecuteParams)).rejects.toMatchObject({ code: 'validation/invalid_input' });
    expect(ctx.submitIntent).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });
});

describe('swap execution trade modes', () => {
  it.each([undefined, 'exactOutput'] as const)('retains exact-output funding for tradeType %s', async (tradeType) => {
    const ctx = await setup(1, [balance(1, TOKEN, 40n), balance(1, ZERO_ADDRESS, 100n)]);
    await ctx.client.swapAndExecute({ ...ctx.params, tradeType });
    expect(ctx.getIntentQuote.mock.calls[0][0]).toMatchObject({
      tradeType: 'exactOutput', output: { amount: '960' }, gasDrop: { amount: '20159900' },
    });
  });

  it('quotes fixed source amounts with a gas drop and derives output from the minimum quote', async () => {
    const ctx = await setup();
    ctx.getIntentQuote.mockImplementation(async (request) => quote(request, 1, '1000', '950'));
    const result = await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    }, { slippageBps: 100, hooks: { onIntent: ({ intent, allow }) => {
      expect(intent).toMatchObject({
        swapRequired: true, executeRequirement: { token: { amountRaw: 950n } },
        shortfall: { token: { amountRaw: 950n }, gas: { amountRaw: 20_160_000n } },
      });
      allow();
    } } });
    expect(ctx.getIntentQuote).toHaveBeenCalledExactlyOnceWith({
      sender: ACCOUNT, tradeType: 'exactInput',
      input: [{ chainId: 'EVM_11155111', token: TOKEN, amount: '2000' }],
      output: { chainId: 'EVM_1', token: TOKEN }, slippageBps: 100,
      gasDrop: { amount: '20160000' },
    }, expect.any(String));
    expect(result.swapSkipped).toBe(false);
    expect(ctx.submitIntent).toHaveBeenCalledOnce();
    expect(ctx.send).toHaveBeenCalledOnce();
  });

  it('spends exact inputs even when destination balances already cover execution', async () => {
    const ctx = await setup(1, [balance(1, TOKEN, 5000n), balance(1, ZERO_ADDRESS, 30_000_000n)]);
    const result = await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    });
    expect(result.swapSkipped).toBe(false);
    expect(ctx.getIntentQuote.mock.calls[0][0].tradeType).toBe('exactInput');
    expect(ctx.getIntentQuote.mock.calls[0][0].gasDrop).toBeUndefined();
    expect(ctx.submitIntent).toHaveBeenCalledOnce();
  });

  it('does not reuse destination native funds that the exact input spends', async () => {
    const ctx = await setup(1, [balance(1, ZERO_ADDRESS, 30_000_000n)]);
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: ZERO_ADDRESS, amountRaw: 25_000_000n }],
      execute: ctx.params.execute,
    });
    expect(ctx.getIntentQuote.mock.calls[0][0].gasDrop).toEqual({ amount: '15160000' });
  });

  it.each([TOKEN, ZERO_ADDRESS])('preserves USD prices when allocating destination source %s', async (sourceToken) => {
    const ctx = await setup(1, [
      { ...balance(1, TOKEN, 2000n), valueUsd: 2 },
      { ...balance(1, ZERO_ADDRESS, 30_000_000n), valueUsd: 3 },
    ]);
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 1, tokenAddress: sourceToken,
        amountRaw: sourceToken === TOKEN ? 1500n : 25_000_000n }],
      execute: ctx.params.execute,
    }, { hooks: { onIntent: ({ intent, allow }) => {
      expect(intent.executeRequirement.token.valueUsd).toBe(sourceToken === TOKEN ? '1.5' : '1');
      expect(intent.available.token.valueUsd).toBe(sourceToken === TOKEN ? '1.5' : '0');
      expect(intent.available.gas.valueUsd).toBe(sourceToken === TOKEN ? '3' : '0.5');
      allow();
    } } });
  });

  it('refreshes exact-input amounts and fees together while retaining the last successful selection', async () => {
    const ctx = await setup();
    let index = 0;
    ctx.getIntentQuote.mockImplementation(async (request) => {
      const amount = request.input?.[0].amount === '3000' ? '1500' : '1000';
      return quote(request, ++index, amount, (BigInt(amount) - 50n).toString());
    });
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    }, { hooks: { onIntent: async ({ intent, refresh, allow }) => {
      expect(intent.executeRequirement.token.amountRaw).toBe(950n);
      rpc.getFeeHistory.mockResolvedValue(history(200n));
      const next = await refresh([{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 3000n }]);
      expect(next.executeRequirement.token.amountRaw).toBe(1450n);
      expect(next.shortfall.gas.amountRaw).toBe(37_440_000n);
      expect((await refresh()).executeRequirement.token.amountRaw).toBe(1450n);
      await expect(refresh([])).rejects.toThrow('exact-input swap requires sources');
      expect((await refresh()).executeRequirement.token.amountRaw).toBe(1450n);
      allow();
    } } });
    expect(ctx.getIntentQuote.mock.calls.map(([request]) => request.input?.[0].amount))
      .toEqual(['2000', '3000', '3000', '3000']);
    expect(ctx.getIntentQuote.mock.calls.every(([request]) => request.tradeType === 'exactInput')).toBe(true);
    expect(ctx.submitIntent).toHaveBeenCalledWith(expect.objectContaining({
      rff: { quoteId: `0x${'4'.padStart(64, '0')}` },
    }), expect.any(String));
    expect(ctx.getIntentBalances).toHaveBeenCalledOnce();
    expect(ctx.send.mock.calls[0][0].feeParams).toMatchObject({ maxFeePerGas: 312n });
  });

  it.each([
    { sources: undefined, message: 'exact-input swap requires sources' },
    { sources: [], message: 'exact-input swap requires sources' },
    { sources: [{ chainId: 11155111, tokenAddress: TOKEN }], message: 'requires amountRaw on every source' },
    { sources: [{ chainId: 11155111, amountRaw: 2000n }], message: 'requires tokenAddress on every source' },
    { sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 0n }], message: 'source amountRaw must be greater than zero' },
    { sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: -1n }], message: 'source amountRaw must be greater than zero' },
    { sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000 }], message: 'source amountRaw must be a bigint' },
    { sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: '2000' }], message: 'source amountRaw must be a bigint' },
    { sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: null }], message: 'source amountRaw must be a bigint' },
  ])('rejects invalid exact inputs: $message', async ({ sources, message }) => {
    const ctx = await setup();
    await expect(ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: TOKEN,
      sources, execute: ctx.params.execute,
    } as unknown as SwapAndExecuteParams)).rejects.toMatchObject({
      code: 'validation/invalid_input', message: expect.stringContaining(message),
    });
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.submitIntent).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0n, -1n, 1000, '1000'])('rejects an invalid exact-output amount %s before funding', async (toAmountRaw) => {
    const ctx = await setup();
    await expect(ctx.client.swapAndExecute({
      ...ctx.params, toAmountRaw,
    } as unknown as SwapAndExecuteParams)).rejects.toMatchObject({
      code: 'validation/invalid_input', message: expect.stringContaining('toAmountRaw'),
    });
    expect(ctx.getIntentBalances).not.toHaveBeenCalled();
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('rejects an unsupported trade type before funding', async () => {
    const ctx = await setup();
    await expect(ctx.client.swapAndExecute({
      ...ctx.params, tradeType: 'unknown',
    } as unknown as SwapAndExecuteParams)).rejects.toMatchObject({
      code: 'validation/invalid_input', message: expect.stringContaining('tradeType'),
    });
    expect(ctx.getIntentBalances).not.toHaveBeenCalled();
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('rejects a caller-supplied destination amount in exact-input mode', async () => {
    const ctx = await setup();
    await expect(ctx.client.swapAndExecute({
      ...ctx.params, tradeType: 'exactInput',
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
    } as unknown as SwapAndExecuteParams)).rejects.toMatchObject({
      code: 'validation/invalid_input', message: expect.stringContaining('toAmountRaw'),
    });
    expect(ctx.getIntentBalances).not.toHaveBeenCalled();
    expect(ctx.getIntentQuote).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('reserves execute value and gas from the minimum native output', async () => {
    const ctx = await setup(1, [balance(1, ZERO_ADDRESS, 100n)]);
    ctx.getIntentQuote.mockImplementation(async (request) => quote(request, 1, '30000000', '25000000'));
    await ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: ZERO_ADDRESS,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: { ...ctx.params.execute, value: 1_000_000n },
    }, { hooks: { onIntent: ({ intent, allow }) => {
      expect(intent.executeRequirement.token.amountRaw).toBe(3_840_100n);
      expect(intent.shortfall).toMatchObject({
        token: { amountRaw: 3_840_100n }, gas: { amountRaw: 21_159_900n },
      });
      allow();
    } } });
    expect(ctx.getIntentQuote.mock.calls[0][0].gasDrop).toBeUndefined();
    expect(ctx.send).toHaveBeenCalledOnce();
  });

  it('rejects native output whose minimum cannot cover execution before submitting funds', async () => {
    const ctx = await setup(1, [balance(11155111, TOKEN, 2000n)]);
    ctx.getIntentQuote.mockImplementation(async (request) => quote(request, 1, '30000000', '1000'));
    await expect(ctx.client.swapAndExecute({
      tradeType: 'exactInput', toChainId: 1, toTokenAddress: ZERO_ADDRESS,
      sources: [{ chainId: 11155111, tokenAddress: TOKEN, amountRaw: 2000n }],
      execute: ctx.params.execute,
    })).rejects.toMatchObject({
      code: 'validation/insufficient_balance',
      message: expect.stringContaining('minimum native output cannot cover execution'),
    });
    expect(ctx.submitIntent).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });
});

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
    expect(ctx.submitIntent).toHaveBeenCalledWith(expect.objectContaining({
      rff: { quoteId: `0x${'3'.padStart(64, '0')}` },
      quoteSignature: `0x${'03'.repeat(65)}`,
      fees: expect.objectContaining({ solver: '0', solverUsd: '0' }),
    }), expect.any(String));
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
