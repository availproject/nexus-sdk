import { formatEther, hexToBigInt } from 'viem';
import {
  ApiResponse,
  BackendConfig,
  ChainSupportResponse,
  GasEstimationRequest,
  GasEstimationResponse,
  HealthCheckResponse,
  ServiceStatusResponse,
  BundleSimulationRequest,
  BundleSimulationResponse,
  BackendBundleResponse,
} from './types';
import { CHAIN_METADATA } from '../../constants';
import { logger } from '../utils';

/**
 * Backend simulation result interface
 */
export interface BackendSimulationResult {
  gasUsed: string;
  gasPrice: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  success: boolean;
  errorMessage?: string;
  estimatedCost: {
    totalFee: string;
  };
}

const BACKEND_URL = 'https://nexus-backend.avail.so';

/**
 * Backend client for gas estimation using new API
 */

export class BackendSimulationClient {
  private readonly baseUrl: string;

  constructor(config: BackendConfig) {
    this.baseUrl = config.baseUrl;
  }

  /**
   * Check if a specific chain is supported
   */
  async isChainSupported(chainId: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/gas-estimation/check-chain/${chainId}`);
      if (!response.ok) return false;

      const result: ApiResponse<ChainSupportResponse> = await response.json();
      return result.success && result.data?.supported === true;
    } catch (error) {
      logger.warn(`Error checking chain support for ${chainId}:`, error);
      return false;
    }
  }

  /**
   * Get all supported chains
   */
  async getSupportedChains(): Promise<Record<string, string> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/gas-estimation/supported-chains`);
      if (!response.ok) return null;

