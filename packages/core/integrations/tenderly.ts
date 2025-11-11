import {
  type ApiResponse,
  type BackendConfig,
  type ChainSupportResponse,
  type HealthCheckResponse,
  type ServiceStatusResponse,
  type BundleSimulationRequest,
  type BackendBundleResponse,
} from './types';
import { logger } from '@nexus/commons';
import axios from 'axios';
import { Errors } from 'sdk/ca-base/errors';

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

  async simulateBundleV2(request: BundleSimulationRequest) {
    logger.info('DEBUG simulateBundle - request:', JSON.stringify(request, null, 2));

    const { data } = await axios.post<BackendBundleResponse>(
      new URL(`/api/gas-estimation/bundle`, this.baseUrl).href,
      request,
    );

    if (!data.success || !data.data) {
      throw Errors.simulationError(data.message ?? 'Bundle simulation failed');
    }

    const gasUsed = data.data.reduce((acc, d) => {
      return acc + BigInt(d.gasUsed);
    }, 0n);

    const gasLimit = data.data.reduce((acc, d) => {
      return acc + BigInt(d.gasLimit);
    }, 0n);

    return { gasUsed, gasLimit };
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
