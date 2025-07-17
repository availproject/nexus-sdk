import { ReactNode } from 'react';
import {
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  BridgeParams,
  BridgeResult,
  EthereumProvider,
  SimulationResult,
  TransferParams,
  TransferResult,
  UserAsset,
  SUPPORTED_TOKENS,
  SUPPORTED_CHAINS_IDS,
  ChainMetadata,
  TokenMetadata,
  NexusNetwork,
} from '../../types';
import { NexusSDK } from '../..';

import { Abi } from 'viem';

// # 1. High-Level State Machines

export type TransactionType = 'bridge' | 'transfer' | 'bridgeAndExecute';

export type OrchestratorStatus =
  | 'idle'
  | 'initializing'
  | 'review'
  | 'processing'
  | 'success'
  | 'error'
  | 'simulation_error'
  | 'set_allowance';

export type ReviewStatus = 'gathering_input' | 'simulating' | 'needs_allowance' | 'ready';

// # 2. Generic Data Structures for UI

export interface ActiveTransaction {
  type: TransactionType | null;
  status: OrchestratorStatus;
  reviewStatus: ReviewStatus;
  inputData:
    | Partial<BridgeParams>
    | Partial<TransferParams>
    | Partial<BridgeAndExecuteParams>
    | null;
  prefillFields?: {
    chainId?: boolean;
    toChainId?: boolean;
    token?: boolean;
    amount?: boolean;
    recipient?: boolean;
  };
  simulationResult:
    | ((SimulationResult | BridgeAndExecuteSimulationResult) & {
        allowance?: {
          needsApproval: boolean;
        };
      })
    | null;
  executionResult: BridgeResult | BridgeAndExecuteResult | TransferResult | null;
  error: Error | null;
}

export interface ITransactionController {
  // The UI component for gathering inputs for this transaction type
  InputForm: React.FC<{
    prefill: any;
    onUpdate: (data: any) => void;
    isBusy: boolean;
    tokenBalance?: string;
    prefillFields?: {
      chainId?: boolean;
      toChainId?: boolean;
      token?: boolean;
      amount?: boolean;
      recipient?: boolean;
    };
  }>;

  // The main action function that drives the review, simulation, and execution
  confirmAndProceed(
    sdk: NexusSDK,
    inputData: any,
    simulationResult: ActiveTransaction['simulationResult'],
  ): Promise<BridgeResult | BridgeAndExecuteResult>;

  // A helper to start the simulation and allowance check
  runReview(sdk: NexusSDK, inputData: any): Promise<ActiveTransaction['simulationResult']>;

  // A method to check if the controller has enough data to proceed with a review
  hasSufficientInput(inputData: any): boolean;
}

// # 4. Provider and Hook Types

// Processing state interface from useListenTransaction
export interface ProcessingStep {
  id: number;
  completed: boolean;
  progress: number; // 0-100
  stepData?: any;
}

export interface ProcessingState {
  currentStep: number;
  totalSteps: number;
  steps: ProcessingStep[];
  statusText: string;
  animationProgress: number;
}

export interface NexusContextValue {
  // State
  sdk: NexusSDK;
  activeTransaction: ActiveTransaction;
  isSdkInitialized: boolean;
  activeController: ITransactionController | null;
  config?: { network?: NexusNetwork; debug?: boolean };
  provider: EthereumProvider | null;
  unifiedBalance: UserAsset[];
  isSimulating: boolean;
  insufficientBalance: boolean;
  isTransactionCollapsed: boolean;
  timer: number;
  allowanceError: string | null;
  isSettingAllowance: boolean;

  // Transaction processing state (from useListenTransaction)
  processing: ProcessingState;
  explorerURL: string | null;

