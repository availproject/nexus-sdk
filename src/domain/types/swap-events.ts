import type { Hex } from 'viem';
import type {
  BridgeFillProgressEvent,
  BridgeFillStep,
  ExecuteApprovalProgressEvent,
  ExecutePlanStep,
  ExecuteTransactionProgressEvent,
} from './bridge-events';
import type {
  PlanConfirmedEvent,
  PlanPreviewEvent,
  PlanProgressFailedBase,
  StatusEvent,
} from './event-common';
import type { PlanTokenAmount } from './plan-common';

export type SwapStatus =
  | 'route_building'
  | 'route_ready'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'completed';

export type SwapStatusEvent = StatusEvent<SwapStatus>;

export type SwapPlan = {
  hasBridge: boolean;
  hasDestinationSwap: boolean;
  steps: SwapPlanStep[];
};

export type SwapSourceSwapStep = {
  type: 'source_swap';
  id: string;
  chain: {
    id: number;
    name: string;
    logo: string;
  };
  walletPath: 'ephemeral' | 'safe';
  swaps: {
    input: PlanTokenAmount;
    output: PlanTokenAmount;
  }[];
};

export type SwapEoaToEphemeralTransferStep = {
  type: 'eoa_to_ephemeral_transfer';
  id: string;
  chain: {
    id: number;
    name: string;
    logo: string;
  };
  asset: PlanTokenAmount;
};

export type SwapBridgeDepositStep = {
  type: 'bridge_deposit';
  id: string;
  chain: {
    id: number;
    name: string;
    logo: string;
  };
  asset: PlanTokenAmount;
};

export type SwapBridgeIntentSubmissionStep = {
  type: 'bridge_intent_submission';
  id: string;
};

export type SwapDestinationSwapStep = {
  type: 'destination_swap';
  id: string;
  chain: {
    id: number;
    name: string;
    logo: string;
  };
  walletPath: 'ephemeral' | 'safe';
  swaps: {
    input: PlanTokenAmount;
    output: PlanTokenAmount;
  }[];
};

export type SwapPlanStep =
  | SwapSourceSwapStep
  | SwapEoaToEphemeralTransferStep
  | SwapBridgeDepositStep
  | SwapBridgeIntentSubmissionStep
  | BridgeFillStep
  | SwapDestinationSwapStep;

export type SwapPlanPreviewEvent = PlanPreviewEvent<SwapPlan>;
export type SwapPlanConfirmedEvent = PlanConfirmedEvent<SwapPlan>;
export type SwapPlanProgressFailedBase = PlanProgressFailedBase<SwapPlanStep>;

export type SwapSourceSwapProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'source_swap';
      state: 'wallet_prompted';
      step: SwapSourceSwapStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'source_swap';
      state: 'started';
      step: SwapSourceSwapStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'source_swap';
      state: 'submitted';
      step: SwapSourceSwapStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'source_swap';
      state: 'confirmed';
      step: SwapSourceSwapStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'source_swap';
      state: 'failed';
      step: SwapSourceSwapStep;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    };

export type SwapEoaToEphemeralTransferProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'eoa_to_ephemeral_transfer';
      state: 'wallet_prompted';
      step: SwapEoaToEphemeralTransferStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'eoa_to_ephemeral_transfer';
      state: 'submitted';
      step: SwapEoaToEphemeralTransferStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'eoa_to_ephemeral_transfer';
      state: 'confirmed';
      step: SwapEoaToEphemeralTransferStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'eoa_to_ephemeral_transfer';
      state: 'failed';
      step: SwapEoaToEphemeralTransferStep;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    };

export type SwapBridgeDepositProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'bridge_deposit';
      state: 'started';
      step: SwapBridgeDepositStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'bridge_deposit';
      state: 'submitted';
      step: SwapBridgeDepositStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'bridge_deposit';
      state: 'confirmed';
      step: SwapBridgeDepositStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'bridge_deposit';
      state: 'failed';
      step: SwapBridgeDepositStep;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    };

export type SwapBridgeIntentSubmissionProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'bridge_intent_submission';
      state: 'started';
      step: SwapBridgeIntentSubmissionStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'bridge_intent_submission';
      state: 'completed';
      step: SwapBridgeIntentSubmissionStep;
      intentRequestHash: Hex;
    }
  | {
      type: 'plan_progress';
      stepType: 'bridge_intent_submission';
      state: 'failed';
      step: SwapBridgeIntentSubmissionStep;
      intentRequestHash?: Hex;
      error: string;
    };

export type SwapBridgeFillProgressEvent = BridgeFillProgressEvent;

export type SwapDestinationSwapProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'destination_swap';
      state: 'wallet_prompted';
      step: SwapDestinationSwapStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'destination_swap';
      state: 'started';
      step: SwapDestinationSwapStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'destination_swap';
      state: 'submitted';
      step: SwapDestinationSwapStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'destination_swap';
      state: 'confirmed';
      step: SwapDestinationSwapStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'destination_swap';
      state: 'failed';
      step: SwapDestinationSwapStep;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    };

export type SwapPlanProgressEvent =
  | SwapSourceSwapProgressEvent
  | SwapEoaToEphemeralTransferProgressEvent
  | SwapBridgeDepositProgressEvent
  | SwapBridgeIntentSubmissionProgressEvent
  | SwapBridgeFillProgressEvent
  | SwapDestinationSwapProgressEvent;

export type SwapEvent =
  | SwapStatusEvent
  | SwapPlanPreviewEvent
  | SwapPlanConfirmedEvent
  | SwapPlanProgressEvent;

export type SwapAndExecuteStatus =
  | 'preparing'
  | 'route_building'
  | 'route_ready'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'completed';

export type SwapAndExecuteStatusEvent = StatusEvent<SwapAndExecuteStatus>;

export type SwapAndExecutePlanStep = SwapPlanStep | ExecutePlanStep;

export type SwapAndExecutePlan = {
  swapRequired: boolean;
  steps: SwapAndExecutePlanStep[];
};

export type SwapAndExecutePlanPreviewEvent = PlanPreviewEvent<SwapAndExecutePlan>;
export type SwapAndExecutePlanConfirmedEvent = PlanConfirmedEvent<SwapAndExecutePlan>;

export type SwapAndExecutePlanProgressEvent =
  | SwapPlanProgressEvent
  | ExecuteApprovalProgressEvent
  | ExecuteTransactionProgressEvent;

export type SwapAndExecuteEvent =
  | SwapAndExecuteStatusEvent
  | SwapAndExecutePlanPreviewEvent
  | SwapAndExecutePlanConfirmedEvent
  | SwapAndExecutePlanProgressEvent;
