import {
  ApiResponse,
  BackendConfig,
  ChainSupportResponse,
  GasEstimationRequest,
  GasEstimationResponse,
  HealthCheckResponse,
  ServiceStatusResponse,
} from './types';

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
    wei: string;
    eth: string;
    gwei: string;
  };
}

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
      console.warn(`Error checking chain support for ${chainId}:`, error);
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
      console.warn('Error fetching supported chains:', error);
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
      console.warn('Error fetching service status:', error);
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
      console.warn('Error performing health check:', error);
      return null;
    }
  }

  /**
   * Estimate gas using the new API endpoint
   */
  async estimateGas(request: GasEstimationRequest): Promise<BackendSimulationResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/gas-estimation/estimate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gas estimation API error: ${response.status} - ${errorText}`);
      }

      const result: ApiResponse<GasEstimationResponse> = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || result.message || 'Gas estimation failed');
      }

      const gasData = result.data;

      // Convert hex values to decimal for calculations
      const gasUsedDecimal = parseInt(gasData.gasUsed, 16);
      const gasPriceDecimal = gasData.gasPrice ? parseInt(gasData.gasPrice, 16) : 0;
      const maxFeePerGasDecimal = gasData.maxFeePerGas ? parseInt(gasData.maxFeePerGas, 16) : 0;

      // Calculate cost using the higher of gasPrice or maxFeePerGas
      const effectiveGasPrice = Math.max(gasPriceDecimal, maxFeePerGasDecimal);
      const gasCostWei = BigInt(gasUsedDecimal) * BigInt(effectiveGasPrice);
      const gasCostEth = Number(gasCostWei) / 1e18;
      const gasCostGwei = Number(gasCostWei) / 1e9;

      return {
        gasUsed: gasData.gasUsed,
        gasPrice: gasData.gasPrice || '0x0',
        maxFeePerGas: gasData.maxFeePerGas,
        maxPriorityFeePerGas: gasData.maxPriorityFeePerGas,
        success: true,
        estimatedCost: {
          wei: gasCostWei.toString(),
          eth: gasCostEth.toFixed(6),
          gwei: gasCostGwei.toFixed(2),
        },
      };
    } catch (error) {
      console.error('Gas estimation API error:', error);
      return {
        gasUsed: '0x0',
        gasPrice: '0x0',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        estimatedCost: {
          wei: '0',
          eth: '0',
          gwei: '0',
        },
      };
    }
  }

  /**
   * Batch simulate multiple transactions
   */
  async batchSimulate(
    chainId: number,
    transactions: Array<{
      from: string;
      to: string;
      input: string;
      value?: string;
    }>,
  ): Promise<BackendSimulationResult[]> {
    try {
      // Since the new API doesn't have batch endpoint, run individual simulations in parallel
      const results = await Promise.all(
        transactions.map((tx) =>
          this.estimateGas({
            chainId: chainId.toString(),
            from: tx.from,
            to: tx.to,
            data: tx.input,
            value: tx.value,
          }),
        ),
      );
      return results;
    } catch (error) {
      console.warn('Batch simulation failed:', error);
      // Return empty results on error
      return transactions.map(() => ({
        gasUsed: '0x0',
        gasPrice: '0x0',
        success: false,
        errorMessage: 'Batch simulation failed',
        estimatedCost: {
          wei: '0',
          eth: '0',
          gwei: '0',
        },
      }));
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
      console.warn('Connection test failed:', error);
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
      console.warn('Error getting service info:', error);
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

      // Convert hex values to decimal for calculations
      const gasUsedDecimal = parseInt(gasData.gasUsed, 16);
      const gasPriceDecimal = gasData.gasPrice ? parseInt(gasData.gasPrice, 16) : 0;
      const maxFeePerGasDecimal = gasData.maxFeePerGas ? parseInt(gasData.maxFeePerGas, 16) : 0;

      // Calculate cost using the higher of gasPrice or maxFeePerGas
      const effectiveGasPrice = Math.max(gasPriceDecimal, maxFeePerGasDecimal);
      const gasCostWei = BigInt(gasUsedDecimal) * BigInt(effectiveGasPrice);
      const gasCostEth = Number(gasCostWei) / 1e18;
      const gasCostGwei = Number(gasCostWei) / 1e9;

      return {
        gasUsed: gasData.gasUsed,
        gasPrice: gasData.gasPrice || '0x0',
        maxFeePerGas: gasData.maxFeePerGas,
        maxPriorityFeePerGas: gasData.maxPriorityFeePerGas,
        success: true,
        estimatedCost: {
          wei: gasCostWei.toString(),
          eth: gasCostEth.toFixed(6),
          gwei: gasCostGwei.toFixed(2),
        },
      };
    } catch (error) {
      console.error('Simulation API error:', error);
      return {
        gasUsed: '0x0',
        gasPrice: '0x0',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        estimatedCost: {
          wei: '0',
          eth: '0',
          gwei: '0',
        },
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
export async function initializeSimulationClient(
  baseUrl: string = 'http://localhost:8080',
): Promise<{
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

// Initialize with localhost:8080 by default
configureSimulationBackend({ baseUrl: 'http://localhost:8080' });
