import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { MayanQuote } from '@avail-project/nexus-types';
import { createSwapBridgeIntent } from '../../../src/swap/bridge-intent';
import { refreshMayanQuotesForExecution } from '../../../src/swap/execution/bridge';
import type { BridgeAsset, SwapRoute } from '../../../src/swap/types';
import type { ChainListType, TokenInfo } from '../../../src/domain';

// Production repro: a swap whose USDC-on-Optimism bridge leg was quoted by Mayan at route time for
// 477.870646 USDC (the slippage-min source-swap estimate), but the executed leg drifted to
// 477.873208 USDC. The middleware rejects the RFF with "Mayan quote amount mismatch for source 0"
// because it requires `source.value === mayanQuote.effectiveAmountIn`.
const USDC_OP = '0x0b2c639c533813f4aa9d7837caf62653d097ff85' as Hex;
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
const OP_CHAIN = 10;
const BASE_CHAIN = 8453;
const EPHEMERAL_ADDRESS = '0xbbbb000000000000000000000000000000000002' as Hex;

const ROUTE_EFFECTIVE_IN = '477870646'; // what the stale route-time quote was signed for
const EXECUTED_RAW = 477873208n; // 455 USDC COT holding + 22.873208 USDC executed swap output

const USDC_META: TokenInfo = {
  contractAddress: USDC_OP,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
};

const makeMayanQuote = (effectiveAmountIn64: string): MayanQuote =>
  ({
    effectiveAmountIn64,
    effectiveAmountIn: Number(effectiveAmountIn64) / 1e6,
    minReceived: Number(effectiveAmountIn64) / 1e6,
    protocolBps: 3,
  }) as unknown as MayanQuote;

// USDC-on-OP leg carrying 455 USDC direct COT (eoaBalance) + 22.873208 executed swap output
// (ephemeralBalance) = 477.873208 total, exactly what the RFF will deposit.
const makeExecutedAssets = (): BridgeAsset[] => [
  {
    chainID: OP_CHAIN,
    contractAddress: USDC_OP,
    decimals: 6,
    eoaBalance: new Decimal('455'),
    ephemeralBalance: new Decimal('22.873208'),
  },
];

const makeStaleBridge = (): NonNullable<SwapRoute['bridge']> => ({
  amount: new Decimal('477.873208'),
  amounts: {
    tokenAmount: new Decimal('477.873208'),
    gasInCot: new Decimal(0),
    totalAmount: new Decimal('477.873208'),
  },
  assets: makeExecutedAssets(),
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
  provider: 'mayan',
  mayanQuotesBySource: new Map([
    [`${OP_CHAIN}:${USDC_OP.toLowerCase()}`, makeMayanQuote(ROUTE_EFFECTIVE_IN)],
  ]),
});

const makeChainList = (): ChainListType =>
  ({
    getTokenByAddress: () => USDC_META,
    getNativeToken: () => USDC_META,
    getChainByID: (id: number) => ({ id, name: `chain-${id}`, custom: { icon: `${id}.png` } }),
  }) as unknown as ChainListType;

// Echoes each requested leg amount back as the quote's effectiveAmountIn64 — Mayan's behaviour for
// a like-for-like (USDC→USDC) leg, where the order's input is exactly what you offer it.
const makeEchoingMiddleware = () => ({
  getMayanQuotes: async (req: {
    sources: { chain_id: string; contract_address: Hex; amount: string }[];
    destination: { chain_id: string; contract_address: Hex };
  }) => ({
    destination: { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
    quotes: req.sources.map((s) => ({
      source: { chainId: Number(BigInt(s.chain_id)), tokenAddress: s.contract_address, amount: s.amount },
      mayanQuote: makeMayanQuote(s.amount),
    })),
  }),
});

const firstSourceAmounts = (bridge: NonNullable<SwapRoute['bridge']>) => {
  const intent = createSwapBridgeIntent({
    bridge,
    assets: makeExecutedAssets(),
    chainList: makeChainList(),
    recipient: EPHEMERAL_ADDRESS,
    ephemeralAddress: EPHEMERAL_ADDRESS,
  });
  const source = intent.selectedSources[0];
  return {
    rffValue: source.amountRaw,
    quoteEffectiveIn: BigInt((source.mayanQuote as unknown as { effectiveAmountIn64: string }).effectiveAmountIn64),
  };
};

describe('refreshMayanQuotesForExecution', () => {
  it('reproduces the bug: the route-time quote no longer matches the executed RFF value', () => {
    const { rffValue, quoteEffectiveIn } = firstSourceAmounts(makeStaleBridge());

    expect(rffValue).toBe(EXECUTED_RAW);
    expect(quoteEffectiveIn).toBe(BigInt(ROUTE_EFFECTIVE_IN));
    // value !== effectiveAmountIn ⇒ middleware "Mayan quote amount mismatch for source 0"
    expect(rffValue).not.toBe(quoteEffectiveIn);
  });

  it('re-quotes against the executed bridge amount so RFF value === effectiveAmountIn', async () => {
    const refreshed = await refreshMayanQuotesForExecution(
      makeStaleBridge(),
      makeExecutedAssets(),
      makeEchoingMiddleware() as never
    );

    const { rffValue, quoteEffectiveIn } = firstSourceAmounts(refreshed);

    expect(rffValue).toBe(EXECUTED_RAW);
    expect(quoteEffectiveIn).toBe(EXECUTED_RAW);
    expect(rffValue).toBe(quoteEffectiveIn);
  });
});
