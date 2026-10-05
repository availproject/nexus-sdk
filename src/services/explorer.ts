import type { Hex } from 'viem';

export const createExplorerTxURL = (txHash: Hex, explorerURL?: string) => {
  if (!explorerURL) {
    return '';
  }
  return new URL(`/tx/${txHash}`, explorerURL).href;
};
