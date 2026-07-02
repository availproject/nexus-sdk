import { describe, expect, it } from 'vitest';
import { deploymentResponseSchema } from '../../src/transport/middleware';
import { createChainList } from '../../src/services/chain-list';
import { chainSupports7702 } from '../../src/swap/wallet/capabilities';

const HYPER_EVM_WIRE_PAYLOAD = {
  network: 'mainnet',
  statekeeperUrl: 'https://statekeeper.example',
  fulfillmentBps: 0,
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
      eip7702Enabled: false,
      swapSupported: true,
    },
  ],
};

describe('HyperEVM end-to-end: wire → routing decision', () => {
  it('routes to Safe (non-Calibur) when middleware reports eip7702Enabled=false, swapSupported=true', () => {
    const parsed = deploymentResponseSchema.parse(HYPER_EVM_WIRE_PAYLOAD);
    const chainList = createChainList(parsed);
    const chain = chainList.getChainByID(999);

    expect(chain.supports7702).toBe(false);
    expect(chain.swapSupported).toBe(true);

    const is7702 = chainSupports7702(chain);
    expect(is7702).toBe(false);

    // The execution-time predicate at src/swap/execution/source-swaps.ts:385:
    //   if (chain && !chainSupports7702(chain)) { dispatchSafeSource(...) }
    const routesToSafe = !is7702;
    expect(routesToSafe).toBe(true);
  });
});
