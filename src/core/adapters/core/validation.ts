import { SUPPORTED_CHAINS } from '../../../constants';
import type { SUPPORTED_CHAINS_IDS } from '../../../types';

/**
 * Common validation helpers for adapter services
 */

/**
 * Validate bridge/transfer parameters
 */
export function validateBridgeTransferParams(params: {
  chainId: SUPPORTED_CHAINS_IDS;
  token: string;
}): void {
  if (!isSupportedChain(params.chainId)) {
    throw new Error('Unsupported chain');
  }
  if (!isSupportedToken(params.token)) {
    throw new Error('Unsupported token');
  }
}

/**
 * Validation that returns result objects instead of throwing
 */
export function validateForResultReturn(params: {
  chainId: SUPPORTED_CHAINS_IDS;
  token: string;
  initialized: boolean;
}): { success: boolean; error?: string } {
  if (!isSupportedChain(params.chainId)) {
    return { success: false, error: 'Unsupported chain' };
  }
  if (!isSupportedToken(params.token)) {
    return { success: false, error: 'Unsupported token' };
  }
  if (!params.initialized) {
    return { success: false, error: 'CA SDK not initialized. Call initialize() first.' };
  }
  return { success: true };
}

/**
 * Check if a chain is supported
 */
export function isSupportedChain(chainId: SUPPORTED_CHAINS_IDS): boolean {
  return Object.values(SUPPORTED_CHAINS).includes(chainId);
}

/**
 * Check if a token is supported
 */
export function isSupportedToken(token: string): boolean {
  const supportedTokens = ['ETH', 'USDC', 'USDT'];
  return supportedTokens.includes(token.toUpperCase());
}

/**
 * Validate ExecuteParams with callback pattern
 */
export function validateExecuteParams(params: {
  toChainId: SUPPORTED_CHAINS_IDS;
  contractAddress: string;
  contractAbi: any;
  functionName: string;
  buildFunctionParams: Function;
  tokenApproval?: { token: string };
}): { success: boolean; error?: string } {
  // Validate chain
  if (!isSupportedChain(params.toChainId)) {
    return { success: false, error: `Unsupported chain: ${params.toChainId}` };
  }

  // Validate contract address
  if (!params.contractAddress || !params.contractAddress.startsWith('0x')) {
    return { success: false, error: 'Invalid contract address' };
  }

  // Validate contract ABI
  if (!params.contractAbi || !Array.isArray(params.contractAbi)) {
    return { success: false, error: 'Invalid contract ABI' };
  }

  // Validate function name
  if (!params.functionName || typeof params.functionName !== 'string') {
    return { success: false, error: 'Invalid function name' };
  }

  // Validate callback function
  if (!params.buildFunctionParams || typeof params.buildFunctionParams !== 'function') {
    return { success: false, error: 'buildFunctionParams must be a valid function' };
  }

  // Validate token approval if present
  if (params.tokenApproval) {
    if (!params.tokenApproval.token || !isSupportedToken(params.tokenApproval.token)) {
      return {
        success: false,
        error: `Unsupported token for approval: ${params.tokenApproval.token}`,
      };
    }
  }

  return { success: true };
}
