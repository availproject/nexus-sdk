import { describe, expect, it } from 'vitest';
import { createChainList } from '../../src/services/chain-list';
import type { DeploymentResponse } from '../../src/domain/types/deployment-types';

const hyperEvmDeployment = (swapSupported?: boolean): DeploymentResponse => ({
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
      ...(swapSupported !== undefined ? { swapSupported } : {}),
    },
  ],
});

describe('createChainList propagates swapSupported and uses Safe V2', () => {
  it('normalizes an omitted deployment flag to true and selects the V2 Safe', () => {
    const list = createChainList(hyperEvmDeployment());
    const chain = list.getChainByID(999);

    expect(chain.swapSupported).toBe(true);
  });

  it('copies swapSupported=true from deployment chain onto runtime Chain', () => {
    const list = createChainList(hyperEvmDeployment(true));
    const chain = list.getChainByID(999);

    expect(chain.swapSupported).toBe(true);
  });

  it('copies swapSupported=false from deployment chain onto runtime Chain', () => {
    const list = createChainList(hyperEvmDeployment(false));
    const chain = list.getChainByID(999);

    expect(chain.swapSupported).toBe(false);
  });

  it('copies the configured Calibur capability onto the runtime Chain', () => {
    const deployment = hyperEvmDeployment(true);
    Object.assign(deployment.chains[0], {
      supports7702: true,
      caliburAddress: '0x00000000000000000000000000000000000000cc',
    });

    const chain = createChainList(deployment).getChainByID(999);

    expect(chain).toMatchObject({
      swapSupported: true,
      supports7702: true,
      caliburAddress: '0x00000000000000000000000000000000000000cc',
    });
  });
});
