import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex, TransactionReceipt } from 'viem';
import { createNexusClient, ExecutionError, UserActionError, ValidationError } from '../../src';
import { createBase } from '../../src/core/sdk/base';
import type { EthereumProvider } from '../../src/domain';
import { normalizeIntentQuote } from '../../src/intent/normalize';
import type { IntentChain, IntentEvent } from '../../src/intent/types';
import * as evm from '../../src/services/evm';
import { makeChain, makeChainList } from '../helpers/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';
import { testChains } from '../fixtures/chains';
import { NexusAnalyticsEvents as Events } from '../../src/analytics/events';

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Hex;
const ETHEREUM_TOKEN = '0x0000000000000000000000000000000000000002' as Hex;
const BASE_TOKEN = '0x0000000000000000000000000000000000000006' as Hex;
const QUOTE_ID = `0x${'11'.repeat(32)}` as Hex;
const SIGNATURE = `0x${'22'.repeat(65)}` as Hex;

const intentChains: IntentChain[] = [
  {
    ...testChains[0],
    id: 1,
    name: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    providers: ['nexus-v2'],
    tokens: [
      {
        chainId: 1,
        address: ETHEREUM_TOKEN,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        isNative: false,
        coingeckoId: 'usd-coin',
        providers: [{ id: 'nexus-v2', currencyId: 1 }],
      },
    ],
    capabilities: { intent: true, execute: false },
  },
  {
    ...testChains[0],
    id: 8453,
    name: 'Base',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    providers: ['nexus-v2'],
    tokens: [
      {
        chainId: 8453,
        address: BASE_TOKEN,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        isNative: false,
        coingeckoId: 'usd-coin',
        providers: [{ id: 'nexus-v2', currencyId: 1 }],
      },
    ],
    capabilities: { intent: true, execute: false },
  },
];

const quote = () =>
  normalizeIntentQuote({
    quoteId: QUOTE_ID,
    provider: 'nexus-v2',
    tradeType: 'exactOutput',
    input: [],
    output: { chainId: 'EVM_1', tokenAddress: ETHEREUM_TOKEN, amount: '1000000' },
    minAmountOut: '1000000',
    fees: { deposit: '0', fulfillment: '0', protocol: '0', solver: '0' },
    expiry: '2000000000',
    rff: { quoteId: QUOTE_ID },
    rffHash: QUOTE_ID,
    allowances: [],
    nativeTransactions: [],
    submitRequirements: {
      requiredSignatures: [{
        kind: 'intent', universe: 'EVM', signingScheme: 'personal_sign',
        data: { messagePrefix: 'Sign this intent to proceed', message: '0x1234', hash: QUOTE_ID },
      }],
      requiresApprovals: false,
      requiresNativeTxReceipts: false,
    },
  });

