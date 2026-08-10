import { describe, expect, it, vi } from 'vitest';
import type { Hex, PublicClient, WalletClient } from 'viem';
import { resolvePreparedFundingTransferCalls } from '../../../src/swap/execution/eoa-to-ephemeral';
import type { EnsureSafeAccountV2Response } from '../../../src/swap/safe/types';
import type { PreparedEoaToEphemeralTransfer } from '../../../src/swap/types';

const CHAIN_ID = 4114;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const SAFE = '0xbbbb000000000000000000000000000000000002' as Hex;
const TOKEN = '0xcccc000000000000000000000000000000000003' as Hex;

describe('resolvePreparedFundingTransferCalls', () => {
  it('waits for Safe deployment before opening an EOA approval', async () => {
    let resolveDeployment!: () => void;
    const safeDeploymentPromise = new Promise<EnsureSafeAccountV2Response>((resolve) => {
      resolveDeployment = () =>
        resolve({
          chainId: CHAIN_ID,
          eoaAddress: EOA,
          ephemeralAddress: '0xdddd000000000000000000000000000000000004',
          address: SAFE,
          factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
          exists: true,
        });
    });
    const eoaWallet = {
      getChainId: vi.fn().mockResolvedValue(CHAIN_ID),
      writeContract: vi.fn().mockResolvedValue('0xapproval'),
    } as unknown as WalletClient;
    const publicClient = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error('not found')),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
      readContract: vi.fn(),
    } as unknown as PublicClient;
    const transfer: PreparedEoaToEphemeralTransfer = {
      reason: 'bridge',
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      amount: 1n,
      targetAddress: SAFE,
      authorization: {
        kind: 'approve',
        call: { to: TOKEN, data: '0x', value: 0n },
        permit: null,
      },
      transferCall: { to: TOKEN, data: '0x', value: 0n },
    };

    const resolution = resolvePreparedFundingTransferCalls({
      transfer,
      tokenDecimals: 6,
      chain: { id: CHAIN_ID, name: 'Citrea' } as never,
      eoaAddress: EOA,
      eoaWallet,
      publicClient,
      safeDeploymentPromise,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eoaWallet.writeContract).not.toHaveBeenCalled();
    resolveDeployment();
    await resolution;

    expect(eoaWallet.writeContract).toHaveBeenCalledTimes(1);
  });
});
