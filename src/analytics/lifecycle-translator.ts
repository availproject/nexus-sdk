import type { BridgeAndExecuteEvent, BridgeEvent, SwapAndExecuteEvent, SwapEvent } from '../domain';
import type { AnalyticsManager } from './AnalyticsManager';
import { type NexusAnalyticsEvent, NexusAnalyticsEvents } from './events';
import { extractPlanSummary, extractStepSummary } from './utils';

/**
 * Translates SDK operation lifecycle events into analytics tracks.
 *
 * Handles intermediate lifecycle states only. Top-level
 * `*_TRANSACTION_SUCCESS`/`*_TRANSACTION_FAILED` are emitted from client.ts
 * on promise settlement. For composite ops, per-leg success/failure events
 * are emitted here.
 *
 * Failure event hierarchy — read before writing dashboard queries:
 *
 *   Top-level     `*_TRANSACTION_FAILED`     "did this op fail?" (outcome)
 *   Lifecycle     `*_INTENT_SIGN_FAILED`     "which stage failed?" (sign)
 *                 `*_ALLOWANCE_DENIED`                              (allowance)
 *                 `*_DEPOSIT_FAILED`                                (vault deposit)
 *                 `*_FILL_FAILED`                                   (destination fill)
 *                 `*_LEG_FAILED` (composite)                        (per-leg)
 *
 * A single failure usually fires one stage-specific lifecycle event AND the
 * top-level event. They are distinct event names with distinct meanings and
 * the SDK does not dedupe them. Funnels that want a "failed bridges" count
 * should filter on `*_TRANSACTION_FAILED` (or the per-leg variant for
 * composite ops) — counting `event LIKE '%failed%'` will over-count.
 */

/**
 * A `track`-shaped callback used by all translators below. Built by
 * `makeTrack(analytics, flowId)` so the translator code can stay
 * `analytics`-agnostic — it just calls `track(event, props)` and gets
 * `flowId` + `elapsedMs` injected automatically.
 */
type Track = (event: NexusAnalyticsEvent, properties?: Record<string, unknown>) => void;

/**
 * Builds the `Track` callback used by every translator. When a `flowId` is
 * present it stamps the field on every event so per-step events correlate
 * back to a specific top-level op call. When no `flowId` is given the
 * callback is a plain pass-through to `analytics.track`.
 */
function makeTrack(analytics: AnalyticsManager, flowId?: string): Track {
  if (!flowId) {
    return (event, properties) => analytics.track(event, properties);
  }
  return (event, properties) => analytics.track(event, { ...properties, flowId });
}

// Plan-rejection detection lives on `AnalyticsManager.trackPlanRejectedIfApplicable`.

/**
 * Bridge-shaped lifecycle name set. Shared by bridge(), bridgeAndTransfer(),
 * and the bridge leg of bridgeAndExecute().
 */
type BridgeShapeNames = {
  PLAN_PREVIEW: NexusAnalyticsEvent;
  PLAN_CONFIRMED: NexusAnalyticsEvent;
  INTENT_SIGNED: NexusAnalyticsEvent;
  INTENT_SIGN_FAILED: NexusAnalyticsEvent;
  ALLOWANCE_REQUESTED: NexusAnalyticsEvent;
  ALLOWANCE_APPROVED: NexusAnalyticsEvent;
  ALLOWANCE_DENIED: NexusAnalyticsEvent;
  TRANSACTION_SIGNING_REQUESTED: NexusAnalyticsEvent;
  TRANSACTION_SUBMITTED: NexusAnalyticsEvent;
  VAULT_DEPOSIT_CONFIRMED: NexusAnalyticsEvent;
  DEPOSIT_FAILED: NexusAnalyticsEvent;
  FILL_FAILED: NexusAnalyticsEvent;
};

