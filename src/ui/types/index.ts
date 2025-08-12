import { ReactNode } from 'react';
import { EthereumProvider, UserAsset } from '@arcana/ca-sdk';
import { NexusSDK } from '../../core/sdk';

// Only import essential parameter types, not all from root types
import type {
  BridgeParams,
  TransferParams,
  BridgeAndExecuteParams,
  SUPPORTED_TOKENS,
  SUPPORTED_CHAINS_IDS,
  DynamicParamBuilder,
  SimulationResult,
} from '../../types';

import { Abi } from 'viem';

// Local result types for UI (to avoid importing all types)
interface BridgeResult {
  success: boolean;
  error?: string;
  explorerUrl?: string;
}

interface TransferResult {
  success: boolean;
  error?: string;
  explorerUrl?: string;
}

interface BridgeAndExecuteResult {
  success: boolean;
  error?: string;
  executeTransactionHash?: string;
  executeExplorerUrl?: string;
  approvalTransactionHash?: string;
  toChainId: number;
}

interface BridgeAndExecuteSimulationResult {
  success: boolean;
  error?: string;
  steps: any[];
  bridgeSimulation: SimulationResult | null;
  executeSimulation?: any;
}

// Local metadata types for UI
interface ChainMetadata {
  id: number;
  name: string;
  shortName: string;
  logo: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  coingeckoId: string;
  isNative?: boolean;
}

// Local network type for UI
type NexusNetwork = 'mainnet' | 'testnet';

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
          chainDetails?: Array<{
            chainId: number;
            amount: string;
            needsApproval: boolean;
          }>;
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
  provider: EthereumProvider | undefined;
  unifiedBalance: UserAsset[];
  isSimulating: boolean;
  insufficientBalance: boolean;
  isTransactionCollapsed: boolean;
  timer: number;
  allowanceError: string | null;
  isSettingAllowance: boolean;
  exchangeRates: Record<string, number>;
  // Transaction processing state (from useListenTransaction)
  processing: ProcessingState;
  explorerURL: string | null;

  // Actions
  setProvider: (provider: EthereumProvider) => void;
  initializeSdk: (ethProvider?: EthereumProvider) => Promise<boolean>;
  deinitializeSdk: () => Promise<void>;
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
  title?: string;
  className?: string;
  hasValues?: boolean;
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

// Re-export DynamicParamBuilder for convenience
export type { DynamicParamBuilder };

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
  disableCollapse?: boolean;
}