  // Actions
  setProvider: (provider: EthereumProvider) => void;
  initializeSdk: () => Promise<boolean>;
  startTransaction: (
    type: TransactionType,
    prefillData?: Partial<BridgeParams> | Partial<TransferParams> | Partial<BridgeAndExecuteParams>,
  ) => void;
  updateInput: (
    data: Partial<BridgeParams> | Partial<TransferParams> | Partial<BridgeAndExecuteParams>,
  ) => void;
  confirmAndProceed: () => void;
  cancelTransaction: () => void;
  triggerSimulation: () => Promise<void>;
  retrySimulation: () => void;
  toggleTransactionCollapse: () => void;
  approveAllowance: (amount: string, isMinimum: boolean) => Promise<void>;
  denyAllowance: () => void;
  startAllowanceFlow: () => void;
}

// # 5. Existing Widget Configuration Types (with minor updates)

export interface BaseComponentProps {
  className?: string;
}

export interface BridgeConfig extends Partial<BridgeParams> {}

export interface BridgeButtonProps extends BaseComponentProps {
  prefill?: BridgeConfig;
  children: (props: { onClick: () => void; isLoading: boolean }) => ReactNode;
}

// Transfer Widget Types
export interface TransferConfig extends Partial<TransferParams> {}

export interface TransferButtonProps extends BaseComponentProps {
  prefill?: TransferConfig;
  children: (props: { onClick: () => void; isLoading: boolean }) => ReactNode;
}

// Balance Widget Types
export interface BalanceWidgetProps extends BaseComponentProps {
  showChains?: boolean;
  showValue?: boolean;
  format?: 'short' | 'full';
}

// Modal Types
export interface ModalProps extends BaseComponentProps {
  isOpen: boolean;
  onClose: () => void;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  hideCloseButton?: boolean;
}

// Form Types
export interface TokenSelectProps extends BaseComponentProps {
  value?: string;
  onValueChange: (token: string) => void;
  disabled?: boolean;
  network?: 'mainnet' | 'testnet';
}

export interface ChainSelectProps extends BaseComponentProps {
  value?: string;
  onValueChange: (chain: string) => void;
  disabled?: boolean;
  network?: 'mainnet' | 'testnet';
}

export interface AmountInputProps extends BaseComponentProps {
  value?: string;
  onValueChange: (amount: string) => void;
  token?: string;
  balance?: string;
  disabled?: boolean;
  placeholder?: string;
}

// Transaction Types
export interface TransactionStep {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'active' | 'completed' | 'error';
}

export interface TransactionProgressProps extends BaseComponentProps {
  steps: TransactionStep[];
  currentStep: string;
  collapsible?: boolean;
}

export type DynamicParamBuilder = (
  token: SUPPORTED_TOKENS,
  amount: string,
  chainId: SUPPORTED_CHAINS_IDS,
  userAddress: `0x${string}`,
) => {
  functionParams: readonly unknown[];
  /** ETH value in wei (string). Omit or '0' for ERC-20 calls */
  value?: string;
};

export interface BridgeAndExecuteButtonProps extends BaseComponentProps {
  contractAddress: `0x${string}`;
  contractAbi: Abi;
  functionName: string;
  buildFunctionParams: DynamicParamBuilder;
  prefill?: {
    toChainId?: SUPPORTED_CHAINS_IDS;
    token?: SUPPORTED_TOKENS;
    amount?: string;
  };
  children: (props: { onClick: () => void; isLoading: boolean; disabled: boolean }) => ReactNode;
}

export interface ProcessorCardProps {
  status: OrchestratorStatus;
  cancelTransaction: () => void;
  toggleTransactionCollapse: () => void;
  sourceChainMeta: ChainMetadata[];
  destChainMeta: ChainMetadata | null;
  tokenMeta: TokenMetadata | null;
  transactionType: TransactionType;
  simulationResult: SimulationResult | BridgeAndExecuteSimulationResult;
  processing: ProcessingState;
  explorerURL: string | null;
  timer: number;
  description: string;
  error: Error | null;
  executionResult: BridgeResult | TransferResult | BridgeAndExecuteResult | null;
}
