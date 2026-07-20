import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  accumulateBridgeAsset,
  computeBridgeFees,
} from '../../../src/swap/routing/bridge';
import type { BridgeAsset, BridgeQuoteResponse } from '../../../src/swap/types';

const TOKEN = '0x0000000000000000000000000000000000000001' as Hex;

describe('swap routing bridge mechanics', () => {
  it('accumulates EOA and ephemeral bridge balances through one chain-keyed entry', () => {
    const assetsByChain = new Map<number, BridgeAsset>();

    accumulateBridgeAsset(assetsByChain, {
      chainID: 1,
      contractAddress: TOKEN,
      decimals: 6,
      balance: 'ephemeralBalance',
      amount: new Decimal('2.5'),
    });
    accumulateBridgeAsset(assetsByChain, {
      chainID: 1,
      contractAddress: TOKEN,
      decimals: 6,
      balance: 'eoaBalance',
      amount: new Decimal('1.25'),
    });

    expect([...assetsByChain.values()]).toEqual([
      {
        chainID: 1,
        contractAddress: TOKEN,
        decimals: 6,
        eoaBalance: new Decimal('1.25'),
        ephemeralBalance: new Decimal('2.5'),
      },
    ]);
  });

  it('returns the fee total and delivered amount with the fee fields', () => {
    const result = computeBridgeFees({
      quoteResponse: {
        destination: { fulfillmentFeeToken: 2_000_000n },
        fulfillmentBps: 100,
      } as unknown as BridgeQuoteResponse,
      grossBridged: new Decimal(100),
      dstCOTDecimals: 6,
    });

    expect(result.estimatedFees.fulfilment).toEqual(new Decimal(2));
    expect(result.estimatedFees.protocol).toEqual(new Decimal(1));
    expect(result.totalFeeAmount).toEqual(new Decimal(3));
    expect(result.deliveredAmount).toEqual(new Decimal(97));
    expect(result.nexusFeeModel).toEqual({
      fulfillmentFee: new Decimal(2),
      fulfillmentBps: new Decimal(100),
    });
  });
});
