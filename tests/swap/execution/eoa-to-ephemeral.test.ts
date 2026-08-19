import { describe, expect, it, vi } from 'vitest';
import type { Hex, PublicClient, WalletClient } from 'viem';

vi.mock('../../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn(),
}));

import { signPermitForAddressAndValue } from '../../../src/services/allowance-utils';
import { resolvePreparedFundingTransferCalls } from '../../../src/swap/execution/eoa-to-ephemeral';
import { PermitVariant } from '../../../src/domain/permits';
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

  it('emits the complete EOA approval lifecycle as an allowance step', async () => {
    const onProgress = vi.fn();
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
      reason: 'source',
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      amount: 1_000_000n,
      targetAddress: SAFE,
      authorization: {
        kind: 'approve',
        call: { to: TOKEN, data: '0x', value: 0n },
        permit: null,
      },
      transferCall: { to: TOKEN, data: '0x', value: 0n },
    };

    await resolvePreparedFundingTransferCalls({
      transfer,
      tokenDecimals: 6,
      chain: {
        id: CHAIN_ID,
        name: 'Citrea',
        blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.example' } },
      } as never,
      eoaAddress: EOA,
      eoaWallet,
      publicClient,
      safeDeploymentPromise: Promise.resolve({} as EnsureSafeAccountV2Response),
      onProgress,
    });

    expect(onProgress.mock.calls.map(([update]) => update.state)).toEqual([
      'wallet_prompted',
      'submitted',
      'confirmed',
    ]);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stepType: 'allowance',
        stepId: `allowance:source:${CHAIN_ID}:${TOKEN}`,
        state: 'submitted',
        txHash: '0xapproval',
      })
    );
  });

  it('emits a signed terminal state for a permit authorization', async () => {
    vi.mocked(signPermitForAddressAndValue).mockResolvedValue(
      (`0x${'11'.repeat(64)}1b`) as Hex
    );
    const onProgress = vi.fn();
    const transfer: PreparedEoaToEphemeralTransfer = {
      reason: 'destination',
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      amount: 1_000_000n,
      targetAddress: SAFE,
      authorization: {
        kind: 'permit',
        call: null,
        permit: {
          signature: null,
          permitVariant: PermitVariant.EIP2612Canonical,
          permitContractVersion: 1,
        },
      },
      transferCall: { to: TOKEN, data: '0x', value: 0n },
    };

    await resolvePreparedFundingTransferCalls({
      transfer,
      tokenDecimals: 6,
      chain: { id: CHAIN_ID, name: 'Citrea' } as never,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      publicClient: { readContract: vi.fn() } as unknown as PublicClient,
      safeDeploymentPromise: Promise.resolve({} as EnsureSafeAccountV2Response),
      onProgress,
    });

    expect(onProgress.mock.calls.map(([update]) => update.state)).toEqual([
      'wallet_prompted',
      'signed',
    ]);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stepType: 'allowance',
        stepId: `allowance:destination:${CHAIN_ID}:${TOKEN}`,
        state: 'signed',
      })
    );
  });
});
