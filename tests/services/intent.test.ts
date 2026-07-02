import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { BridgeIntentDraft, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { convertIntent } from '../../src/bridge/intent/readable';

const TOKEN: TokenInfo = {
  contractAddress: '0x0000000000000000000000000000000000000001',
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
};

const ETH_CHAIN = { id: 1, name: 'Ethereum', logo: 'chain-1.png' };
const OP_CHAIN = { id: 10, name: 'Optimism', logo: 'chain-10.png' };
const NATIVE_TOKEN: TokenInfo = {
  contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  decimals: 18,
  logo: 'eth.png',
  name: 'Ether',
  symbol: 'ETH',
};

describe('convertIntent', () => {
  it('formats source, destination, native amount, and fee USD fields as plain numeric strings', () => {
    const intent: BridgeIntentDraft = {
      availableSources: [
        {
          amount: new Decimal('5'),
          amountRaw: 5000000n,
          value: new Decimal('5'),
          chain: ETH_CHAIN,
          token: TOKEN,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
        {
          amount: new Decimal('10.25'),
          amountRaw: 10250000n,
          value: new Decimal('10.25'),
          chain: ETH_CHAIN,
          token: TOKEN,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
        {
          amount: new Decimal('20'),
          amountRaw: 20000000n,
          value: new Decimal('20'),
          chain: ETH_CHAIN,
          token: TOKEN,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
      ],
      destination: {
        amount: new Decimal('28'),
        amountRaw: 28000000n,
        value: new Decimal('28'),
        nativeAmount: new Decimal('0.01'),
        nativeAmountRaw: 10000000000000000n,
        nativeAmountValue: new Decimal('1.50'),
        nativeAmountInToken: new Decimal('0.4'),
        nativeToken: NATIVE_TOKEN,
        chain: OP_CHAIN,
        token: TOKEN,
        universe: Universe.ETHEREUM,
      },
      fees: {
        caGas: '0.1',
        deposit: '0.2',
        fulfillment: '0.3',
        protocol: '0.5',
        solver: '0.6',
      },
      recipientAddress: '0x0000000000000000000000000000000000000003',
      selectedSources: [
        {
          amount: new Decimal('10.25'),
          amountRaw: 10250000n,
          value: new Decimal('10.25'),
          chain: ETH_CHAIN,
          token: TOKEN,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
        {
          amount: new Decimal('20'),
          amountRaw: 20000000n,
          value: new Decimal('20'),
          chain: ETH_CHAIN,
          token: TOKEN,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
      ],
      provider: 'nexus',
    };

    const readable = convertIntent(intent);

    expect(readable.selectedSources[0]?.value).toBe('10.25');
    expect(readable.selectedSources[1]?.value).toBe('20.00');
    expect(readable.availableSources[0]?.value).toBe('5.00');
    expect(readable.destination.value).toBe('28.00');
    expect(readable.destination.nativeAmount).toBe('0.010000000000000000');
    expect(readable.destination.nativeAmountRaw).toBe(10000000000000000n);
    expect(readable.destination.nativeAmountValue).toBe('1.50');
    expect(readable.destination.nativeAmountInToken).toBe('0.400000');
    expect(readable.destination.nativeToken).toEqual({
      contractAddress: NATIVE_TOKEN.contractAddress,
      decimals: NATIVE_TOKEN.decimals,
      logo: NATIVE_TOKEN.logo,
      symbol: NATIVE_TOKEN.symbol,
    });
    expect(readable.sourcesTotalValue).toBe('30.25');
    expect(readable.fees.totalValue).toBe('2.25');
    expect(readable.fees.total).toBe('1.200000');
    expect(readable.fees.totalValue).not.toContain('$');
    expect(readable.fees.totalValue).not.toContain(',');
    expect(readable.fees).not.toHaveProperty('gasSupplied');
  });
});
