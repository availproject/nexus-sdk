import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toHex } from 'viem';
import type { BridgeProvider } from '@avail-project/nexus-types';
import type { BridgeTokenBalance, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { calculateMaxForBridge } from '../../src/bridge/max';
import type { BridgeMaxParams } from '../../src/bridge/types';
import type { MayanQuote } from '../../src/transport';
import { makeChain, makeChainList } from '../helpers/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

vi.mock('../../src/services/balances', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/balances')>();
  return { ...actual, getBalancesForBridge: vi.fn() };
});

import { getBalancesForBridge } from '../../src/services/balances';

const USDC: TokenInfo = {
  contractAddress: '0x0000000000000000000000000000000000000001',
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
  currencyId: 7,
  mayanEnabled: true,
};

const makeChainBalance = (input: {
  balance: string;
  value: string;
  chainId: number;
  chainName: string;
  contractAddress?: `0x${string}`;
  decimals?: number;
  symbol?: string;
}) => ({
  balance: input.balance,
  value: input.value,
  symbol: input.symbol ?? 'USDC',
  chain: { id: input.chainId, logo: '', name: input.chainName },
  contractAddress: input.contractAddress ?? USDC.contractAddress,
  decimals: input.decimals ?? USDC.decimals,
  universe: Universe.ETHEREUM,
});

const makeAsset = (input: {
  balance: string;
  value: string;
  chainBalances: Array<ReturnType<typeof makeChainBalance>>;
  decimals?: number;
  symbol?: string;
  currencyId?: number;
}): BridgeTokenBalance =>
  ({
    balance: input.balance,
    value: input.value,
    chainBalances: input.chainBalances,
    decimals: input.decimals ?? USDC.decimals,
    logo: '',
    name: input.symbol ?? 'USDC',
    symbol: input.symbol ?? 'USDC',
    currencyId: input.currencyId ?? USDC.currencyId,
  }) as BridgeTokenBalance;

// Quote with zero deposit + fulfillment fees for the listed source chains.
const zeroFeeQuote = (srcChainIds: number[], dstChainId: number, tokenAddress = USDC.contractAddress) => ({
  fulfillmentBps: 0,
  sources: srcChainIds.map((chainId) => ({
    chainId,
    tokenAddress,
    depositFeeUsd: '0',
    depositFeeToken: '0',
    depositMayanFeeUsd: '0',
    depositMayanFeeToken: '0',
  })),
  destination: {
    chainId: dstChainId,
    tokenAddress,
    fulfillmentFeeUsd: '0',
    fulfillmentFeeToken: '0',
  },
});

// Linear Mayan mock: minReceived(human) = inputAmount(human) * rate.
const rateMayanQuotes =
  (rate: number, decimals = USDC.decimals) =>
  async (request: { sources: { chain_id: string; contract_address: string; amount: string }[]; destination: { chain_id: string; contract_address: string } }) => ({
    destination: {
      chainId: Number(BigInt(request.destination.chain_id)),
      tokenAddress: request.destination.contract_address as `0x${string}`,
    },
    quotes: request.sources.map((source) => ({
      source: {
        chainId: Number(BigInt(source.chain_id)),
        tokenAddress: source.contract_address as `0x${string}`,
        amount: source.amount,
      },
      mayanQuote: {
        minReceived: (Number(source.amount) / 10 ** decimals) * rate,
        protocolBps: 0,
      } as MayanQuote,
    })),
  });

const makeOptions = (overrides: {
  provider?: BridgeProvider;
  quote?: ReturnType<typeof zeroFeeQuote>;
  mayanQuotes?: ReturnType<typeof rateMayanQuotes>;
  forceMayan?: boolean;
  token?: TokenInfo;
  chains?: ReturnType<typeof makeChain>[];
}) => {
  const token = overrides.token ?? USDC;
  const chains = overrides.chains ?? [
    makeChain(1, 'Ethereum'),
    makeChain(10, 'Optimism'),
    makeChain(137, 'Polygon'),
    makeChain(42161, 'Arbitrum'),
    makeChain(8453, 'Base'),
  ];
  return {
    chainList: makeChainList(chains, token),
    evmAddress: '0x000000000000000000000000000000000000aaaa' as `0x${string}`,
    forceMayan: overrides.forceMayan,
    middlewareClient: makeMiddlewareClient({
      getQuote: async () => overrides.quote ?? zeroFeeQuote([], 0),
      getBridgeProvider: async () => ({ provider: overrides.provider ?? 'nexus' }),
      ...(overrides.mayanQuotes ? { getMayanQuotes: overrides.mayanQuotes as never } : {}),
    }),
  };
};

