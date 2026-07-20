import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { MayanQuote } from '@avail-project/nexus-types';
import { createSwapBridgeIntent } from '../../src/swap/bridge-intent';
import type { ChainListType, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import type { BridgeAsset, SwapRoute } from '../../src/swap/types';
import type { QuoteResponse as BridgeQuoteResponse } from '../../src/transport';

const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;
const ETH_CHAIN = 1;
const ETH_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Hex;
const EPHEMERAL_ADDRESS = '0xbbbb000000000000000000000000000000000002' as Hex;
const EOA_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Hex;
const makeChainDisplay = (id: number, name: string) => ({ id, name, logo: `${id}.png` });
const NATIVE_TOKEN: TokenInfo = {
  contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  decimals: 18,
  logo: '',
  name: 'Ether',
  symbol: 'ETH',
};

const TOKENS = new Map<string, TokenInfo>([
  [
    `${ARB_CHAIN}:${USDC_ARB.toLowerCase()}`,
    {
      contractAddress: USDC_ARB,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    },
  ],
  [
    `${BASE_CHAIN}:${USDC_BASE.toLowerCase()}`,
    {
      contractAddress: USDC_BASE,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    },
  ],
  [
    `${ETH_CHAIN}:${ETH_USDC.toLowerCase()}`,
    {
      contractAddress: ETH_USDC,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    },
  ],
]);

const makeChainList = (): ChainListType =>
  ({
    chains: [],
    getVaultContractAddress: () => {
      throw new Error('not used');
    },
    getTokenInfoBySymbol: () => {
      throw new Error('not used');
    },
    getChainAndTokenFromSymbol: () => {
      throw new Error('not used');
    },
    getTokenByAddress: (chainId: number, address: Hex) => {
      const token = TOKENS.get(`${chainId}:${address.toLowerCase()}`);
      if (!token) {
        throw new Error(`Token not found for ${chainId}:${address}`);
      }
      return token;
    },
    getChainAndTokenByAddress: () => {
      throw new Error('not used');
    },
    getNativeToken: () => {
      return NATIVE_TOKEN;
    },
    getChainByID: (chainId: number) => {
      switch (chainId) {
        case ARB_CHAIN:
          return {
            id: ARB_CHAIN,
            name: 'Arbitrum',
            custom: { icon: `${ARB_CHAIN}.png` },
          } as any;
        case BASE_CHAIN:
          return {
            id: BASE_CHAIN,
            name: 'Base',
            custom: { icon: `${BASE_CHAIN}.png` },
          } as any;
        case ETH_CHAIN:
          return {
            id: ETH_CHAIN,
            name: 'Ethereum',
            custom: { icon: `${ETH_CHAIN}.png` },
          } as any;
        default:
          throw new Error(`Unknown chain ${chainId}`);
      }
    },
    getTokenByCurrencyId: () => {
      throw new Error('not used');
    },
  }) as ChainListType;

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

const makeMayanQuote = (label: string): MayanQuote =>
  ({ minReceived: label, protocolBps: 3 }) as unknown as MayanQuote;

describe('createSwapBridgeIntent', () => {
  it('creates a single ephemeral-backed source per chain on the ephemeral bridge path', () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)]);
    const chainList = makeChainList();

    const intent = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,      ephemeralAddress: EPHEMERAL_ADDRESS,    });

    expect(intent.selectedSources).toHaveLength(1);
    expect(intent.selectedSources[0].chain.id).toBe(ARB_CHAIN);
    expect(intent.selectedSources[0].universe).toBe(Universe.ETHEREUM);
    expect(intent.selectedSources[0].holderAddress).toBe(EPHEMERAL_ADDRESS);
    expect(intent.selectedSources[0].depositFee.toString()).toBe('0');
    expect(intent.selectedSources[0].amountRaw).toBe(3000000000n);
    expect(intent.selectedSources[0].depositFeeRaw).toBe(0n);
    expect(intent.recipientAddress).toBe(EPHEMERAL_ADDRESS);
    expect(intent.availableSources).toEqual(intent.selectedSources);
  });

  it('recipient is dynamic (EOA or ephemeral)', () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)]);
    const chainList = makeChainList();

    const intentEphemeral = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,      ephemeralAddress: EPHEMERAL_ADDRESS,    });
    const intentEoa = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EOA_ADDRESS,      ephemeralAddress: EPHEMERAL_ADDRESS,    });

    expect(intentEphemeral.recipientAddress).toBe(EPHEMERAL_ADDRESS);
    expect(intentEoa.recipientAddress).toBe(EOA_ADDRESS);
  });

  it('Ethereum chain sorted last', () => {
    const bridge = makeBridge([
      makeBridgeAsset(ETH_CHAIN, ETH_USDC, '5000'),
      makeBridgeAsset(ARB_CHAIN, USDC_ARB, '3000'),
    ]);
    const chainList = makeChainList();

    const intent = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,      ephemeralAddress: EPHEMERAL_ADDRESS,    });

    expect(intent.selectedSources.length).toBe(2);
    expect(intent.selectedSources[intent.selectedSources.length - 1].chain.id).toBe(ETH_CHAIN);
  });

  it('populates intent fee fields from bridge estimatedFees', () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)], {
      estimatedFees: {
        collection: new Decimal('0.5'),
        fulfilment: new Decimal('1.5'),
        caGas: new Decimal('2'),
        protocol: new Decimal('0.75'),
        solver: new Decimal(0),
      },
    });
    const chainList = makeChainList();

    const intent = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,      ephemeralAddress: EPHEMERAL_ADDRESS,    });

    expect(intent.fees.deposit).toBe('0.5');
    expect(intent.fees.fulfillment).toBe('1.5');
    expect(intent.fees.caGas).toBe('2');
    expect(intent.fees.protocol).toBe('0.75');
    expect(intent.fees.solver).toBe('0');
  });

  it('destination matches bridge chain', () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)]);
    const chainList = makeChainList();

    const intent = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,      ephemeralAddress: EPHEMERAL_ADDRESS,    });

    expect(intent.destination.chain.id).toBe(BASE_CHAIN);
    expect(intent.destination.token.contractAddress).toBe(USDC_BASE);
    expect(intent.destination.token.decimals).toBe(6);
    expect(intent.destination.amountRaw).toBe(3000000000n);
  });

  it('keeps destination native amount at zero — swap routes never request bridge-delivered gas', () => {
    // Gas-swap COT (`bridge.amounts.gasInCot`) is bridged for the dst aggregator's gas swap,
    // not delivered as native by the solver. The wire-format native fields stay zero.
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB, '3025')], {
      amount: new Decimal('3025'),
      amounts: {
        tokenAmount: new Decimal('2974'),
        gasInCot: new Decimal('25'),
        totalAmount: new Decimal('3025'),
      },
      estimatedFees: {
        collection: new Decimal('10'),
        fulfilment: new Decimal('6'),
        caGas: new Decimal('16'),
        protocol: new Decimal('10'),
        solver: new Decimal(0),
      },
    });
    const chainList = makeChainList();

    const intent = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,      ephemeralAddress: EPHEMERAL_ADDRESS,    });

    // executionTokenAmount = totalBridgedAmount - fees = 3025 - 10 - 6 - 10 = 2999.
    expect(intent.destination.amount.toString()).toBe('2999');
    expect(intent.destination.nativeAmountRaw).toBe(0n);
    expect(intent.destination.nativeAmount.toString()).toBe('0');
    expect(intent.destination.nativeAmountInToken.toString()).toBe('0');
    expect(intent.destination.nativeToken.contractAddress).toBe(NATIVE_TOKEN.contractAddress);
  });

  it('derives destination token amount from execution-time assets instead of stale route totals', () => {
    const assets = [makeBridgeAsset(ARB_CHAIN, USDC_ARB, '3.5')];
    const bridge = makeBridge(assets, {
      amount: new Decimal('6'),
      amounts: {
        tokenAmount: new Decimal('6'),
        gasInCot: new Decimal(0),
        totalAmount: new Decimal('6'),
      },
      estimatedFees: {
        collection: new Decimal(0),
        fulfilment: new Decimal(0),
        caGas: new Decimal(0),
        protocol: new Decimal(0),
        solver: new Decimal(0),
      },
    });
    const chainList = makeChainList();

    const intent = createSwapBridgeIntent({
      bridge,
      assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,      ephemeralAddress: EPHEMERAL_ADDRESS,    });

    expect(intent.destination.amount.toString()).toBe('3.5');
    expect(
      intent.selectedSources
        .reduce((sum, source) => sum.plus(source.amount), new Decimal(0))
        .toString()
    ).toBe('3.5');
  });

  it.each([
    { actualBalance: '3000', protocolFee: '30', delivered: '2968' },
    { actualBalance: '7000', protocolFee: '70', delivered: '6928' },
  ])(
    'recomputes Nexus fixed-plus-bps fees from the actual $actualBalance execution balance',
    ({ actualBalance, protocolFee, delivered }) => {
      const assets = [makeBridgeAsset(ARB_CHAIN, USDC_ARB, actualBalance)];
      const bridge = makeBridge(assets, {
        amount: new Decimal('6000'),
        amounts: {
          tokenAmount: new Decimal('5938'),
          gasInCot: new Decimal(0),
          totalAmount: new Decimal('6000'),
        },
        estimatedFees: {
          collection: new Decimal(0),
          fulfilment: new Decimal(2),
          caGas: new Decimal(2),
          protocol: new Decimal(60),
          solver: new Decimal(0),
        },
        nexusFeeModel: {
          fulfillmentFee: new Decimal(2),
          fulfillmentBps: new Decimal(100),
        },
      });

      const intent = createSwapBridgeIntent({
        bridge,
        assets,
        chainList: makeChainList(),
        recipient: EPHEMERAL_ADDRESS,
        ephemeralAddress: EPHEMERAL_ADDRESS,
      });

      expect(intent.destination.amount.toString()).toBe(delivered);
      expect(intent.fees.fulfillment).toBe('2');
      expect(intent.fees.protocol).toBe(protocolFee);
    }
  );

  it('EXACT_OUT same-token (B1): per-chain split sources, destination = the exact target, no gas', () => {
    // B1 EXACT_OUT bridges the family token directly from EOA-held (fast-path) assets. The destination
    // is derived as Σassets − fees; B1 grosses the split up to cover the fees, so with a zero-fee quote
    // the delivered amount == the split sum == the exact toAmount, and there is no gas leg.
    const bridge = makeBridge(
      [
        { chainID: ARB_CHAIN, contractAddress: USDC_ARB, decimals: 6, eoaBalance: new Decimal('2'), ephemeralBalance: new Decimal(0) },
        { chainID: ETH_CHAIN, contractAddress: ETH_USDC, decimals: 6, eoaBalance: new Decimal('1'), ephemeralBalance: new Decimal(0) },
      ],
      { amount: new Decimal('3'), amounts: { tokenAmount: new Decimal('3'), gasInCot: new Decimal(0), totalAmount: new Decimal('3') } }
    );
    const intent = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList: makeChainList(),
      recipient: EOA_ADDRESS,
      ephemeralAddress: EPHEMERAL_ADDRESS,
    });

    const byChain = new Map(intent.selectedSources.map((s) => [s.chain.id, s.amountRaw]));
    expect(byChain.get(ARB_CHAIN)).toBe(2_000_000n);
    expect(byChain.get(ETH_CHAIN)).toBe(1_000_000n);
    expect(intent.destination.amount.toString()).toBe('3'); // the exact toAmount
    expect(intent.destination.nativeAmountRaw).toBe(0n);
    expect(intent.recipientAddress).toBe(EOA_ADDRESS);
  });

  it('marks the intent as nexus by default and does not stamp mayanQuote on sources', () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)]);
    const chainList = makeChainList();

    const intent = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,
      ephemeralAddress: EPHEMERAL_ADDRESS,
    });

    expect(intent.provider).toBe('nexus');
    expect(intent.selectedSources[0].mayanQuote).toBeUndefined();
  });

  it('marks the intent as mayan and stamps the per-source mayanQuote when provider is mayan', () => {
    const arbQuote = makeMayanQuote('arb-quote');
    const ethQuote = makeMayanQuote('eth-quote');
    const bridge = makeBridge(
      [makeBridgeAsset(ARB_CHAIN, USDC_ARB, '3000'), makeBridgeAsset(ETH_CHAIN, ETH_USDC, '2000')],
      {
        provider: 'mayan',
        mayanQuotesBySource: new Map([
          [`${ARB_CHAIN}:${USDC_ARB.toLowerCase()}`, arbQuote],
          [`${ETH_CHAIN}:${ETH_USDC.toLowerCase()}`, ethQuote],
        ]),
      }
    );
    const chainList = makeChainList();

    const intent = createSwapBridgeIntent({
      bridge,
      assets: bridge.assets,
      chainList,
      recipient: EPHEMERAL_ADDRESS,
      ephemeralAddress: EPHEMERAL_ADDRESS,
    });

    expect(intent.provider).toBe('mayan');
    const byChain = new Map(intent.selectedSources.map((s) => [s.chain.id, s.mayanQuote]));
    expect(byChain.get(ARB_CHAIN)).toBe(arbQuote);
    expect(byChain.get(ETH_CHAIN)).toBe(ethQuote);
  });

  it('throws when provider is mayan but mayanQuotesBySource is missing a source', () => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)], {
      provider: 'mayan',
      mayanQuotesBySource: new Map(),
    });
    const chainList = makeChainList();

    expect(() =>
      createSwapBridgeIntent({
        bridge,
        assets: bridge.assets,
        chainList,
        recipient: EPHEMERAL_ADDRESS,
        ephemeralAddress: EPHEMERAL_ADDRESS,
      })
    ).toThrow();
  });
});
