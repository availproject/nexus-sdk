import type {
  Chain as BaseDeploymentChain,
  DeploymentConfig as BaseDeploymentConfig,
  NativeCurrency as BaseDeploymentNativeCurrency,
  TokenConfig as BaseDeploymentToken,
} from '@avail-project/nexus-types';
import type { Hex } from 'viem';

export type DeploymentResponse = Omit<BaseDeploymentConfig, 'chains'> & {
  network: string;
  chains: DeploymentChain[];
};

export type DeploymentChain = Pick<
  BaseDeploymentChain,
  | 'chainId'
  | 'universe'
  | 'name'
  | 'rpcUrl'
  | 'port'
  | 'sponsored'
  | 'tenderlyNetwork'
  | 'ankrChainName'
  | 'swapTokens'
  | 'gasBufferMultiplier'
  | 'mayanEnabled'
> & {
  vaultAddress: Hex;
  multicallAddress: Hex;
  nativeCurrency: DeploymentNativeCurrency;
  tokens: DeploymentToken[];
  explorerUrl: string;
  logo: string;
  swapSupported?: boolean;
  supports7702?: boolean;
  caliburAddress?: Hex;
};

export type DeploymentNativeCurrency = BaseDeploymentNativeCurrency & {
  logo: string;
  mayanEnabled?: boolean;
};

export type DeploymentToken = Omit<BaseDeploymentToken, 'address' | 'permitVersion'> & {
  address: Hex;
  logo: string;
  permitVersion?: number;
  mayanEnabled?: boolean;
};
