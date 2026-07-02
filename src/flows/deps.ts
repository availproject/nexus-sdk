import type { Hex, WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { ChainListType, TimingSpanHooks } from '../domain';
import type {
  MiddlewareBridgeAndExecuteClient,
  MiddlewareBridgeClient,
  MiddlewareSwapClient,
} from '../transport';

export type CommonFlowDeps = {
  chainList: ChainListType;
  timing?: TimingSpanHooks;
  intentExplorerUrl: string;
  evm: {
    walletClient: WalletClient;
    address: Hex;
  };
  forceMayan: boolean;
};

export type ExecuteDeps = CommonFlowDeps;

export type BridgeDeps = CommonFlowDeps & {
  middlewareClient: MiddlewareBridgeClient;
};

export type BridgeAndExecuteDeps = CommonFlowDeps & {
  middlewareClient: MiddlewareBridgeAndExecuteClient;
};

export type SwapDeps = CommonFlowDeps & {
  middlewareClient: MiddlewareSwapClient;
  swap: {
    ephemeralWallet: PrivateKeyAccount;
    cotCurrencyId: number;
  };
};

export type SwapAndExecuteDeps = SwapDeps;
