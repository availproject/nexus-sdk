import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { createNexusClient } from '../../src';
import type { EthereumProvider } from '../../src/domain';
import { normalizeIntentQuote } from '../../src/intent/normalize';
import type { IntentChain } from '../../src/intent/types';
import { makeMiddlewareClient } from '../helpers/middleware-client';
import { testDeployment } from '../fixtures/deployment';

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Hex;
const ETHEREUM_TOKEN = '0x0000000000000000000000000000000000000002' as Hex;
const BASE_TOKEN = '0x0000000000000000000000000000000000000006' as Hex;
const QUOTE_ID = `0x${'11'.repeat(32)}` as Hex;
const SIGNATURE = `0x${'22'.repeat(65)}` as Hex;

const intentChains: IntentChain[] = [
  {
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
    fees: { deposit: '0', fulfillment: '0', protocol: '0', solver: '0', caGas: '0' },
    expiry: '2000000000',
    rff: { quoteId: QUOTE_ID },
    rffHash: QUOTE_ID,
    signing: {
      type: 'personal_sign',
      messagePrefix: 'Sign this intent to proceed',
      message: '0x1234',
      hash: QUOTE_ID,
    },
    allowances: [],
    nativeTransactions: [],
    submitRequirements: {
      requiresIntentSignature: true,
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

describe.each(['mainnet', 'canary'] as const)('Better Intent public client on %s', (network) => {
  it('loads the mainnet intent catalog and executes a bridge through the API', async () => {
    const getIntentQuote = vi.fn().mockResolvedValue(quote());
    const middleware = makeMiddlewareClient({
      getDeployment: async () => testDeployment,
      getIntentChains: async () => intentChains,
      getIntentQuote,
      submitIntent: async () => ({ quoteId: QUOTE_ID, status: 'created' }),
      getIntentStatus: async () => ({
        id: QUOTE_ID,
        provider: 'nexus-v2',
        status: 'fulfilled',
        substatus: 'completed',
      }),
    });
    const client = createNexusClient({ network, internal: { middlewareClient: middleware } });
    await client.initialize();
    await client.setEVMProvider(provider());

    const result = await client.bridge(
      {
        toChainId: 1,
        toTokenSymbol: 'USDC',
        toAmountRaw: 1_000_000n,
        sources: [8453],
      },
      { pollingIntervalMs: 0 }
    );

    expect(getIntentQuote).toHaveBeenCalledWith({
      sender: ACCOUNT,
      tradeType: 'exactOutput',
      output: { chainId: 'EVM_1', token: ETHEREUM_TOKEN, amount: '1000000' },
      sources: [{ chainId: 'EVM_8453', tokens: [BASE_TOKEN] }],
      slippageBps: 50,
    });
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
      getDeployment: async () => testDeployment,
      getIntentChains: async () => intentChains,
      listIntentHistory,
    });
    const client = createNexusClient({ network, internal: { middlewareClient: middleware } });
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

  it('applies the Mayan filter to catalog and balance requests', async () => {
    const getIntentChains = vi.fn().mockResolvedValue(intentChains);
    const getIntentBalances = vi.fn().mockResolvedValue({ balances: [], errored: false });
    const middleware = makeMiddlewareClient({
      getDeployment: async () => testDeployment,
      getIntentChains,
      getIntentBalances,
    });
    const client = createNexusClient({
      network,
      forceMayan: true,
      internal: { middlewareClient: middleware },
    });

    await client.initialize();
    await client.setEVMProvider(provider());
    await client.getBalancesForSwap();

    expect(getIntentChains).toHaveBeenCalledWith({ providers: ['mayan'] });
    expect(getIntentBalances).toHaveBeenCalledWith(expect.stringMatching(/^0x0*aa$/i), {
      refresh: false,
      providers: ['mayan'],
    });
  });
});

describe('unsupported intent environment', () => {
  it('keeps execute metadata but rejects bridge operations on testnet', async () => {
    const middleware = makeMiddlewareClient({ getDeployment: async () => testDeployment });
    const client = createNexusClient({ network: 'testnet', internal: { middlewareClient: middleware } });
    await client.initialize();
    await client.setEVMProvider(provider());

    await expect(
      client.bridge({ toChainId: 1, toTokenSymbol: 'USDC', toAmountRaw: 1n })
    ).rejects.toMatchObject({ code: 'validation/environment_not_supported' });
  });
});
