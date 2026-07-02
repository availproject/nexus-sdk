import { expect, it } from 'vitest';
import type { BridgeOptions } from '../../src/domain';
import { executeBridgeFromIntent, waitForFill } from '../../src/bridge/executor';
import { getBalancesForBridge, getBalancesForSwap } from '../../src/services/balances';
import { waitForIntentFulfilmentFromMiddleware } from '../../src/services/fulfilment';
import { createAggregators } from '../../src/swap/aggregators';
import { buildSwapPreflight } from '../../src/swap/preflight';
import type { ExecutionContext, SwapParams } from '../../src/swap/types';
import type { MiddlewareClient } from '../../src/transport';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Simplify<T> = { [K in keyof T]: T[K] };

type RffStatusClient = Pick<MiddlewareClient, 'getRFFStatus'>;
type BridgeBalanceClient = Pick<MiddlewareClient, 'getBalances'>;
type SwapBalanceClient = Pick<MiddlewareClient, 'getSwapBalances'>;
type AggregatorQuoteClient = Pick<MiddlewareClient, 'getLiFiQuote' | 'getBebopQuote'>;
type SwapPreflightClient = Pick<
  MiddlewareClient,
  'getSwapBalances' | 'getOraclePrices' | 'getQuote' | 'getLiFiQuote' | 'getBebopQuote' | 'configureTiming' | 'destroy'
>;
type BridgeClient = Pick<
  MiddlewareClient,
  'getBalances' | 'createApprovals' | 'getOraclePrices' | 'getQuote' | 'getMayanQuotes' | 'submitRFF' | 'getRFFStatus' | 'getBridgeProvider' | 'reportMayanNativeTx' | 'getRFF'
>;
type BridgeExecutionClient = Pick<MiddlewareClient, 'submitRFF' | 'getRFFStatus' | 'getRFF' | 'reportMayanNativeTx'>;
type SwapClient = Pick<
  MiddlewareClient,
  | 'getSwapBalances'
  | 'getOraclePrices'
  | 'getQuote'
  | 'getLiFiQuote'
  | 'getBebopQuote'
  | 'createApprovals'
  | 'submitSBCs'
  | 'submitRFF'
  | 'getRFFStatus'
  | 'configureTiming'
  | 'destroy'
  | 'getRFF'
  | 'reportMayanNativeTx'
>;
type SwapExecutionClient = Pick<
  MiddlewareClient,
  | 'getSwapBalances'
  | 'createApprovals'
  | 'submitSBCs'
  | 'submitRFF'
  | 'getRFFStatus'
  | 'getRFF'
  | 'reportMayanNativeTx'
>;

const assertions: [
  Assert<IsEqual<Parameters<typeof waitForIntentFulfilmentFromMiddleware>[0], RffStatusClient>>,
  Assert<IsEqual<Parameters<typeof getBalancesForBridge>[0]['middlewareClient'], BridgeBalanceClient>>,
  Assert<IsEqual<Parameters<typeof getBalancesForSwap>[0]['middlewareClient'], SwapBalanceClient>>,
  Assert<IsEqual<Parameters<typeof createAggregators>[0], AggregatorQuoteClient>>,
  Assert<IsEqual<Simplify<Parameters<typeof buildSwapPreflight>[1]['middlewareClient']>, SwapPreflightClient>>,
  Assert<IsEqual<Simplify<BridgeOptions['middlewareClient']>, BridgeClient>>,
  Assert<IsEqual<Simplify<Parameters<typeof executeBridgeFromIntent>[1]['middlewareClient']>, BridgeExecutionClient>>,
  Assert<IsEqual<Parameters<typeof waitForFill>[0]['middlewareClient'], RffStatusClient>>,
  Assert<IsEqual<Simplify<SwapParams['middlewareClient']>, SwapClient>>,
  Assert<IsEqual<Simplify<ExecutionContext['middlewareClient']>, SwapExecutionClient>>,
] = [true, true, true, true, true, true, true, true, true, true];
void assertions;

it('keeps middleware capability assertions in the test program', () => {
  expect(assertions).toHaveLength(10);
});
