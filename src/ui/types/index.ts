import { ReactNode } from 'react';
import {
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  BridgeParams,
  BridgeResult,
  EthereumProvider,
  SimulationResult,
  TransferParams,
  TransferResult,
  UserAsset,
} from '../../types';
import { NexusSDK } from '../..';

// # 1. High-Level State Machines

export type TransactionType = 'bridge' | 'transfer' | 'bridgeAndExecute';

export type OrchestratorStatus =
  | 'idle'
  | 'initializing'
  | 'review'
  | 'processing'
  | 'success'
  | 'error'
  | 'simulation_error';

export type ReviewStatus = 'gathering_input' | 'simulating' | 'needs_allowance' | 'ready';

// # 2. Generic Data Structures for UI

export interface ActiveTransaction {
  type: TransactionType | null;
  status: OrchestratorStatus;
  reviewStatus: ReviewStatus;
  inputData: Partial<BridgeParams> | Partial<TransferParams> | null;
  // Generic holder for simulation data to be displayed in the review screen
  simulationResult:
    | ((SimulationResult | BridgeAndExecuteSimulationResult) & {
        allowance?: {
          needsApproval: boolean;
          // Add other allowance details here later
        };
      })
    | null;
  // Generic holder for the final transaction result
  executionResult: BridgeResult | BridgeAndExecuteResult | TransferResult | null;
  error: Error | null;
}

// # 3. Controller Interface

export interface ITransactionController {
  // The UI component for gathering inputs for this transaction type
  InputForm: React.FC<{
    prefill: any;
    onUpdate: (data: any) => void;
    isBusy: boolean;
    tokenBalance?: string;
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
  config: NexusConfig;
  provider: EthereumProvider | null;
  unifiedBalance: UserAsset[];
  isSimulating: boolean;
  insufficientBalance: boolean;
  isTransactionCollapsed: boolean;
  timer: number;

  // Transaction processing state (from useListenTransaction)
  processing: ProcessingState;
  explorerURL: string | null;

  // Actions
  setProvider: (provider: EthereumProvider) => void;
  initializeSdk: () => Promise<boolean>;
  startTransaction: (
    type: TransactionType,
    prefillData?: Partial<BridgeParams> | Partial<TransferParams>, // Support both Bridge and Transfer
  ) => void;
  updateInput: (data: Partial<BridgeParams> | Partial<TransferParams>) => void;
  confirmAndProceed: () => void;
  cancelTransaction: () => void;
  triggerSimulation: () => Promise<void>;
  retrySimulation: () => void;
  toggleTransactionCollapse: () => void;
}

// # 5. Existing Widget Configuration Types (with minor updates)

export interface BaseComponentProps {
  className?: string;
}

export interface NexusConfig {
  network: 'mainnet' | 'testnet';
  apiKey?: string;
  theme?: 'light' | 'dark';
  debug?: boolean;
}

export interface BridgeConfig extends Partial<BridgeParams> {}

export interface BridgeButtonProps extends BaseComponentProps {
  prefill?: BridgeConfig;
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
  children: (props: { onClick: () => void; isLoading: boolean }) => ReactNode;
}

// Transfer Widget Types
export interface TransferConfig extends Partial<TransferParams> {}

export interface TransferButtonProps extends BaseComponentProps {
  prefill?: TransferConfig;
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
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
  title?: string;
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