const provider = (): EthereumProvider => ({
  on: vi.fn() as unknown as EthereumProvider['on'],
  removeListener: vi.fn() as unknown as EthereumProvider['removeListener'],
  request: vi.fn(async ({ method }) => {
    if (method === 'eth_accounts') return [ACCOUNT];
    if (method === 'eth_chainId') return '0x1';
    if (method === 'personal_sign') return SIGNATURE;
    throw new Error(`Unexpected wallet request: ${method}`);
  }),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('Better Intent approval confirmations', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = async () => {
    const quoted = quote();
    const sources = [
      { chainId: 1, tokenAddress: ETHEREUM_TOKEN },
      { chainId: 8453, tokenAddress: BASE_TOKEN },
    ];
    quoted.execution.allowances = sources.map((source) => ({
      ...source, owner: ACCOUNT, spender: ACCOUNT, currentRaw: 0n,
      requiredRaw: 10n, deficitRaw: 10n, authorizationType: 'approve',
    }));
    quoted.quote.allowances = quoted.execution.allowances;
    quoted.quote.input = sources.map((source) => ({
      ...source, tokenSymbol: 'USDC', amountRaw: 10n, depositFeeRaw: 0n, totalRequiredRaw: 10n,
    }));
    quoted.quote.plan.steps.unshift(...sources.map((source) => ({
      ...source, id: `approval:${source.chainId}:${source.tokenAddress}`,
      type: 'erc20_approval' as const, spender: ACCOUNT, amountRaw: 10n,
    })));
    const hashes = [`0x${'44'.repeat(32)}`, `0x${'55'.repeat(32)}`] as const;
    const receipts = hashes.map(() => deferred<TransactionReceipt>());
    const waitForReceipt = vi.fn(async (chainId: number) => receipts[chainId === 1 ? 0 : 1]!.promise);
    vi.spyOn(evm, 'createPublicClientWithFallback').mockImplementation((chain) => ({
      waitForTransactionReceipt: () => waitForReceipt(chain.id),
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error('receipt unavailable')),
    }) as never);
    let currentChain = 1;
    const sendApproval = vi.fn(async (chainId: number): Promise<Hex> => hashes[chainId === 1 ? 0 : 1]);
    const signIntent = vi.fn(async () => SIGNATURE);
    const switchChain = vi.fn((chainId: number) => { currentChain = chainId; });
    const wallet = provider();
    wallet.request = vi.fn(async ({ method, params }) => {
      if (method === 'eth_accounts') return [ACCOUNT];
      if (method === 'eth_chainId') return `0x${currentChain.toString(16)}`;
      if (method === 'wallet_switchEthereumChain') {
        switchChain(Number((params as [{ chainId: string }])[0].chainId));
        return null;
      }
      if (method === 'eth_sendTransaction') return sendApproval(currentChain);
      if (method === 'personal_sign') return signIntent();
      throw new Error(`Unexpected wallet request: ${method}`);
    });
    const submitIntent = vi.fn(async () => ({ quoteId: QUOTE_ID, status: 'created' as const }));
    const base = createBase({
      clientId: 'test-client', network: 'mainnet',
      internal: { middlewareClient: makeMiddlewareClient({
        getIntentQuote: async () => quoted, submitIntent,
        getIntentStatus: async () => ({
          id: QUOTE_ID, provider: 'nexus-v2', status: 'fulfilled', substatus: 'completed', legs: [],
        }),
      }) },
    });
    base.setIntentCatalog(intentChains);
    base.setChainList(makeChainList([makeChain(1), makeChain(8453)], {
      contractAddress: ETHEREUM_TOKEN, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '',
    }));
    await base.setEvmProvider(wallet);
    const events: IntentEvent[] = [];
    const run = () => base.swapWithExactOut({
      toChainId: 1, toTokenAddress: ETHEREUM_TOKEN, toAmountRaw: 10n, sources,
    }, { onEvent: (event) => { events.push(event); } });
    const receipt = (index: number) => ({ status: 'success', transactionHash: hashes[index] }) as TransactionReceipt;
    return { run, quoted, receipts, receipt, hashes, events, sendApproval, signIntent, switchChain, waitForReceipt, submitIntent };
  };

  it('submits approvals sequentially while their confirmations overlap', async () => {
    const ctx = await setup();
    const firstSubmission = deferred<Hex>();
    ctx.sendApproval.mockImplementationOnce(() => firstSubmission.promise);
    const running = ctx.run();
    void running.catch(() => undefined);
    try {
      await vi.waitFor(() => expect(ctx.sendApproval).toHaveBeenCalledTimes(1));
      expect(ctx.switchChain).not.toHaveBeenCalled();
      firstSubmission.resolve(ctx.hashes[0]);
      await vi.waitFor(() => expect(ctx.sendApproval).toHaveBeenCalledTimes(2), { timeout: 300 });
      expect(ctx.sendApproval.mock.calls).toEqual([[1], [8453]]);
      await vi.waitFor(() => expect(ctx.waitForReceipt).toHaveBeenCalledTimes(2));
      expect(ctx.signIntent).not.toHaveBeenCalled();

      ctx.receipts[1]!.resolve(ctx.receipt(1));
      await vi.waitFor(() => expect(ctx.events).toContainEqual(expect.objectContaining({
        type: 'step', step: expect.objectContaining({ type: 'erc20_approval', chainId: 8453 }), state: 'completed',
      })));
      expect(ctx.signIntent).not.toHaveBeenCalled();
      ctx.receipts[0]!.resolve(ctx.receipt(0));
      const result = await running;
      expect(result.approvals.map((tx) => tx.txHash)).toEqual(ctx.hashes);
      expect(result.approvals.every((tx) => tx.receipt?.status === 'success')).toBe(true);
      expect(ctx.signIntent).toHaveBeenCalledTimes(1);
      expect(ctx.submitIntent).toHaveBeenCalledTimes(1);
    } finally {
      firstSubmission.resolve(ctx.hashes[0]);
      ctx.receipts.forEach((pending, index) => pending.resolve(ctx.receipt(index)));
      await running.catch(() => undefined);
    }
  });

  it.each(['reverted', 'unconfirmed'] as const)('retains approval outcomes after a %s receipt', async (failure) => {
    const ctx = await setup();
    const outcome = ctx.run().catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(ctx.sendApproval).toHaveBeenCalledTimes(2));
      if (failure === 'reverted') {
        ctx.receipts[0]!.resolve({ ...ctx.receipt(0), status: 'reverted' });
      } else {
        ctx.receipts[0]!.reject(new Error('RPC disconnected'));
      }
      await vi.waitFor(() => expect(ctx.events).toContainEqual(expect.objectContaining({
        type: 'step', step: expect.objectContaining({ chainId: 1 }), state: 'failed', committed: false,
      })));
      ctx.receipts[1]!.resolve(ctx.receipt(1));
      const error = await outcome;
      expect(error).toBeInstanceOf(ExecutionError);
      expect(error).toMatchObject({
        context: { service: 'rpc', chainId: 1, stepId: `approval:1:${ETHEREUM_TOKEN}`, stepType: 'erc20_approval' },
        details: {
          approvals: [
            { chainId: 1, tokenAddress: ETHEREUM_TOKEN, txHash: ctx.hashes[0], state: failure },
            { chainId: 8453, tokenAddress: BASE_TOKEN, txHash: ctx.hashes[1], state: 'confirmed' },
          ],
        },
      });
      expect(ctx.sendApproval).toHaveBeenCalledTimes(2);
      expect(ctx.signIntent).not.toHaveBeenCalled();
      expect(ctx.submitIntent).not.toHaveBeenCalled();
      const eventCount = ctx.events.length;
      await Promise.resolve();
      expect(ctx.events).toHaveLength(eventCount);
    } finally {
      ctx.receipts.forEach((pending, index) => pending.resolve(ctx.receipt(index)));
      await outcome;
    }
  });

  it('preserves the successful approval when the second wallet prompt is rejected', async () => {
    const ctx = await setup();
    ctx.sendApproval.mockResolvedValueOnce(ctx.hashes[0]).mockRejectedValueOnce({
      code: 4001, message: 'User rejected the request.',
    });
    const outcome = ctx.run().catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(ctx.sendApproval).toHaveBeenCalledTimes(2));
      ctx.receipts[0]!.resolve(ctx.receipt(0));
      const error = await outcome;
      expect((error as Error).message).toBe('User rejected sending the transaction.');
      expect(error).toBeInstanceOf(UserActionError);
      expect(error).toMatchObject({
        code: 'user_action/tx_send_denied',
        context: { service: 'wallet', chainId: 8453, stepId: `approval:8453:${BASE_TOKEN}` },
        details: { approvals: [{ chainId: 1, txHash: ctx.hashes[0], state: 'confirmed' }] },
      });
      expect(ctx.signIntent).not.toHaveBeenCalled();
      expect(ctx.submitIntent).not.toHaveBeenCalled();
    } finally {
      ctx.receipts.forEach((pending, index) => pending.resolve(ctx.receipt(index)));
      await outcome;
    }
  });

  it('checks quote expiry again after approval confirmation and before intent signing', async () => {
    const ctx = await setup();
    const outcome = ctx.run().catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(ctx.sendApproval).toHaveBeenCalledTimes(2));
      ctx.quoted.quote.expiresAt = Math.floor(Date.now() / 1000) - 1;
      ctx.receipts.forEach((pending, index) => pending.resolve(ctx.receipt(index)));
      expect(await outcome).toMatchObject({ message: expect.stringContaining('expired') });
      expect(ctx.signIntent).not.toHaveBeenCalled();
      expect(ctx.submitIntent).not.toHaveBeenCalled();
    } finally {
      ctx.receipts.forEach((pending, index) => pending.resolve(ctx.receipt(index)));
      await outcome;
    }
  });
});