function translateBridgeShape(event: BridgeEvent, track: Track, names: BridgeShapeNames): void {
  if (event.type === 'plan_preview') {
    track(names.PLAN_PREVIEW, extractPlanSummary(event.plan));
    return;
  }
  if (event.type === 'plan_confirmed') {
    track(names.PLAN_CONFIRMED, extractPlanSummary(event.plan));
    return;
  }
  if (event.type !== 'plan_progress') return;

  switch (event.stepType) {
    case 'request_signing':
      if (event.state === 'completed') {
        track(names.INTENT_SIGNED, { intentRequestHash: event.intentRequestHash });
      } else if (event.state === 'failed') {
        track(names.INTENT_SIGN_FAILED);
      }
      return;
    case 'allowance_approval':
      if (event.state === 'wallet_prompted') {
        track(names.ALLOWANCE_REQUESTED, {
          ...extractStepSummary(event.step),
          spender: event.step.spender,
          requiredAmount: event.step.requiredAmount,
        });
      } else if (event.state === 'confirmed') {
        track(names.ALLOWANCE_APPROVED, {
          ...extractStepSummary(event.step),
          txHash: event.txHash,
        });
      } else if (event.state === 'failed') {
        track(names.ALLOWANCE_DENIED, {
          ...extractStepSummary(event.step),
        });
      }
      return;
    case 'vault_deposit':
      // The full state set is `started | wallet_prompted | submitted | confirmed | completed | failed`.
      // We intentionally skip `started` (pre-prompt internal bookkeeping with
      // no user-observable signal) and `completed` (SDK-side wrap-up after
      // `confirmed`; the on-chain mining event already fired). The chosen
      // states match the lifecycle the analytics funnels reason about:
      // user-prompted → submitted-to-chain → mined → failed.
      if (event.state === 'wallet_prompted') {
        track(names.TRANSACTION_SIGNING_REQUESTED, extractStepSummary(event.step));
      } else if (event.state === 'submitted') {
        track(names.TRANSACTION_SUBMITTED, {
          ...extractStepSummary(event.step),
          txHash: event.txHash,
        });
      } else if (event.state === 'confirmed') {
        // Source-chain deposit landed on-chain.
        track(names.VAULT_DEPOSIT_CONFIRMED, {
          ...extractStepSummary(event.step),
          txHash: 'txHash' in event ? event.txHash : undefined,
        });
      } else if (event.state === 'failed') {
        // Source-chain deposit reverted or was rejected by the wallet.
        track(names.DEPOSIT_FAILED, {
          ...extractStepSummary(event.step),
        });
      }
      return;
    case 'bridge_fill':
      // Destination-chain settlement. Success is emitted at the promise level
      // by client.ts; only failure fires here.
      if (event.state === 'failed') {
        track(names.FILL_FAILED, {
          intentRequestHash: event.intentRequestHash,
        });
      }
      return;
    default:
      return;
  }
}

/** Translates bridge() lifecycle events into BRIDGE_* analytics tracks. */
export function translateBridgeEvent(
  event: BridgeEvent,
  analytics: AnalyticsManager,
  flowId?: string
): void {
  translateBridgeShape(event, makeTrack(analytics, flowId), {
    PLAN_PREVIEW: NexusAnalyticsEvents.BRIDGE_PLAN_PREVIEW,
    PLAN_CONFIRMED: NexusAnalyticsEvents.BRIDGE_PLAN_CONFIRMED,
    INTENT_SIGNED: NexusAnalyticsEvents.BRIDGE_INTENT_SIGNED,
    INTENT_SIGN_FAILED: NexusAnalyticsEvents.BRIDGE_INTENT_SIGN_FAILED,
    ALLOWANCE_REQUESTED: NexusAnalyticsEvents.BRIDGE_ALLOWANCE_REQUESTED,
    ALLOWANCE_APPROVED: NexusAnalyticsEvents.BRIDGE_ALLOWANCE_APPROVED,
    ALLOWANCE_DENIED: NexusAnalyticsEvents.BRIDGE_ALLOWANCE_DENIED,
    TRANSACTION_SIGNING_REQUESTED: NexusAnalyticsEvents.BRIDGE_TRANSACTION_SIGNING_REQUESTED,
    TRANSACTION_SUBMITTED: NexusAnalyticsEvents.BRIDGE_TRANSACTION_SUBMITTED,
    VAULT_DEPOSIT_CONFIRMED: NexusAnalyticsEvents.BRIDGE_VAULT_DEPOSIT_CONFIRMED,
    DEPOSIT_FAILED: NexusAnalyticsEvents.BRIDGE_DEPOSIT_FAILED,
    FILL_FAILED: NexusAnalyticsEvents.BRIDGE_FILL_FAILED,
  });
}

