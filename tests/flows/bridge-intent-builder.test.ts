import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { Universe } from '../../src/domain/chain-abstraction';
import type { BridgeIntentDraft, BridgeIntentToken, ChainListType } from '../../src/domain';
import { findInsufficientAllowanceSources } from '../../src/bridge/intent/builder';
import { buildAllowanceKey } from '../../src/services/allowance-utils';

const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;
const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
const TOKEN: BridgeIntentToken = {
  contractAddress: USDC,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
};
const ARB_CHAIN_DISPLAY = { id: ARB_CHAIN, name: 'Arbitrum', logo: '' };
const BASE_CHAIN_DISPLAY = { id: BASE_CHAIN, name: 'Base', logo: '' };

const makeIntent = (overrides?: {
  selectedSources?: BridgeIntentDraft['selectedSources'];
}): BridgeIntentDraft => ({
  availableSources: overrides?.selectedSources ?? [
    {
      amount: new Decimal('1'),
      amountRaw: 1000000n,
      chain: ARB_CHAIN_DISPLAY,
      token: TOKEN,
      universe: Universe.ETHEREUM,
      holderAddress: EOA,
      value: new Decimal(0),
      depositFee: new Decimal(0),
      depositFeeRaw: 0n,
    },
    {
      amount: new Decimal('2'),
      amountRaw: 2000000n,
      chain: ARB_CHAIN_DISPLAY,
      token: TOKEN,
      universe: Universe.ETHEREUM,
      holderAddress: EPH,
      value: new Decimal(0),
      depositFee: new Decimal(0),
      depositFeeRaw: 0n,
    },
  ],
  selectedSources: overrides?.selectedSources ?? [
    {
      amount: new Decimal('1'),
      amountRaw: 1000000n,
      chain: ARB_CHAIN_DISPLAY,
      token: TOKEN,
      universe: Universe.ETHEREUM,
      holderAddress: EOA,
      value: new Decimal(0),
      depositFee: new Decimal(0),
      depositFeeRaw: 0n,
    },
    {
      amount: new Decimal('2'),
      amountRaw: 2000000n,
      chain: ARB_CHAIN_DISPLAY,
      token: TOKEN,
      universe: Universe.ETHEREUM,
      holderAddress: EPH,
      value: new Decimal(0),
      depositFee: new Decimal(0),
      depositFeeRaw: 0n,
    },
  ],
  destination: {
    amount: new Decimal('3'),
    amountRaw: 3000000n,
    chain: BASE_CHAIN_DISPLAY,
    nativeAmount: new Decimal(0),
    nativeAmountRaw: 0n,
    nativeAmountValue: new Decimal(0),
    nativeAmountInToken: new Decimal(0),
    nativeToken: {
      contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
      decimals: 18,
      logo: '',
      name: 'Ether',
      symbol: 'ETH',
    },
    token: TOKEN,
    universe: Universe.ETHEREUM,
    value: new Decimal(0),
  },
  fees: {
    caGas: '0',
    deposit: '0',
    fulfillment: '0',
    protocol: '0',
    solver: '0',
  },
  recipientAddress: EOA,
  provider: 'nexus',
});

const makeChainList = () =>
  ({
    getChainByID: vi.fn().mockReturnValue({
      id: ARB_CHAIN,
      name: 'Arbitrum',
      custom: { icon: '' },
    }),
    getTokenByAddress: vi.fn().mockReturnValue({
      ...TOKEN,
    }),
  }) as unknown as ChainListType;

describe('findInsufficientAllowanceSources', () => {
  it('tracks allowances by chain, token, and holder address for mixed-holder sources', () => {
    const intent = makeIntent();
    const chainList = makeChainList();

    const result = findInsufficientAllowanceSources({
      intent,
      allowances: {
        [buildAllowanceKey(ARB_CHAIN, USDC, EOA)]: 1000000n,
        [buildAllowanceKey(ARB_CHAIN, USDC, EPH)]: 0n,
      },
      chainList,
    });

    expect(result).toHaveLength(1);
    expect(result[0].holderAddress).toBe(EPH);
    expect(result[0].allowance.minimumRaw).toBe(2000000n);
  });

  it('includes deposit fee in required allowance', () => {
    const intent = makeIntent({
      selectedSources: [
        {
          amount: new Decimal('10'),
          amountRaw: 10000000n,
          chain: ARB_CHAIN_DISPLAY,
          token: TOKEN,
          universe: Universe.ETHEREUM,
          holderAddress: EOA,
          value: new Decimal(0),
          depositFee: new Decimal('0.5'), // 0.5 USDC deposit fee
          depositFeeRaw: 500000n,
        },
      ],
    });
    const chainList = makeChainList();

    // Current allowance = 10 USDC (10_000_000 raw) — enough for amount but not amount + fee
    const result = findInsufficientAllowanceSources({
      intent,
      allowances: {
        [buildAllowanceKey(ARB_CHAIN, USDC, EOA)]: 10_000_000n,
      },
      chainList,
    });

    // Required = 10 + 0.5 = 10.5 USDC = 10_500_000 raw
    expect(result).toHaveLength(1);
    expect(result[0].allowance.minimumRaw).toBe(10_500_000n);
    expect(result[0].allowance.minimum).toBe('10.500000');
  });

  it('does not flag source when allowance covers amount + deposit fee', () => {
    const intent = makeIntent({
      selectedSources: [
        {
          amount: new Decimal('10'),
          amountRaw: 10000000n,
          chain: ARB_CHAIN_DISPLAY,
          token: TOKEN,
          universe: Universe.ETHEREUM,
          holderAddress: EOA,
          value: new Decimal(0),
          depositFee: new Decimal('0.5'),
          depositFeeRaw: 500000n,
        },
      ],
    });
    const chainList = makeChainList();

    const result = findInsufficientAllowanceSources({
      intent,
      allowances: {
        [buildAllowanceKey(ARB_CHAIN, USDC, EOA)]: 10_500_000n, // exactly enough
      },
      chainList,
    });

    expect(result).toHaveLength(0);
  });
});
