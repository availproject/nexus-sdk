import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { type Hex } from 'viem';
import type { MayanQuote } from '@avail-project/nexus-types';
import { enrichMayanBridge } from '../../src/swap/route';
import type { BridgeAsset, SwapRoute } from '../../src/swap/types';
import type { ChainListType } from '../../src/domain';

const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;

const makeMayanQuote = (minReceived: number): MayanQuote =>
  ({ minReceived, protocolBps: 3 }) as unknown as MayanQuote;

const makeBridgeAsset = (chainId: number, address: Hex, balance = '3000'): BridgeAsset => ({
  chainID: chainId,
  contractAddress: address,
  decimals: 6,
  eoaBalance: new Decimal(0),
  ephemeralBalance: new Decimal(balance),
});

const makeBridge = (
  assets: BridgeAsset[],
  overrides?: Partial<NonNullable<SwapRoute['bridge']>>
): NonNullable<SwapRoute['bridge']> => ({
  amount: new Decimal('6000'),
  amounts: {
    tokenAmount: new Decimal('6000'),
    gasInCot: new Decimal(0),
    totalAmount: new Decimal('6000'),
  },
  assets,
  chainID: BASE_CHAIN,
  decimals: 6,
  tokenAddress: USDC_BASE,
  estimatedFees: {
    collection: new Decimal(0),
    fulfilment: new Decimal(0),
    caGas: new Decimal(0),
    protocol: new Decimal(0),
    solver: new Decimal(0),
  },
  provider: 'nexus',
  ...overrides,
});

type ChainListOverrides = {
  destChain?: { mayanDisabled?: boolean };
  destToken?: { mayanDisabled?: boolean };
  srcByChain?: Record<number, { mayanDisabled?: boolean; tokenMayanDisabled?: boolean }>;
};

const makeChainList = (overrides: ChainListOverrides = {}): ChainListType =>
  ({
    getChainByID: (id: number) => {
      if (id === BASE_CHAIN) {
        return { id, mayanEnabled: !(overrides.destChain?.mayanDisabled ?? false) };
      }
      const cfg = overrides.srcByChain?.[id];
      return { id, mayanEnabled: !(cfg?.mayanDisabled ?? false) };
    },
    getTokenByAddress: (chainId: number, _address: Hex) => {
      if (chainId === BASE_CHAIN) {
        return { mayanEnabled: !(overrides.destToken?.mayanDisabled ?? false) };
      }
      const cfg = overrides.srcByChain?.[chainId];
      return { mayanEnabled: !(cfg?.tokenMayanDisabled ?? false) };
    },
  }) as unknown as ChainListType;

const makeMiddleware = (opts: { quotesByChain?: Record<number, MayanQuote> } = {}) => ({
  getMayanQuotes: async (req: {
    sources: { chain_id: string; contract_address: Hex; amount: string }[];
    destination: { chain_id: string; contract_address: Hex };
  }) => ({
    destination: { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
    quotes: req.sources.map((s) => {
      const chainId = Number(BigInt(s.chain_id));
      const quote = opts.quotesByChain?.[chainId];
      if (!quote) throw new Error(`no quote stubbed for chain ${chainId}`);
      return {
        source: { chainId, tokenAddress: s.contract_address, amount: s.amount },
        mayanQuote: quote,
      };
    }),
  }),
});

describe('enrichMayanBridge', () => {
  it('populates mayanQuotesBySource per source when bridge.provider is mayan', async () => {
    const arbQuote = makeMayanQuote(100);
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)], { provider: 'mayan' });
    const middleware = makeMiddleware({ quotesByChain: { [ARB_CHAIN]: arbQuote } });

    const result = await enrichMayanBridge(bridge, {
      chainList: makeChainList(),
      middlewareClient: middleware as never,
    });

    expect(result.provider).toBe('mayan');
    expect(result.mayanQuotesBySource?.get(`${ARB_CHAIN}:${USDC_ARB.toLowerCase()}`)).toBe(arbQuote);
  });

  it('records the Mayan haircut (gross bridged − Σ minReceived) as estimatedFees, not the Nexus fee', async () => {
    // 3000 USDC bridged, Mayan guarantees 2900 on the destination → a 100 USDC haircut. The route's
    // recorded fee must reflect that, not the Nexus fulfilment/protocol the call site stubbed (0 here).
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB, '3000')], { provider: 'mayan' });
    const middleware = makeMiddleware({ quotesByChain: { [ARB_CHAIN]: makeMayanQuote(2900) } });

    const result = await enrichMayanBridge(bridge, {
      chainList: makeChainList(),
      middlewareClient: middleware as never,
    });

    expect(result.estimatedFees.protocol.toString()).toBe('100');
    expect(result.estimatedFees.fulfilment.toString()).toBe('0');
    expect(result.estimatedFees.collection.toString()).toBe('0');
  });

  it('throws when a source chain is mayanDisabled', async () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)], { provider: 'mayan' });
    const middleware = makeMiddleware();
    const chainList = makeChainList({
      srcByChain: { [ARB_CHAIN]: { mayanDisabled: true } },
    });

    await expect(
      enrichMayanBridge(bridge, { chainList, middlewareClient: middleware as never })
    ).rejects.toThrow(/source chain 42161.*disabled for mayan/i);
  });

  it('throws when the source token is mayanDisabled on its chain', async () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)], { provider: 'mayan' });
    const middleware = makeMiddleware();
    const chainList = makeChainList({
      srcByChain: { [ARB_CHAIN]: { tokenMayanDisabled: true } },
    });

    await expect(
      enrichMayanBridge(bridge, { chainList, middlewareClient: middleware as never })
    ).rejects.toThrow(/disabled for mayan/i);
  });

  it('throws when the destination chain is mayanDisabled (defensive check)', async () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)], { provider: 'mayan' });
    const middleware = makeMiddleware();
    const chainList = makeChainList({ destChain: { mayanDisabled: true } });

    await expect(
      enrichMayanBridge(bridge, { chainList, middlewareClient: middleware as never })
    ).rejects.toThrow(/destination chain.*disabled for mayan/i);
  });
});
