import type { Hex, WalletClient } from 'viem';
import type { ChainListType, TimingSpanHooks } from '../domain';

export type ExecuteDeps = {
  chainList: ChainListType;
  timing?: TimingSpanHooks;
  evm: {
    walletClient: WalletClient;
    address: Hex;
  };
};
