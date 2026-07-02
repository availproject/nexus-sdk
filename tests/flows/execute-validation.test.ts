import { describe, it } from 'vitest';
import type { ExecuteParams } from '../../src/domain';
import { bridgeAndExecute } from '../../src/flows/bridge-and-execute';
import { execute } from '../../src/flows/execute';
import { createChainList } from '../../src/services/chain-list';
import { testDeployment } from '../fixtures/deployment';
import { expectInvalidInput } from '../helpers/expect-invalid-input';

const makeQuery = () => {
  const chainList = createChainList(testDeployment);
  const evmClient = {
    getAddresses: async () => ['0x0000000000000000000000000000000000000001'],
    sendTransaction: async () => '0x' as `0x${string}`,
  };

  const middlewareClient = {
    simulateBundleV2: async () => ({ gas: [21_000n] }),
  } as never;
  const deps = {
    chainList,
    middlewareClient,
    intentExplorerUrl: 'https://bridge.example',
    evm: {
      walletClient: evmClient as never,
      address: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    },
  };

  return {
    execute: (params: ExecuteParams) => execute(params, deps),
    bridgeAndExecute: (params: Parameters<typeof bridgeAndExecute>[0]) =>
      bridgeAndExecute(params, deps),
  };
};

describe('execute validation', () => {
  it('rejects invalid execute params before any chain access', async () => {
    const query = makeQuery();
    const invalidParams: ExecuteParams = {
      toChainId: 1,
      to: 'not-an-address' as `0x${string}`,
    };

    await expectInvalidInput(() => query.execute(invalidParams));
  });

  it('rejects invalid execute data hex', async () => {
    const query = makeQuery();
    const invalidParams: ExecuteParams = {
      toChainId: 1,
      to: '0x0000000000000000000000000000000000000001',
      data: '0xzz' as `0x${string}`,
    };

    await expectInvalidInput(() => query.execute(invalidParams));
  });

  it('rejects negative gas in execute params', async () => {
    const query = makeQuery();
    const invalidParams: ExecuteParams = {
      toChainId: 1,
      to: '0x0000000000000000000000000000000000000001',
      gas: -1n,
    };

    await expectInvalidInput(() => query.execute(invalidParams));
  });

  it('rejects invalid tokenApproval spender', async () => {
    const query = makeQuery();
    const invalidParams: ExecuteParams = {
      toChainId: 1,
      to: '0x0000000000000000000000000000000000000001',
      tokenApproval: {
        toTokenSymbol: 'USDC',
        amount: 1n,
        spender: 'not-an-address' as `0x${string}`,
      },
    };

    await expectInvalidInput(() => query.execute(invalidParams));
  });

  it('rejects invalid bridge-and-execute params before any chain access', async () => {
    const query = makeQuery();
    const invalidParams = {
      toChainId: 1,
      toTokenSymbol: 'USDC',
      toAmountRaw: 1n,
      execute: {
        to: 'not-an-address',
        value: 0n,
      },
    };

    await expectInvalidInput(() => query.bridgeAndExecute(invalidParams as never));
  });

  it('rejects invalid bridge-and-execute recentApprovalTxHash', async () => {
    const query = makeQuery();
    const invalidParams = {
      toChainId: 1,
      toTokenSymbol: 'USDC',
      toAmountRaw: 1n,
      recentApprovalTxHash: 'bad-hash',
      execute: {
        to: '0x0000000000000000000000000000000000000001',
        value: 0n,
      },
    };

    await expectInvalidInput(() => query.bridgeAndExecute(invalidParams as never));
  });
});