      const result: ApiResponse<Record<string, string>> = await response.json();
      return result.success ? result.data || null : null;
    } catch (error) {
      logger.warn('Error fetching supported chains:', error);
      return null;
    }
  }

  /**
   * Get service status
   */
  async getServiceStatus(): Promise<ServiceStatusResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/gas-estimation/status`);
      if (!response.ok) return null;

      const result: ApiResponse<ServiceStatusResponse> = await response.json();
      return result.success ? result.data || null : null;
    } catch (error) {
      logger.warn('Error fetching service status:', error);
      return null;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthCheckResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`);
      if (!response.ok) return null;

      const result: ApiResponse<HealthCheckResponse> = await response.json();
      return result.success ? result.data || null : null;
    } catch (error) {
      logger.warn('Error performing health check:', error);
      return null;
    }
  }

  /**
   * Test connectivity and service health
   */
  async testConnection(): Promise<boolean> {
    try {
      const health = await this.healthCheck();
      return health?.status === 'ok';
    } catch (error) {
      logger.warn('Connection test failed:', error);
      return false;
    }
  }

  /**
   * Get detailed service information
   */
  async getServiceInfo(): Promise<{
    healthy: boolean;
    configured: boolean;
    supportedChains: number;
    version?: string;
    uptime?: number;
  }> {
    try {
      const [health, status] = await Promise.all([this.healthCheck(), this.getServiceStatus()]);

      return {
        healthy: health?.status === 'ok',
        configured: status?.configured || false,
        supportedChains: status?.supportedChainsCount || 0,
        version: health?.version,
        uptime: health?.uptime,
      };
    } catch (error) {
      logger.warn('Error getting service info:', error);
      return {
        healthy: false,
        configured: false,
        supportedChains: 0,
      };
    }
  }

  /**
   * Simulate transaction using Tenderly's Gateway RPC with state overrides
   * This provides more accurate simulation results than basic gas estimation
   */
  async simulate(request: GasEstimationRequest): Promise<BackendSimulationResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/gas-estimation/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Simulation API error: ${response.status} - ${errorText}`);
      }

      const result: ApiResponse<GasEstimationResponse> = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || result.message || 'Simulation failed');
      }

      const gasData = result.data;

      return {
        gasUsed: gasData.gasUsed,
        gasPrice: gasData.gasPrice || '0x0',
        maxFeePerGas: gasData.maxFeePerGas,
        maxPriorityFeePerGas: gasData.maxPriorityFeePerGas,
        success: true,
        estimatedCost: {
          totalFee: gasData?.gasUsed || '0',
        },
      };
    } catch (error) {
      logger.error('Simulation API error:', error as Error);
      return {
        gasUsed: '0x0',
        gasPrice: '0x0',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        estimatedCost: {
          totalFee: '0',
        },
      };
    }
  }

  /**
   * Fetch current gas price via RPC
   */
  private async getCurrentGasPrice(chainId: string): Promise<bigint> {
    try {
      const rpcUrl = this.getRpcUrl(chainId);

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_gasPrice',
          params: [],
          id: 1,
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC request failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(`RPC error: ${result.error.message}`);
      }

      // Convert hex gas price to bigint
      return hexToBigInt(result.result);
    } catch (error) {
      logger.warn('Failed to fetch current gas price, using fallback:', error);
      // Fallback to 20 gwei if RPC call fails
      return BigInt('20000000000'); // 20 gwei in wei
    }
  }

  /**
   * Get RPC URL for a given chain ID using CHAIN_METADATA
   */
  private getRpcUrl(chainId: string): string {
    const chainIdNum = parseInt(chainId, 10);
    const chainMetadata = CHAIN_METADATA[chainIdNum];

    if (!chainMetadata || !chainMetadata.rpcUrls || chainMetadata.rpcUrls.length === 0) {
      throw new Error(`No RPC URL available for chain ${chainId}`);
    }

    // Use the first RPC URL from the metadata
    return chainMetadata.rpcUrls[0];
  }

  async simulateBundle(request: BundleSimulationRequest): Promise<BundleSimulationResponse> {
    try {
      logger.info('DEBUG simulateBundle - request:', JSON.stringify(request, null, 2));

      const response = await fetch(`${this.baseUrl}/api/gas-estimation/bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bundle simulation API error: ${response.status} - ${errorText}`);
      }

      const result: BackendBundleResponse = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.message || 'Bundle simulation failed');
      }

      logger.info('DEBUG simulateBundle - backend response:', result);

      // Fetch current gas price via RPC
      const currentGasPrice = await this.getCurrentGasPrice(request.chainId);
      logger.info('DEBUG - Raw gas price from RPC (wei):', currentGasPrice.toString());
      logger.info('DEBUG - Gas price in gwei:', (Number(currentGasPrice) / 1e9).toFixed(2));
      logger.info('DEBUG - Chain ID:', request.chainId);

      // Transform backend response to human-readable format
      const transformedResults = result.data.map((item, index) => {
        const gasUsed = hexToBigInt(item.gasUsed);
        logger.info('DEBUG - Gas used (units):', gasUsed.toString());
        const gasCostWei = gasUsed * currentGasPrice;
        logger.info('DEBUG - Gas cost (wei):', gasCostWei.toString());
        const gasCostEther = formatEther(gasCostWei);

        return {
          stepId: request.simulations[index]?.stepId || `step-${index}`,
          gasUsed: gasCostEther, // Human-readable cost like "0.004205"
          success: true,
          error: undefined,
        };
      });

      // Calculate total cost
      const totalGasCostWei = result.data.reduce((sum, item) => {
        const gasUsed = hexToBigInt(item.gasUsed);
        return sum + gasUsed * currentGasPrice;
      }, BigInt(0));

      const totalGasCostEther = formatEther(totalGasCostWei);

      logger.info('DEBUG simulateBundle - transformed response:', {
        results: transformedResults,
        totalGasUsed: totalGasCostEther,
        gasPriceUsed: formatEther(currentGasPrice * BigInt(1000000000)) + ' gwei',
      });

      return {
        success: true,
        results: transformedResults,
        totalGasUsed: totalGasCostEther,
      };
    } catch (error) {
      logger.error('Bundle simulation API error:', error as Error);
      return {
        success: false,
        results: request.simulations.map((sim) => ({
          stepId: sim.stepId,
          gasUsed: '0.0',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })),
        totalGasUsed: '0.0',
      };
    }
  }
}

/**
 * Factory function to create a backend simulation client
 */
export function createBackendSimulationClient(config: BackendConfig): BackendSimulationClient {
  return new BackendSimulationClient(config);
}

/**
 * Default backend simulation client instance
 */
let defaultSimulationClient: BackendSimulationClient | null = null;

/**
 * Configure the default simulation client
 */
export function configureSimulationBackend(config: BackendConfig): void {
  defaultSimulationClient = new BackendSimulationClient(config);
}

/**
 * Get the default simulation client
 */
export function getSimulationClient(): BackendSimulationClient | null {
  return defaultSimulationClient;
}

/**
 * Check if simulation backend is configured
 */
export function isSimulationConfigured(): boolean {
  return defaultSimulationClient !== null;
}

/**
 * Initialize simulation client with health check
 */
export async function initializeSimulationClient(baseUrl: string = BACKEND_URL): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = new BackendSimulationClient({ baseUrl });

    // Test the connection
    const isHealthy = await client.testConnection();
    if (!isHealthy) {
      return {
        success: false,
        error: `Backend service at ${baseUrl} is not responding or unhealthy`,
      };
    }

    // Configure as default client
    defaultSimulationClient = client;

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown initialization error',
    };
  }
}

// Initialize with BACKEND_URL by default
configureSimulationBackend({ baseUrl: BACKEND_URL });
