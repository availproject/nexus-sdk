import type { Hex } from 'viem';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}

/**
 * State override for simulation - allows modifying blockchain state during simulation
 */
export interface StateOverride {
  [address: string]: {
    balance?: string; // Override ETH balance (hex)
    storage?: Record<string, string>; // Override storage slots (slot -> value)
    code?: string; // Override contract code (hex)
    nonce?: string; // Override account nonce (hex)
  };
}

/**
 * Enhanced simulation step for multi-step operations
 */
export interface EnhancedSimulationStep {
  type: 'funding' | 'approval' | 'execute' | 'bridge' | 'transfer';
  required: boolean;
  description: string;
  params: GasEstimationRequest;
  stateOverride?: StateOverride;
  expectedGas?: string;
  dependsOn?: string[]; // IDs of steps this depends on
  stepId?: string; // Unique identifier for this step
}

/**
 * Enhanced simulation result with detailed step breakdown
 */
export interface EnhancedSimulationResult {
  totalGasUsed: string;
  success: boolean;
  error?: string;
  steps: Array<{
    stepId: string;
    type: string;
    gasUsed: string;
    success: boolean;
    error?: string;
    stateChanges?: Record<string, unknown>;
  }>;
  stateOverrides?: StateOverride;
  simulationMetadata?: {
    blockNumber: string;
    timestamp: string;
    chainId: string;
  };
}

/**
 * Gas estimation request parameters for backend API
 */
export interface GasEstimationRequest {
  chainId: string; // Chain ID as string (e.g., "1" for Ethereum)
  from: string; // Sender address
  to: string; // Recipient address
  value?: string; // Transaction value in wei (hex)
  data?: string; // Transaction data (hex)
  gas?: string; // Gas limit (hex)
  gasPrice?: string; // Gas price (hex)
  maxFeePerGas?: string; // Max fee per gas (hex)
  maxPriorityFeePerGas?: string; // Max priority fee per gas (hex)
  blockNumber?: string | 'latest'; // Block number
}

/**
 * Enhanced gas estimation request with state override support
 */
export interface EnhancedGasEstimationRequest extends GasEstimationRequest {
  stateOverride?: StateOverride;
  simulationSteps?: EnhancedSimulationStep[];
  enableStateOverride?: boolean;
}

/**
 * Bundle simulation request for multiple steps
 */
export interface BundleSimulationRequest {
  chainId: string;
  simulations: Array<{
    stepId: string;
    type: string;
    from: string;
    to: string;
    data?: string;
    value?: string;
    stateOverride?: StateOverride;
  }>;
}

/**
 * Backend bundle simulation response (raw format)
 */
export interface BackendBundleResponse {
  success: boolean;
  data: Array<{
    gasLimit: Hex;
    gasUsed: Hex;
  }>;
  chainId: string;
  requestId: string;
  message: string;
}

/**
 * Bundle simulation response (processed format)
 */
export interface BundleSimulationResponse {
  success: boolean;
  results: Array<{
    stepId: string;
    gasUsed: string;
    success: boolean;
    error?: string;
  }>;
  totalGasUsed: string;
}

/**
 * Gas estimation response from backend API
 */
export interface GasEstimationResponse {
  gasLimit: string; // Estimated gas limit (hex)
  gasUsed: string; // Estimated gas used (hex)
  gasPrice?: string; // Gas price (hex)
  maxFeePerGas?: string; // Max fee per gas (hex)
  maxPriorityFeePerGas?: string; // Max priority fee per gas (hex)
}

/**
 * Enhanced gas estimation response with state change details
 */
export interface EnhancedGasEstimationResponse extends GasEstimationResponse {
  stateChanges?: Record<string, unknown>;
  simulationTrace?: unknown;
  revertReason?: string;
  success: boolean;
}

/**
 * Chain support response
 */
export interface ChainSupportResponse {
  chainId: string; // Chain ID
  supported: boolean; // Whether chain is supported
  networkName?: string; // Tenderly network name (if supported)
}

/**
 * Service status response
 */
export interface ServiceStatusResponse {
  configured: boolean; // Is Tenderly service configured
  supportedChainsCount: number; // Number of supported chains
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'ok' | 'error'; // Service status
  timestamp: string; // ISO timestamp
  uptime: number; // Uptime in seconds
  environment: string; // Environment
  version: string; // Version
}

/**
 * Backend configuration interface
 */
export interface BackendConfig {
  baseUrl: string;
}
