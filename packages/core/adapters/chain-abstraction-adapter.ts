import { Network } from '@nexus/commons';
import { isSupportedChain, isSupportedToken } from './core/validation';
// Services
import { ExecuteService } from './services/execute-service';
import { BridgeExecuteService } from './services/bridge-execute-service';
import {
  type BridgeAndExecuteParams,
  type BridgeAndExecuteResult,
  type ExecuteParams,
  type ExecuteResult,
  type ExecuteSimulation,
  type BridgeAndExecuteSimulationResult,
  type SUPPORTED_CHAINS_IDS,
  logger,
} from '@nexus/commons';
import { getSupportedChains } from 'sdk/ca-base/utils';
import { NexusSDK } from 'sdk';

/**
 * Provides a unified interface for chain abstraction operations.
 */
export class ChainAbstractionAdapter {
  private executeService: ExecuteService;
  private bridgeExecuteService: BridgeExecuteService;

  constructor(public nexusSDK: NexusSDK) {
    logger.debug('ChainAbstractionAdapter', { nexusSDK });

    // Initialize services
    this.executeService = new ExecuteService(this);
    this.bridgeExecuteService = new BridgeExecuteService(this);
    this.setGasEstimationEnabled(true);
  }

  public async getEVMClient() {
    return this.nexusSDK.getEVMClient();
  }

  /**
   * Execute a contract call using the execute service.
   */
  public async execute(params: ExecuteParams): Promise<ExecuteResult> {
    return this.executeService.execute(params);
  }

  /**
   * Simulate contract execution using the execute service.
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    return this.executeService.simulateExecute(params);
  }

  /**
   * Get the list of supported chains from the CA SDK.
   */
  public getSupportedChains(env?: Network): Array<{ id: number; name: string; logo: string }> {
    return getSupportedChains(env);
  }

  /**
   * Check if a chain is supported by the adapter.
   */
  public isSupportedChain(chainId: SUPPORTED_CHAINS_IDS): boolean {
    return isSupportedChain(chainId);
  }

  /**
   * Check if a token is supported by the adapter.
   */
  public isSupportedToken(token: string): boolean {
    return isSupportedToken(token);
  }

  /**
   * Bridge and execute operation - uses the BridgeExecuteService
   */
  public async bridgeAndExecute(params: BridgeAndExecuteParams): Promise<BridgeAndExecuteResult> {
    return this.bridgeExecuteService.bridgeAndExecute(params);
  }

  /**
   * Simulate bridge and execute operation
   */
  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    return this.bridgeExecuteService.simulateBridgeAndExecute(params);
  }

  /**
   * Enable or disable gas estimation for transactions
   * When enabled, gas estimation will run before each transaction execution
   * This helps identify potential failures early and provides cost estimates
   */
  private setGasEstimationEnabled(enabled: boolean): void {
    this.bridgeExecuteService.setGasEstimationEnabled(enabled);
    this.executeService.setGasEstimationEnabled(enabled);
  }
}