describe('calculateMaxForBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nexus path: returns the full usable amount across sources', async () => {
    vi.mocked(getBalancesForBridge).mockResolvedValue([
      makeAsset({
        balance: '150',
        value: '150.00',
        chainBalances: [
          makeChainBalance({ balance: '100', value: '100.00', chainId: 1, chainName: 'Ethereum' }),
          makeChainBalance({ balance: '50', value: '50.00', chainId: 10, chainName: 'Optimism' }),
        ],
      }),
    ]);

    const input: BridgeMaxParams = { toChainId: 137, toTokenSymbol: 'USDC' };
    const result = await calculateMaxForBridge(input, makeOptions({ quote: zeroFeeQuote([1, 10], 137) }));

    expect(result.provider).toBe('nexus');
    expect(result.maxAmount).toBe('150.000000');
    expect(result.maxAmountRaw).toBe(150_000_000n);
    expect(result.symbol).toBe('USDC');
    expect(result.decimals).toBe(6);
    expect(result.sources.map((s) => s.chainId).sort()).toEqual([1, 10]);
  });

  it('nexus path: does not deduct a minimum safety amount', async () => {
    vi.mocked(getBalancesForBridge).mockResolvedValue([
      makeAsset({
        balance: '50',
        value: '50.00',
        chainBalances: [makeChainBalance({ balance: '50', value: '50.00', chainId: 1, chainName: 'Ethereum' })],
      }),
    ]);

    const result = await calculateMaxForBridge(
      { toChainId: 137, toTokenSymbol: 'USDC' },
      makeOptions({ quote: zeroFeeQuote([1], 137) })
    );

    expect(result.maxAmount).toBe('50.000000');
    expect(result.maxAmountRaw).toBe(50_000_000n);
  });

  it('nexus path: returns the full usable amount for non-stables', async () => {
    const WETH: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000002',
      decimals: 18,
      logo: '',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      currencyId: 9,
      mayanEnabled: true,
    };
    vi.mocked(getBalancesForBridge).mockResolvedValue([
      makeAsset({
        balance: '1',
        value: '2500.00',
        decimals: 18,
        symbol: 'WETH',
        currencyId: 9,
        chainBalances: [
          makeChainBalance({
            balance: '1',
            value: '2500.00',
            chainId: 1,
            chainName: 'Ethereum',
            contractAddress: WETH.contractAddress,
            decimals: 18,
            symbol: 'WETH',
          }),
        ],
      }),
    ]);

    const result = await calculateMaxForBridge(
      { toChainId: 137, toTokenSymbol: 'WETH' },
      makeOptions({ token: WETH, quote: zeroFeeQuote([1], 137, WETH.contractAddress) })
    );

    expect(result.maxAmount).toBe('1.000000000000000000');
    expect(result.decimals).toBe(18);
    expect(result.symbol).toBe('WETH');
  });

  it('mayan path: sums minReceived across eligible legs quoted at full balance', async () => {
    vi.mocked(getBalancesForBridge).mockResolvedValue([
      makeAsset({
        balance: '200',
        value: '200.00',
        chainBalances: [
          makeChainBalance({ balance: '100', value: '100.00', chainId: 42161, chainName: 'Arbitrum' }),
          makeChainBalance({ balance: '100', value: '100.00', chainId: 8453, chainName: 'Base' }),
        ],
      }),
    ]);

    const result = await calculateMaxForBridge(
      { toChainId: 10, toTokenSymbol: 'USDC' },
      makeOptions({
        provider: 'mayan',
        quote: zeroFeeQuote([42161, 8453], 10),
        mayanQuotes: rateMayanQuotes(0.99),
      })
    );

    expect(result.provider).toBe('mayan');
    expect(result.maxAmount).toBe('198.000000');
    expect(result.maxAmountRaw).toBe(198_000_000n);
    expect(result.sources.map((s) => s.chainId).sort((a, b) => a - b)).toEqual([8453, 42161]);
  });

  it('restricts to the requested source chains', async () => {
    vi.mocked(getBalancesForBridge).mockResolvedValue([
      makeAsset({
        balance: '150',
        value: '150.00',
        chainBalances: [
          makeChainBalance({ balance: '100', value: '100.00', chainId: 1, chainName: 'Ethereum' }),
          makeChainBalance({ balance: '50', value: '50.00', chainId: 10, chainName: 'Optimism' }),
        ],
      }),
    ]);

    const options = makeOptions({ quote: zeroFeeQuote([1, 10], 137) });
    const getQuote = vi.spyOn(options.middlewareClient, 'getQuote');
    const result = await calculateMaxForBridge(
      { toChainId: 137, toTokenSymbol: 'USDC', sources: [1] },
      options
    );

    expect(result.maxAmount).toBe('100.000000');
    expect(result.sources.map((s) => s.chainId)).toEqual([1]);
    expect(getQuote).toHaveBeenCalledWith({
      sources: [{ chain_id: toHex(1), contract_address: USDC.contractAddress }],
      destination: {
        chain_id: toHex(137),
        contract_address: USDC.contractAddress,
      },
    });
  });

  it('forceMayan overrides the middleware provider decision', async () => {
    vi.mocked(getBalancesForBridge).mockResolvedValue([
      makeAsset({
        balance: '100',
        value: '100.00',
        chainBalances: [makeChainBalance({ balance: '100', value: '100.00', chainId: 42161, chainName: 'Arbitrum' })],
      }),
    ]);

    const result = await calculateMaxForBridge(
      { toChainId: 10, toTokenSymbol: 'USDC' },
      makeOptions({
        provider: 'nexus', // middleware says nexus...
        forceMayan: true, // ...but force wins
        quote: zeroFeeQuote([42161], 10),
        mayanQuotes: rateMayanQuotes(0.99),
      })
    );

    expect(result.provider).toBe('mayan');
    expect(result.maxAmount).toBe('99.000000');
  });

  it('falls back to nexus when no source clears the Mayan per-leg minimum', async () => {
    vi.mocked(getBalancesForBridge).mockResolvedValue([
      makeAsset({
        balance: '0.5',
        value: '0.50',
        chainBalances: [makeChainBalance({ balance: '0.5', value: '0.50', chainId: 42161, chainName: 'Arbitrum' })],
      }),
    ]);

    const result = await calculateMaxForBridge(
      { toChainId: 10, toTokenSymbol: 'USDC' },
      makeOptions({
        provider: 'mayan', // middleware picks mayan, but the only leg is below the $1.10 floor
        quote: zeroFeeQuote([42161], 10),
        mayanQuotes: rateMayanQuotes(0.99),
      })
    );

    expect(result.provider).toBe('nexus');
  });
});
