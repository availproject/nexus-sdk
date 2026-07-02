import { describe, expect, it } from 'vitest';
import { createChainList } from '../../src/services/chain-list';
import { chainSupports7702 } from '../../src/swap/wallet/capabilities';
import type { DeploymentResponse } from '../../src/domain/types/deployment-types';

const hyperEvmDeployment = (
  supports7702: boolean,
  swapSupported?: boolean
): DeploymentResponse => ({
  network: 'mainnet',
  statekeeperUrl: 'https://statekeeper.example',
  fulfillmentBps: 0,
  mayanEnabled: false,
  mayanThresholdUsd: 0,
  mayanCancelRefundMaxPercentage: 0,
  chains: [
    {
      chainId: 999,
      universe: 'EVM',
      name: 'HyperEVM',
      rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
      vaultAddress: '0x0000000000000000000000000000000000000001',
      multicallAddress: '0x00000000000000000000000000000000000000aa',
      nativeCurrency: {
        name: 'Hype',
        symbol: 'HYPE',
        decimals: 18,
        logo: 'https://example.com/hype.png',
        currencyId: 100,
      },
      sponsored: false,
      tokens: [],
      explorerUrl: 'https://hyperliquid.cloud.blockscout.com',
      logo: 'https://example.com/chain.png',
      supports7702,
      ...(swapSupported !== undefined ? { swapSupported } : {}),
    },
  ],
});

describe('createChainList propagates supports7702', () => {
  it('copies supports7702=false from deployment chain onto runtime Chain', () => {
    const list = createChainList(hyperEvmDeployment(false));
    const chain = list.getChainByID(999);

    expect(chain.supports7702).toBe(false);
  });

  it('copies supports7702=true from deployment chain onto runtime Chain', () => {
    const list = createChainList(hyperEvmDeployment(true));
    const chain = list.getChainByID(999);

    expect(chain.supports7702).toBe(true);
  });

  it('routes non-7702 chain to Safe (chainSupports7702 returns false)', () => {
    const list = createChainList(hyperEvmDeployment(false));
    const chain = list.getChainByID(999);

    expect(chainSupports7702(chain)).toBe(false);
  });
});

describe('createChainList propagates swapSupported', () => {
  it('copies swapSupported=true from deployment chain onto runtime Chain', () => {
    const list = createChainList(hyperEvmDeployment(false, true));
    const chain = list.getChainByID(999);

    expect(chain.swapSupported).toBe(true);
  });

  it('copies swapSupported=false from deployment chain onto runtime Chain', () => {
    const list = createChainList(hyperEvmDeployment(true, false));
    const chain = list.getChainByID(999);

    expect(chain.swapSupported).toBe(false);
  });
});