/** Translates bridgeAndTransfer() lifecycle events into TRANSFER_* analytics tracks. */
export function translateTransferEvent(
  event: BridgeEvent,
  analytics: AnalyticsManager,
  flowId?: string
): void {
  translateBridgeShape(event, makeTrack(analytics, flowId), {
    PLAN_PREVIEW: NexusAnalyticsEvents.TRANSFER_PLAN_PREVIEW,
    PLAN_CONFIRMED: NexusAnalyticsEvents.TRANSFER_PLAN_CONFIRMED,
    INTENT_SIGNED: NexusAnalyticsEvents.TRANSFER_INTENT_SIGNED,
    INTENT_SIGN_FAILED: NexusAnalyticsEvents.TRANSFER_INTENT_SIGN_FAILED,
    ALLOWANCE_REQUESTED: NexusAnalyticsEvents.TRANSFER_ALLOWANCE_REQUESTED,
    ALLOWANCE_APPROVED: NexusAnalyticsEvents.TRANSFER_ALLOWANCE_APPROVED,
    ALLOWANCE_DENIED: NexusAnalyticsEvents.TRANSFER_ALLOWANCE_DENIED,
    TRANSACTION_SIGNING_REQUESTED: NexusAnalyticsEvents.TRANSFER_TRANSACTION_SIGNING_REQUESTED,
    TRANSACTION_SUBMITTED: NexusAnalyticsEvents.TRANSFER_TRANSACTION_SUBMITTED,
    VAULT_DEPOSIT_CONFIRMED: NexusAnalyticsEvents.TRANSFER_VAULT_DEPOSIT_CONFIRMED,
    DEPOSIT_FAILED: NexusAnalyticsEvents.TRANSFER_DEPOSIT_FAILED,
    FILL_FAILED: NexusAnalyticsEvents.TRANSFER_FILL_FAILED,
  });
}

/**
 * Translates swap() lifecycle events into SWAP_* analytics tracks. The first
 * wallet prompt maps to TRANSACTION_SIGNING_REQUESTED.
 */
export function translateSwapEvent(
  event: SwapEvent,
  analytics: AnalyticsManager,
  flowId?: string
): void {
  const track = makeTrack(analytics, flowId);
  if (event.type === 'plan_preview') {
    track(NexusAnalyticsEvents.SWAP_PLAN_PREVIEW, extractPlanSummary(event.plan));
    return;
  }
  if (event.type === 'plan_confirmed') {
    track(NexusAnalyticsEvents.SWAP_PLAN_CONFIRMED, extractPlanSummary(event.plan));
    return;
  }
  if (event.type !== 'plan_progress') return;

  const onChainStepTypes = new Set([
    'source_swap',
    'eoa_to_ephemeral_transfer',
    'bridge_deposit',
    'destination_swap',
  ]);

  // bridge_intent_submission is the relayer-side submit (not on-chain).
  if (event.stepType === 'bridge_intent_submission' && event.state === 'failed') {
    track(NexusAnalyticsEvents.SWAP_INTENT_RELAY_FAILED);
    return;
  }

  if (!onChainStepTypes.has(event.stepType)) return;

  if (event.state === 'wallet_prompted') {
    track(NexusAnalyticsEvents.SWAP_TRANSACTION_SIGNING_REQUESTED, {
      stepType: event.stepType,
      ...extractStepSummary(event.step),
    });
  } else if (event.state === 'submitted') {
    track(NexusAnalyticsEvents.SWAP_TRANSACTION_SUBMITTED, {
      stepType: event.stepType,
      ...extractStepSummary(event.step),
      txHash: 'txHash' in event ? event.txHash : undefined,
    });
  } else if (event.state === 'confirmed' && event.stepType !== 'destination_swap') {
    // Mid-flow on-chain confirmation. destination_swap success is emitted at
    // the promise level.
    track(NexusAnalyticsEvents.SWAP_STEP_CONFIRMED, {
      stepType: event.stepType,
      ...extractStepSummary(event.step),
      txHash: 'txHash' in event ? event.txHash : undefined,
    });
  } else if (event.state === 'failed') {
    // Per-step on-chain failure; distinct from top-level SWAP_TRANSACTION_FAILED.
    track(NexusAnalyticsEvents.SWAP_STEP_FAILED, {
      stepType: event.stepType,
      ...extractStepSummary(event.step),
    });
  }
}

