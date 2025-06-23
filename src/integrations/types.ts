export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
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
