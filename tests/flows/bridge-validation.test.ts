import type { Hex } from 'viem';
import { describe, it } from 'vitest';
import { createBridgeAndTransferParams } from '../../src/bridge/transfer-adapter';
import { createBridgeParams } from '../../src/bridge/params';
import { createChainList } from '../../src/services/chain-list';
import { testDeployment } from '../fixtures/deployment';
import { expectInvalidInput } from '../helpers/expect-invalid-input';

describe('bridge param validation', () => {
  it('rejects invalid recipient in createBridgeParams', async () => {
    const chainList = createChainList(testDeployment);
    const dstChain = chainList.chains[0];
    const { token } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    if (!token) {
      throw new Error('Test setup failed: USDC token not found on destination chain');
    }
    await expectInvalidInput(() =>
      createBridgeParams(
        {
          toTokenSymbol: token.symbol,
          toAmountRaw: 1n,
          toChainId: dstChain.id,
          recipient: 'not-an-address' as Hex,
        },
        chainList
      )
    );
  });

  it('rejects invalid recipient in createBridgeAndTransferParams', async () => {
    const chainList = createChainList(testDeployment);
    const dstChain = chainList.chains[0];
    const { token } = chainList.getChainAndTokenFromSymbol(dstChain.id, 'USDC');
    if (!token) {
      throw new Error('Test setup failed: USDC token not found on destination chain');
    }
    await expectInvalidInput(() =>
      createBridgeAndTransferParams(
        {
          toTokenSymbol: token.symbol,
          toAmountRaw: 1n,
          toChainId: dstChain.id,
          recipient: 'not-an-address' as Hex,
        },
        chainList
      )
    );
  });
});
