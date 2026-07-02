import type { Hex } from 'viem';

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
export interface SimulationRequest {
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

export interface TenderlyGasEstimationResponse {
  gasLimit: Hex;
  gasUsed: Hex;
}

/**
 * Backend bundle simulation response (raw format)
 */
export type SimulationResponse = TenderlyGasEstimationResponse[];

/**
 * Backend configuration interface
 */
