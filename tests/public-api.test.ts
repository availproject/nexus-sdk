import { describe, expect, expectTypeOf, it } from 'vitest';
import * as rootModule from '../src';
import * as utilsModule from '../src/utils';
import { AnalyticsManager, IntentStatus, NexusAnalyticsEvents } from '../src';
import type {
  BridgeAndExecuteResult,
  BridgeResult,
  BridgeSimulationResult,
  IntentBalance,
  IntentEvent,
  IntentHistoryRecord,
  IntentHistoryResult,
  IntentHookData,
  IntentQuote,
  IntentResult,
  IntentRecord,
  IntentStatusResponse,
  ListIntentsParams,
  ListIntentsResult,
  OperationName,
  SwapAndExecuteResult,
  SwapResult as SwapResultType,
  SwapResult,
  TxResult,
} from '../src';

describe('public api exports', () => {
  it('exports the unified Better Intent surface and compatibility aliases', () => {
    const params: ListIntentsParams = { page: 1, status: IntentStatus.Created };
    const result = { intents: [] as IntentHistoryRecord[], total: 0 } satisfies ListIntentsResult;
    const bridgeSimulation = {} as BridgeSimulationResult;
    const swapResult = {} as SwapResult;
    const bridgeOperation = 'bridge' as const satisfies OperationName;
    const txResult = {} as TxResult;
    const bridgeAndExecuteResult = {} as BridgeAndExecuteResult;
    const swapAndExecuteResult = {} as SwapAndExecuteResult;
    const quote = {} as IntentQuote;
    const balance = {} as IntentBalance;
    const event = {} as IntentEvent;
    const hook = {} as IntentHookData;
    const status = {} as IntentStatusResponse;

    expect(IntentStatus.Created).toBe('created');
    expect(params).toEqual({ page: 1, status: 'created' });
    expect(result.total).toBe(0);
    expectTypeOf(bridgeSimulation).toEqualTypeOf<IntentQuote>();
    expectTypeOf(swapResult).toEqualTypeOf<IntentResult>();
    expectTypeOf<BridgeResult>().toEqualTypeOf<IntentResult>();
    expectTypeOf<IntentRecord>().toEqualTypeOf<IntentHistoryRecord>();
    expectTypeOf<ListIntentsResult>().toEqualTypeOf<IntentHistoryResult>();
    expect(bridgeOperation).toBe('bridge');
    expectTypeOf(txResult).toMatchTypeOf<TxResult>();
    expectTypeOf(quote).toMatchTypeOf<IntentQuote>();
    expectTypeOf(balance).toMatchTypeOf<IntentBalance>();
    expectTypeOf(event).toMatchTypeOf<IntentEvent>();
    expectTypeOf(hook).toMatchTypeOf<IntentHookData>();
    expectTypeOf(status.status).toEqualTypeOf<IntentStatus>();
    expectTypeOf(bridgeAndExecuteResult).toMatchTypeOf<BridgeAndExecuteResult>();
    expectTypeOf(swapAndExecuteResult).toMatchTypeOf<SwapAndExecuteResult>();

    if (bridgeAndExecuteResult.bridgeSkipped) {
      expectTypeOf(bridgeAndExecuteResult.bridgeResult).toEqualTypeOf<undefined>();
    } else {
      expectTypeOf(bridgeAndExecuteResult.bridgeResult).toMatchTypeOf<BridgeResult>();
    }

    if (swapAndExecuteResult.swapSkipped) {
      expectTypeOf(swapAndExecuteResult.swapResult).toEqualTypeOf<undefined>();
    } else {
      expectTypeOf(swapAndExecuteResult.swapResult).toMatchTypeOf<SwapResultType>();
    }
  });

  it('keeps direct utility helpers off the package root and removes stale token helpers', () => {
    expect(rootModule).not.toHaveProperty('formatUnits');
    expect(rootModule).not.toHaveProperty('parseUnits');
    expect(rootModule).not.toHaveProperty('isSupportedToken');
    expect(utilsModule).not.toHaveProperty('isSupportedToken');
    expect(rootModule).not.toHaveProperty('createSafeClient');
    expect(rootModule).not.toHaveProperty('createSafeMiddlewareClient');
    expect(rootModule).not.toHaveProperty('predictSafeAccountAddress');
  });

  it('locks the NexusAnalyticsEvents taxonomy after the SigNoz/PostHog split', () => {
    // Event constants removed in the analytics ↔ SigNoz separation. PostHog no
    // longer needs them; SigNoz handles error categorization via NexusError.
    // Treat these absences as load-bearing — re-adding any of them risks
    // re-leaking error details into PostHog.
    expect(NexusAnalyticsEvents).not.toHaveProperty('SYSTEM_ERROR');
    expect(NexusAnalyticsEvents).not.toHaveProperty('EXTERNAL_ERROR');
    expect(NexusAnalyticsEvents).not.toHaveProperty('USER_REJECTED');
    expect(NexusAnalyticsEvents).not.toHaveProperty('WALLET_CHANGED');
    expect(NexusAnalyticsEvents).not.toHaveProperty('WALLET_NETWORK_CHANGED');
    expect(NexusAnalyticsEvents).not.toHaveProperty('WALLET_DISCONNECTED');
    expect(NexusAnalyticsEvents).not.toHaveProperty('LIST_INTENTS'); // replaced by the _INITIATED/_SUCCESS/_FAILED triplet

    // Triplets added for newly-wrapped public ops.
    expect(NexusAnalyticsEvents.LIST_INTENTS_INITIATED).toBe('nexus_v2_list_intents_initiated');
    expect(NexusAnalyticsEvents.LIST_INTENTS_SUCCESS).toBe('nexus_v2_list_intents_success');
    expect(NexusAnalyticsEvents.LIST_INTENTS_FAILED).toBe('nexus_v2_list_intents_failed');
    expect(NexusAnalyticsEvents).not.toHaveProperty('CALCULATE_MAX_FOR_SWAP_INITIATED');
    expect(NexusAnalyticsEvents).not.toHaveProperty('CALCULATE_MAX_FOR_SWAP_SUCCESS');
    expect(NexusAnalyticsEvents).not.toHaveProperty('CALCULATE_MAX_FOR_SWAP_FAILED');
    expect(NexusAnalyticsEvents).not.toHaveProperty('CALCULATE_MAX_FOR_BRIDGE_INITIATED');
    expect(NexusAnalyticsEvents).not.toHaveProperty('CALCULATE_MAX_FOR_BRIDGE_SUCCESS');
    expect(NexusAnalyticsEvents).not.toHaveProperty('CALCULATE_MAX_FOR_BRIDGE_FAILED');
  });

  it('locks the AnalyticsManager public surface after boundary cleanup', () => {
    // The typed `trackBridge` / `trackSwap` / etc. wrappers moved to
    // `core/sdk/operation-boundary.ts` (analytics layer must not depend on
    // core/swap types). The `attachWalletProvider` / `trackError` /
    // `trackOpFailure` methods were deleted (they leaked error details into
    // PostHog or duplicated SigNoz). The `wrap*Options` helpers became
    // boundary-internal. Re-adding any of these on AnalyticsManager would
    // re-introduce the layer violation or the error-leak surface — fail
    // explicitly to flag a future regression.
    const manager = new AnalyticsManager('testnet', { enabled: false });
    const proto = AnalyticsManager.prototype as unknown as Record<string, unknown>;
    for (const removed of [
      'trackError',
      'trackOpFailure',
      'attachWalletProvider',
      'wrapBridgeOptions',
      'wrapTransferOptions',
      'wrapBridgeAndExecuteOptions',
      'wrapSwapOptions',
      'wrapSwapAndExecuteOptions',
      'trackBridge',
      'trackTransfer',
      'trackBridgeSim',
      'trackTransferSim',
      'trackBridgeAndExecute',
      'trackBridgeAndExecuteSim',
      'trackExecute',
      'trackExecuteSim',
      'trackSwapExactIn',
      'trackSwapExactOut',
      'trackSwapAndExecute',
      'trackBalanceFetch',
      'trackInit',
      'trackListIntents',
      'trackCalculateMaxForBridge',
      'trackCalculateMaxForSwap',
      'trackWalletConnect',
    ]) {
      expect(proto[removed]).toBeUndefined();
    }
    // Surface that did move *in* (kept generic, no cross-layer imports).
    expect(typeof manager.runOp).toBe('function');
    expect(typeof manager.scopedTimingHooks).toBe('function');
  });
});
