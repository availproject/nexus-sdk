import axios from 'axios';
import type { Hex } from 'viem';
import { logger } from '../commons';
import { Errors } from '../core/errors';

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
 * Backend configuration interface
 */
export interface BackendConfig {
  baseUrl: string;
}

/**
 * Factory function to create a backend simulation client
 */
export function createBackendSimulationClient(config: BackendConfig): BackendSimulationClient {
  return new BackendSimulationClient(config);
}

/**
 * Backend client for gas estimation using new API
 */

export class BackendSimulationClient {
  private readonly baseUrl: string;

  constructor(config: BackendConfig) {
    this.baseUrl = config.baseUrl;
  }

  async simulateBundleV2(request: BundleSimulationRequest) {
    logger.debug('DEBUG simulateBundle - request:', JSON.stringify(request, null, 2));

    const { data } = await axios.post<BackendBundleResponse>(
      new URL('/api/gas-estimation/bundleV2', this.baseUrl).href,
      request
    );

    if (!data.success || !data.data) {
      throw Errors.simulationError(data.message ?? 'Bundle simulation failed');
    }

    return { gas: data.data.map((d) => BigInt(d.gasLimit)) };
  }
}