/** Translates bridgeAndExecute() lifecycle events into BRIDGE_AND_EXECUTE_* analytics tracks. */
export function translateBridgeAndExecuteEvent(
  event: BridgeAndExecuteEvent,
  analytics: AnalyticsManager,
  flowId?: string
): void {
  const track = makeTrack(analytics, flowId);
  if (event.type === 'plan_preview') {
    track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_PLAN_PREVIEW, extractPlanSummary(event.plan));
    return;
  }
  if (event.type === 'plan_confirmed') {
    track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_PLAN_CONFIRMED, extractPlanSummary(event.plan));
    return;
  }
  if (event.type !== 'plan_progress') return;

  switch (event.stepType) {
    case 'request_signing':
      if (event.state === 'completed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_INTENT_SIGNED, {
          intentRequestHash: event.intentRequestHash,
        });
      } else if (event.state === 'failed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_INTENT_SIGN_FAILED);
      }
      return;
    case 'allowance_approval':
      if (event.state === 'wallet_prompted') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_ALLOWANCE_REQUESTED, {
          ...extractStepSummary(event.step),
          spender: event.step.spender,
          requiredAmount: event.step.requiredAmount,
        });
      } else if (event.state === 'confirmed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_ALLOWANCE_APPROVED, {
          ...extractStepSummary(event.step),
          txHash: event.txHash,
        });
      } else if (event.state === 'failed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_ALLOWANCE_DENIED, {
          ...extractStepSummary(event.step),
        });
      }
      return;
    case 'vault_deposit':
      if (event.state === 'wallet_prompted') {
        track(
          NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_SIGNING_REQUESTED,
          extractStepSummary(event.step)
        );
      } else if (event.state === 'submitted') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_SUBMITTED, {
          ...extractStepSummary(event.step),
          txHash: event.txHash,
        });
      } else if (event.state === 'confirmed') {
        // Source-chain deposit landed on-chain (mid-flow).
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_DEPOSIT_CONFIRMED, {
          ...extractStepSummary(event.step),
          txHash: 'txHash' in event ? event.txHash : undefined,
        });
      } else if (event.state === 'failed') {
        // Source-chain deposit reverted. Emits both the specific DEPOSIT_FAILED
        // and the generic _LEG_FAILED.
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_DEPOSIT_FAILED, {
          ...extractStepSummary(event.step),
        });
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_FAILED, {
          stage: 'deposit',
          ...extractStepSummary(event.step),
        });
      }
      return;
    case 'bridge_fill':
      if (event.state === 'completed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_SUCCESS, {
          intentRequestHash: event.intentRequestHash,
        });
      } else if (event.state === 'failed') {
        // Destination fill failed. Emits both FILL_FAILED and _LEG_FAILED.
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_FILL_FAILED, {
          intentRequestHash: event.intentRequestHash,
        });
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_BRIDGE_LEG_FAILED, {
          stage: 'fill',
          intentRequestHash: event.intentRequestHash,
        });
      }
      return;
    case 'execute_approval':
      if (event.state === 'wallet_prompted') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_REQUESTED, {
          ...extractStepSummary(event.step),
          spender: event.step.spender,
        });
      } else if (event.state === 'confirmed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_APPROVED, {
          ...extractStepSummary(event.step),
          txHash: event.txHash,
        });
      } else if (event.state === 'failed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_DENIED, {
          ...extractStepSummary(event.step),
        });
      }
      return;
    case 'execute_transaction':
      if (event.state === 'wallet_prompted') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_EXECUTE_LEG_SIGNING_REQUESTED, {
          ...extractStepSummary(event.step),
          contractAddress: event.step.to,
        });
      } else if (event.state === 'submitted') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_EXECUTE_LEG_SUBMITTED, {
          ...extractStepSummary(event.step),
          contractAddress: event.step.to,
          txHash: event.txHash,
        });
      } else if (event.state === 'confirmed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_EXECUTE_LEG_SUCCESS, {
          ...extractStepSummary(event.step),
          contractAddress: event.step.to,
          txHash: event.txHash,
        });
      } else if (event.state === 'failed') {
        track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_EXECUTE_LEG_FAILED, {
          ...extractStepSummary(event.step),
          contractAddress: event.step.to,
        });
      }
      return;
    default:
      return;
  }
}

