import { ReactNode } from 'react';
import { NexusSDK } from '@avail-project/nexus-core';

// Only import essential parameter types, not all from root types
import type {
  BridgeParams,
  TransferParams,
  BridgeAndExecuteParams,
  SUPPORTED_TOKENS,
  SUPPORTED_CHAINS_IDS,
  DynamicParamBuilder,
  SimulationResult,
  SwapInputOptionalParams,
  SwapIntent,
  UserAsset,
  EthereumProvider,
  ExactInSwapInput,
} from '@nexus/commons';

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

export interface SwapInputData {
  fromChainID?: 10 | 137 | 42161 | 534352 | 8453;
  toChainID?: SUPPORTED_CHAINS_IDS;
  fromTokenAddress?: 'USDC' | 'WETH' | 'DAI' | 'USDT' | 'USDS';
  toTokenAddress?:
    | 'USDC'
    | 'LDO'
    | 'DAI'
    | 'USDT'
    | 'KAITO'
    | 'ZRO'
    | 'PEPE'
    | 'ETH'
    | 'OP'
    | 'AAVE'
    | 'UNI'
    | 'OM';
  fromAmount?: string;
  toAmount?: string;
}

export interface UnifiedInputData {
  chainId?: number;
  toChainId?: number;
  token?: string;
  inputToken?: string;
  outputToken?: string;
  amount?: string | number;
  recipient?: string;
}

interface SwapResult {
  success: boolean;
  error?: string;
  sourceExplorerUrl?: string;
  destinationExplorerUrl?: string;
}

export interface SwapSimulationResult {
  success: boolean;
  error?: string;
  intent?: SwapIntent;
  swapMetadata?: {
    type: 'swap';
    inputToken: string;
    outputToken: string;
    fromChainId?: number;
    toChainId?: number;
    inputAmount: string;
    outputAmount: string;
  };
  allowance: {
    needsApproval: false;
    chainDetails: [];
  };
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

export type TransactionType = 'bridge' | 'transfer' | 'bridgeAndExecute' | 'swap';

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
    | Partial<SwapInputData>
    | null;
  prefillFields?: {
    chainId?: boolean;
    toChainId?: boolean;
    token?: boolean;
    inputToken?: boolean;
    outputToken?: boolean;
    amount?: boolean;
    recipient?: boolean;
    fromChainID?: boolean;
    toChainID?: boolean;
    fromTokenAddress?: boolean;
    toTokenAddress?: boolean;
    fromAmount?: boolean;
    toAmount?: boolean;
  };
  simulationResult:
    | ((SimulationResult | BridgeAndExecuteSimulationResult | SwapSimulationResult) & {
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
  executionResult: BridgeResult | BridgeAndExecuteResult | TransferResult | SwapResult | null;
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
  ): Promise<BridgeResult | BridgeAndExecuteResult | TransferResult | SwapResult>;

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
  stepData?: any; // Can be ProgressStep, ProgressSteps, SwapStep, etc.
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
  explorerURLs?: { source?: string; destination?: string };

  // Actions
  setProvider: (provider: EthereumProvider) => void;
  initializeSdk: (ethProvider?: EthereumProvider) => Promise<boolean>;
  deinitializeSdk: () => Promise<void>;
  startTransaction: (
    type: TransactionType,
    prefillData?:
      | Partial<BridgeParams>
      | Partial<TransferParams>
      | Partial<BridgeAndExecuteParams>
      | Partial<SwapInputData>,
  ) => void;
  updateInput: (
    data:
      | Partial<BridgeParams>
      | Partial<TransferParams>
      | Partial<BridgeAndExecuteParams>
      | Partial<SwapInputData>,
  ) => void;
  confirmAndProceed: () => void;
  cancelTransaction: () => void;
  triggerSimulation: () => Promise<void>;
  retrySimulation: () => void;
  toggleTransactionCollapse: () => void;
  approveAllowance: (amount: string, isMinimum: boolean) => Promise<void>;
  denyAllowance: () => void;
  startAllowanceFlow: () => void;

  // Swap-specific functions
  initiateSwap: (inputData: SwapInputData) => Promise<void>;
  proceedWithSwap: () => void;
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

export interface SwapConfig {
  inputs: ExactInSwapInput;
  options?: SwapInputOptionalParams;
}

export interface SwapButtonProps extends BaseComponentProps {
  prefill?: Omit<SwapInputData, 'toAmount'>;
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
  onValueChange: (token: string, iconUrl?: string) => void;
  disabled?: boolean;
  network?: 'mainnet' | 'testnet';
  type?: TransactionType;
  chainId?: number;
  isDestination?: boolean;
}

export interface ChainSelectProps extends BaseComponentProps {
  value?: string;
  onValueChange: (chain: string) => void;
  disabled?: boolean;
  network?: 'mainnet' | 'testnet';
  isSource?: boolean;
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
  simulationResult: SimulationResult | BridgeAndExecuteSimulationResult | SwapSimulationResult;
  processing: ProcessingState;
  explorerURL: string | null;
  explorerURLs?: { source?: string; destination?: string };
  timer: number;
  description: string;
  error: Error | null;
  executionResult: BridgeResult | TransferResult | BridgeAndExecuteResult | SwapResult | null;
  disableCollapse?: boolean;
}
