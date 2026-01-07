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