/** Translates swapAndExecute() lifecycle events into SWAP_AND_EXECUTE_* analytics tracks. */
export function translateSwapAndExecuteEvent(
  event: SwapAndExecuteEvent,
  analytics: AnalyticsManager,
  flowId?: string
): void {
  const track = makeTrack(analytics, flowId);
  if (event.type === 'plan_preview') {
    track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_PLAN_PREVIEW, extractPlanSummary(event.plan));
    return;
  }
  if (event.type === 'plan_confirmed') {
    track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_PLAN_CONFIRMED, extractPlanSummary(event.plan));
    return;
  }
  if (event.type !== 'plan_progress') return;

  const swapLegStepTypes = new Set([
    'source_swap',
    'eoa_to_ephemeral_transfer',
    'bridge_deposit',
    'destination_swap',
  ]);

  if (event.stepType === 'bridge_intent_submission' && event.state === 'failed') {
    // Relayer-side intent submission failure on the swap leg.
    track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_INTENT_RELAY_FAILED);
    return;
  }

  if (swapLegStepTypes.has(event.stepType)) {
    if (event.state === 'wallet_prompted') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_SIGNING_REQUESTED, {
        stepType: event.stepType,
        ...extractStepSummary(event.step),
      });
    } else if (event.state === 'submitted') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_SUBMITTED, {
        stepType: event.stepType,
        ...extractStepSummary(event.step),
        txHash: 'txHash' in event ? event.txHash : undefined,
      });
    } else if (event.state === 'failed') {
      // Per-step swap-leg failure. Emits both the specific step event and
      // _LEG_FAILED.
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_STEP_FAILED, {
        stepType: event.stepType,
        ...extractStepSummary(event.step),
      });
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_FAILED, {
        stepType: event.stepType,
        ...extractStepSummary(event.step),
      });
    } else if (event.state === 'confirmed' && event.stepType === 'destination_swap') {
      // destination_swap terminates same-chain legs; cross-chain legs settle
      // via bridge_fill below.
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_SUCCESS, {
        stepType: 'destination_swap',
        ...extractStepSummary(event.step),
      });
    } else if (event.state === 'confirmed') {
      // Mid-flow on-chain confirmation for non-terminal swap-leg steps.
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_STEP_CONFIRMED, {
        stepType: event.stepType,
        ...extractStepSummary(event.step),
        txHash: 'txHash' in event ? event.txHash : undefined,
      });
    }
    return;
  }

  if (event.stepType === 'bridge_fill') {
    if (event.state === 'completed') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_SUCCESS, {
        stepType: 'bridge_fill',
        intentRequestHash: event.intentRequestHash,
      });
    } else if (event.state === 'failed') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_SWAP_LEG_FAILED, {
        stepType: 'bridge_fill',
        intentRequestHash: event.intentRequestHash,
      });
    }
    return;
  }

  if (event.stepType === 'execute_approval') {
    if (event.state === 'wallet_prompted') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_REQUESTED, {
        ...extractStepSummary(event.step),
        spender: event.step.spender,
      });
    } else if (event.state === 'confirmed') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_APPROVED, {
        ...extractStepSummary(event.step),
        txHash: event.txHash,
      });
    } else if (event.state === 'failed') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_EXECUTE_LEG_ALLOWANCE_DENIED, {
        ...extractStepSummary(event.step),
      });
    }
    return;
  }

  if (event.stepType === 'execute_transaction') {
    if (event.state === 'wallet_prompted') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_EXECUTE_LEG_SIGNING_REQUESTED, {
        ...extractStepSummary(event.step),
        contractAddress: event.step.to,
      });
    } else if (event.state === 'submitted') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_EXECUTE_LEG_SUBMITTED, {
        ...extractStepSummary(event.step),
        contractAddress: event.step.to,
        txHash: event.txHash,
      });
    } else if (event.state === 'confirmed') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_EXECUTE_LEG_SUCCESS, {
        ...extractStepSummary(event.step),
        contractAddress: event.step.to,
        txHash: event.txHash,
      });
    } else if (event.state === 'failed') {
      track(NexusAnalyticsEvents.SWAP_AND_EXECUTE_EXECUTE_LEG_FAILED, {
        ...extractStepSummary(event.step),
        contractAddress: event.step.to,
      });
    }
  }
}
