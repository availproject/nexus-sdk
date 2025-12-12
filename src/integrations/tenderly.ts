import {
  type BackendConfig,
  type BundleSimulationRequest,
  type BackendBundleResponse,
} from './types';
import { logger } from '../commons';
import axios from 'axios';
import { Errors } from '../sdk/ca-base/errors';

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
      new URL(`/api/gas-estimation/bundleV2`, this.baseUrl).href,
      request,
    );

    if (!data.success || !data.data) {
      throw Errors.simulationError(data.message ?? 'Bundle simulation failed');
    }

    return { gas: data.data.map((d) => BigInt(d.gasLimit)) };
  }
}
