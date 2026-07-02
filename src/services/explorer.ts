import type { Hex } from 'viem';

export const getIntentExplorerUrl = (baseURL: string, hash: string) => {
  if (!baseURL) {
    return '';
  }
  return new URL(`/rff/${hash}`, baseURL).toString();
};

export const createExplorerTxURL = (txHash: Hex, explorerURL?: string) => {
  if (!explorerURL) {
    return '';
  }
  return new URL(`/tx/${txHash}`, explorerURL).href;
};
