import type { Hex } from 'viem';
import type {
  PlanConfirmedEvent,
  PlanPreviewEvent,
  PlanProgressFailedBase,
  StatusEvent,
} from './event-common';
import type { PlanTokenAmount, PlanTokenMetadata } from './plan-common';

type ChainDisplay = {
  id: number;
  name: string;
  logo: string;
};

export type BridgeStatus =
  | 'intent_building'
  | 'intent_ready'
  | 'awaiting_approval'
  | 'awaiting_allowance_selection'
  | 'approved'
  | 'executing'
  | 'completed';

export type BridgeStatusEvent = StatusEvent<BridgeStatus>;

export type BridgePlan = {
  steps: BridgePlanStep[];
};

export type BridgeAllowanceApprovalStep = {
  type: 'allowance_approval';
  id: string;
  chain: ChainDisplay;
  token: PlanTokenMetadata;
  spender: Hex;
  requiredAmount: string;
  requiredAmountRaw: string;
};

export type BridgeRequestSigningStep = {
  type: 'request_signing';
  id: string;
};

export type BridgeRequestSubmissionStep = {
  type: 'request_submission';
  id: string;
};

export type BridgeVaultDepositStep = {
  type: 'vault_deposit';
  id: string;
  chain: ChainDisplay;
  asset: PlanTokenAmount;
  assetType: 'native' | 'erc20';
  submissionMode: 'local_wallet' | 'middleware';
};

export type BridgeFillStep = {
  type: 'bridge_fill';
  id: string;
  chain: ChainDisplay;
  asset: PlanTokenAmount;
};

export type BridgePlanStep =
  | BridgeAllowanceApprovalStep
  | BridgeRequestSigningStep
  | BridgeRequestSubmissionStep
  | BridgeVaultDepositStep
  | BridgeFillStep;

export type BridgePlanPreviewEvent = PlanPreviewEvent<BridgePlan>;
export type BridgePlanConfirmedEvent = PlanConfirmedEvent<BridgePlan>;
export type BridgePlanProgressFailedBase = PlanProgressFailedBase<BridgePlanStep>;

export type BridgeAllowanceApprovalProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'allowance_approval';
      state: 'wallet_prompted';
      step: BridgeAllowanceApprovalStep;
      approvedAmount: string;
      approvedAmountRaw: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'allowance_approval';
      state: 'submitted';
      step: BridgeAllowanceApprovalStep;
      approvedAmount: string;
      approvedAmountRaw: string;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'allowance_approval';
      state: 'confirmed';
      step: BridgeAllowanceApprovalStep;
      approvedAmount: string;
      approvedAmountRaw: string;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'allowance_approval';
      state: 'failed';
      step: BridgeAllowanceApprovalStep;
      approvedAmount: string;
      approvedAmountRaw: string;
      error: string;
    };

export type BridgeRequestSigningProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'request_signing';
      state: 'wallet_prompted';
      step: BridgeRequestSigningStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'request_signing';
      state: 'completed';
      step: BridgeRequestSigningStep;
      intentRequestHash: Hex;
    }
  | {
      type: 'plan_progress';
      stepType: 'request_signing';
      state: 'failed';
      step: BridgeRequestSigningStep;
      error: string;
    };

export type BridgeRequestSubmissionProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'request_submission';
      state: 'started';
      step: BridgeRequestSubmissionStep;
      intentRequestHash: Hex;
    }
  | {
      type: 'plan_progress';
      stepType: 'request_submission';
      state: 'completed';
      step: BridgeRequestSubmissionStep;
      intentRequestHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'request_submission';
      state: 'failed';
      step: BridgeRequestSubmissionStep;
      intentRequestHash: Hex;
      error: string;
    };

export type BridgeVaultDepositProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'vault_deposit';
      state: 'started';
      step: BridgeVaultDepositStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'vault_deposit';
      state: 'wallet_prompted';
      step: BridgeVaultDepositStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'vault_deposit';
      state: 'submitted';
      step: BridgeVaultDepositStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'vault_deposit';
      state: 'confirmed';
      step: BridgeVaultDepositStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'vault_deposit';
      state: 'completed';
      step: BridgeVaultDepositStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'vault_deposit';
      state: 'failed';
      step: BridgeVaultDepositStep;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    };