describe('client identity', () => {
  it.each([undefined, {}, { clientId: null }, { clientId: 42 }, { clientId: '' }, { clientId: ' \t ' }])(
    'rejects missing or invalid clientId: %j',
    (config) => {
      expect(() => createNexusClient(config as Parameters<typeof createNexusClient>[0])).toThrowError(
        expect.objectContaining({
          constructor: ValidationError,
          message: expect.stringContaining('clientId must be a non-empty string'),
        })
      );
    }
  );
});

describe.each(['mainnet', 'canary'] as const)('Better Intent public client on %s', (network) => {
  it('correlates quote refresh, submit and polling from the public client', async () => {
    const getIntentQuote = vi.fn().mockResolvedValue(quote());
    const submitIntent = vi.fn().mockResolvedValue({ quoteId: QUOTE_ID, status: 'created' });
    const getIntentStatus = vi.fn().mockResolvedValue({ id: QUOTE_ID, provider: 'nexus-v2', status: 'fulfilled', substatus: 'completed', legs: [] });
    const client = createNexusClient({ clientId: 'test', network, analytics: { mode: 'on' },
      internal: { middlewareClient: makeMiddlewareClient({ getIntentChains: async () => intentChains, getIntentQuote, submitIntent, getIntentStatus }) } });
    try {
      await client.initialize();
      await client.setEVMProvider(provider());
      const result = await client.swapWithExactOut({ toChainId: 1, toTokenAddress: ETHEREUM_TOKEN, toAmountRaw: 1n }, {
        hooks: { onIntent: async ({ attemptId, refresh, allow }) => {
          expect(attemptId).toEqual(expect.any(String)); await refresh(); allow();
        } },
      });
      const id = result.attemptId;
      expect(id).toEqual(expect.any(String));
      expect(getIntentQuote.mock.calls.map((call) => call[1])).toEqual([id, id]);
      expect(submitIntent.mock.calls[0]?.[1]).toBe(id);
      expect(getIntentStatus.mock.calls[0]?.[1]).toBe(id);
    } finally { client.destroy(); }
  });

  it('returns available balances but reports a partial response separately', async () => {
    const client = createNexusClient({ clientId: 'test', network, analytics: { mode: 'on' },
      internal: { middlewareClient: makeMiddlewareClient({ getIntentChains: async () => intentChains,
        getIntentBalances: async () => ({ balances: [], errored: true }) }) } });
    try {
      await client.initialize(); await client.setEVMProvider(provider());
      const track = vi.spyOn(client.analytics.getProvider(), 'track');
      await expect(client.getBalancesForSwap()).resolves.toEqual([]);
      expect(track).toHaveBeenCalledWith(Events.BALANCES_FETCH_PARTIAL, expect.objectContaining({ 'balances.partial': true }));
      expect(track.mock.calls.some(([event]) => event === Events.BALANCES_FETCH_SUCCESS || event === Events.BALANCES_FETCH_FAILED)).toBe(false);
    } finally { client.destroy(); }
  });
  it('loads the mainnet intent catalog and executes a same-asset swap through the API', async () => {
    const getIntentQuote = vi.fn().mockResolvedValue(quote());
    const middleware = makeMiddlewareClient({
      getIntentChains: async () => intentChains,
      getIntentQuote,
      submitIntent: async () => ({ quoteId: QUOTE_ID, status: 'created' }),
      getIntentStatus: async () => ({
        id: QUOTE_ID,
        provider: 'nexus-v2',
        status: 'fulfilled',
        substatus: 'completed',
        legs: [],
      }),
    });
    const client = createNexusClient({
      clientId: 'test-client',
      network,
      internal: { middlewareClient: middleware },
    });
    await client.initialize();
    await client.setEVMProvider(provider());

    const result = await client.swapWithExactOut(
      {
        toChainId: 1,
        toTokenAddress: ETHEREUM_TOKEN,
        toAmountRaw: 1_000_000n,
        sources: [{ chainId: 8453, tokenAddress: BASE_TOKEN }],
      },
      { pollingIntervalMs: 0 }
    );

    expect(getIntentQuote).toHaveBeenCalledWith({
      sender: ACCOUNT,
      tradeType: 'exactOutput',
      output: { chainId: 'EVM_1', token: ETHEREUM_TOKEN, amount: '1000000' },
      sources: [{ chainId: 'EVM_8453', tokens: [BASE_TOKEN] }],
      slippageBps: 50,
    }, result.attemptId);
    expect(result).toMatchObject({
      intentId: QUOTE_ID,
      status: { status: 'fulfilled' },
      quote: { id: QUOTE_ID },
    });
    expect(client.getSupportedChains().find((chain) => chain.id === 1)?.capabilities).toEqual({
      intent: true,
      execute: true,
    });
  });

  it('lists normalized Nexus and Mayan intent history', async () => {
    const listIntentHistory = vi.fn().mockResolvedValue({
      intents: [
        {
          id: QUOTE_ID,
          provider: 'mayan',
          status: 'fulfilled',
          createdAt: 20,
          updatedAt: 21,
        },
      ],
      total: 1,
    });
    const middleware = makeMiddlewareClient({
      getIntentChains: async () => intentChains,
      listIntentHistory,
    });
    const client = createNexusClient({
      clientId: 'test-client',
      network,
      internal: { middlewareClient: middleware },
    });
    await client.initialize();
    await client.setEVMProvider(provider());

    await expect(client.listIntents({ page: 2, status: 'fulfilled' })).resolves.toEqual({
      intents: [
        {
          id: QUOTE_ID,
          provider: 'mayan',
          status: 'fulfilled',
          createdAt: 20,
          updatedAt: 21,
          explorerUrl: `https://nexus-v2.${network}.avail.so/explore/${QUOTE_ID}`,
        },
      ],
      total: 1,
    });
    expect(listIntentHistory).toHaveBeenCalledWith({
      user: ACCOUNT,
      status: 'fulfilled',
      limit: 20,
      offset: 20,
    });
  });

  it('loads the full catalog and requests balances without a provider filter', async () => {
    const getIntentChains = vi.fn().mockResolvedValue(intentChains);
    const getIntentBalances = vi.fn().mockResolvedValue({ balances: [], errored: false });
    const middleware = makeMiddlewareClient({
      getIntentChains,
      getIntentBalances,
    });
    const client = createNexusClient({
      clientId: 'test-client',
      network,
      internal: { middlewareClient: middleware },
    });

    await client.initialize();
    await client.setEVMProvider(provider());
    await client.getBalancesForSwap();

    expect(getIntentChains).toHaveBeenCalledExactlyOnceWith();
    expect(getIntentBalances).toHaveBeenCalledWith(expect.stringMatching(/^0x0*aa$/i), {
      refresh: false,
    });
  });
});

describe('unsupported intent environment', () => {
  it('keeps execute metadata but rejects swap operations on testnet', async () => {
    const middleware = makeMiddlewareClient({ getIntentChains: async () => testChains });
    const client = createNexusClient({
      clientId: 'test-client',
      network: 'testnet',
      internal: { middlewareClient: middleware },
    });
    await client.initialize();
    await client.setEVMProvider(provider());

    await expect(
      client.swapWithExactOut({ toChainId: 1, toTokenAddress: ETHEREUM_TOKEN, toAmountRaw: 1n })
    ).rejects.toMatchObject({ code: 'validation/environment_not_supported' });
  });
});
