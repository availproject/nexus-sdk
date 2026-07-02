import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { BridgeIntentDraft, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { ZERO_ADDRESS } from '../../src/domain/constants';
import { convertTo32BytesHex } from '../../src/services/encoding';
import { getSourcesAndDestinationsForRFF } from '../../src/services/rff';

const ETH_CHAIN = { id: 1, name: 'Ethereum', logo: 'chain-1.png' };
const OP_CHAIN = { id: 10, name: 'Optimism', logo: 'chain-10.png' };
const NATIVE_TOKEN: TokenInfo = {
  contractAddress: ZERO_ADDRESS,
  decimals: 18,
  logo: '',
  name: 'Ether',
  symbol: 'ETH',
};

describe('getSourcesAndDestinationsForRFF', () => {
  it('adds a gas destination when destination token is not native', () => {
    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    };

    const intent: BridgeIntentDraft = {
      availableSources: [],
      recipientAddress: '0x0000000000000000000000000000000000000002',
      fees: {
        caGas: '0',
        deposit: '0',
        fulfillment: '0',
        protocol: '0',
        solver: '0',
      },
      selectedSources: [
        {
          amount: new Decimal('5'),
          amountRaw: 5000000n,
          chain: ETH_CHAIN,
          token,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          value: new Decimal(0),
          depositFee: new Decimal(0),
          depositFeeRaw: 0n,
        },
      ],
      destination: {
        amount: new Decimal('5'),
        amountRaw: 5000000n,
        chain: OP_CHAIN,
        nativeAmount: new Decimal('0.0000000000000001'),
        nativeAmountRaw: 100n,
        nativeAmountValue: new Decimal(0),
        nativeAmountInToken: new Decimal('0.000001'),
        nativeToken: NATIVE_TOKEN,
        token,
        universe: Universe.ETHEREUM,
        value: new Decimal(0),
      },
      provider: 'nexus',
    };

    const { destinations, sources } = getSourcesAndDestinationsForRFF(intent);

    expect(sources).toHaveLength(1);
    expect(destinations).toHaveLength(2);
    expect(destinations[0]?.tokenAddress).toBe(convertTo32BytesHex(token.contractAddress));
    expect(destinations[1]?.tokenAddress).toBe(convertTo32BytesHex(ZERO_ADDRESS));
  });

  it('passes deposit fee through to source depositFeeRaw', () => {
    const token: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    };

    const intent: BridgeIntentDraft = {
      availableSources: [],
      recipientAddress: '0x0000000000000000000000000000000000000002',
      fees: {
        caGas: '0',
        deposit: '0.5',
        fulfillment: '0',
        protocol: '0',
        solver: '0',
      },
      selectedSources: [
        {
          amount: new Decimal('10'),
          amountRaw: 10000000n,
          chain: ETH_CHAIN,
          token,
          universe: Universe.ETHEREUM,
          holderAddress: '0x0000000000000000000000000000000000000002',
          value: new Decimal(0),
          depositFee: new Decimal('0.5'), // 0.5 USDC = 500000 raw
          depositFeeRaw: 500000n,
        },
      ],
      destination: {
        amount: new Decimal('10'),
        amountRaw: 10000000n,
        chain: OP_CHAIN,
        nativeAmount: new Decimal(0),
        nativeAmountRaw: 0n,
        nativeAmountValue: new Decimal(0),
        nativeAmountInToken: new Decimal(0),
        nativeToken: NATIVE_TOKEN,
        token,
        universe: Universe.ETHEREUM,
        value: new Decimal(0),
      },
      provider: 'nexus',
    };

    const { sources } = getSourcesAndDestinationsForRFF(intent);

    expect(sources).toHaveLength(1);
    expect(sources[0]!.depositFeeRaw).toBe(500000n);
  });
});