export type BridgeFillProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'bridge_fill';
      state: 'waiting';
      step: BridgeFillStep;
      intentRequestHash: Hex;
    }
  | {
      type: 'plan_progress';
      stepType: 'bridge_fill';
      state: 'completed';
      step: BridgeFillStep;
      intentRequestHash: Hex;
    }
  | {
      type: 'plan_progress';
      stepType: 'bridge_fill';
      state: 'failed';
      step: BridgeFillStep;
      intentRequestHash: Hex;
      error: string;
    };

export type BridgePlanProgressEvent =
  | BridgeAllowanceApprovalProgressEvent
  | BridgeRequestSigningProgressEvent
  | BridgeRequestSubmissionProgressEvent
  | BridgeVaultDepositProgressEvent
  | BridgeFillProgressEvent;

export type BridgeEvent =
  | BridgeStatusEvent
  | BridgePlanPreviewEvent
  | BridgePlanConfirmedEvent
  | BridgePlanProgressEvent;

export type BridgeAndExecuteStatus =
  | 'preparing'
  | 'intent_building'
  | 'intent_ready'
  | 'awaiting_approval'
  | 'awaiting_allowance_selection'
  | 'approved'
  | 'executing'
  | 'completed';

export type BridgeAndExecuteStatusEvent = StatusEvent<BridgeAndExecuteStatus>;

export type ExecuteApprovalStep = {
  type: 'execute_approval';
  id: string;
  chain: ChainDisplay;
  token: PlanTokenMetadata;
  spender: Hex;
  amount: string;
  amountRaw: string;
};

export type ExecuteTransactionStep = {
  type: 'execute_transaction';
  id: string;
  chain: ChainDisplay;
  to: Hex;
};

export type ExecutePlanStep = ExecuteApprovalStep | ExecuteTransactionStep;

export type BridgeAndExecutePlanStep = BridgePlanStep | ExecutePlanStep;

export type BridgeAndExecutePlan = {
  bridgeRequired: boolean;
  steps: BridgeAndExecutePlanStep[];
};

export type BridgeAndExecutePlanPreviewEvent = PlanPreviewEvent<BridgeAndExecutePlan>;
export type BridgeAndExecutePlanConfirmedEvent = PlanConfirmedEvent<BridgeAndExecutePlan>;

export type ExecuteApprovalProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'execute_approval';
      state: 'wallet_prompted';
      step: ExecuteApprovalStep;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_approval';
      state: 'submitted';
      step: ExecuteApprovalStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_approval';
      state: 'confirmed';
      step: ExecuteApprovalStep;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_approval';
      state: 'failed';
      step: ExecuteApprovalStep;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    };

export type ExecuteTransactionProgressEvent =
  | {
      type: 'plan_progress';
      stepType: 'execute_transaction';
      state: 'wallet_prompted';
      step: ExecuteTransactionStep;
      value: string;
      hasData: boolean;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_transaction';
      state: 'submitted';
      step: ExecuteTransactionStep;
      value: string;
      hasData: boolean;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_transaction';
      state: 'confirmed';
      step: ExecuteTransactionStep;
      value: string;
      hasData: boolean;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      type: 'plan_progress';
      stepType: 'execute_transaction';
      state: 'failed';
      step: ExecuteTransactionStep;
      value: string;
      hasData: boolean;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    };

export type BridgeAndExecutePlanProgressEvent =
  | BridgePlanProgressEvent
  | ExecuteApprovalProgressEvent
  | ExecuteTransactionProgressEvent;

export type BridgeAndExecuteEvent =
  | BridgeAndExecuteStatusEvent
  | BridgeAndExecutePlanPreviewEvent
  | BridgeAndExecutePlanConfirmedEvent
  | BridgeAndExecutePlanProgressEvent;
