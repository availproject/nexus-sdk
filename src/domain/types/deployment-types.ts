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

export type DeploymentChain = Omit<
  BaseDeploymentChain,
  'vaultAddress' | 'multicallAddress' | 'nativeCurrency' | 'tokens' | 'eip7702Enabled'
> & {
  vaultAddress: Hex;
  multicallAddress: Hex;
  nativeCurrency: DeploymentNativeCurrency;
  tokens: DeploymentToken[];
  explorerUrl: string;
  logo: string;
  supports7702?: boolean;
  swapSupported?: boolean;
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
