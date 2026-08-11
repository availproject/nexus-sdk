import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { Chain } from '../../domain';
import { switchChain } from '../../services/evm';
import {
  buildSafeExecuteEOACall,
  createSafeExecuteTxFromCalls,
  type SafeCall,
} from '../../services/safe';
import type {
  CreateSafeExecuteTxV2Request,
  CreateSafeExecuteTxV2Response,
  EnsureSafeAccountV2Response,
} from '../safe/types';
import { type EoaSimulationStep, simulateEoaTransaction } from './eoa-simulation';

export type SafeDispatchMiddleware = {
  createSafeExecuteTx: (
    req: CreateSafeExecuteTxV2Request
  ) => Promise<CreateSafeExecuteTxV2Response>;
};

// Dispatches a source-swap batch via the Safe V2 smart account. Two sub-paths:
//   - nativeValue === 0n → sponsor broadcasts (middleware.createSafeExecuteTx) — pays gas, no
//     native value carried.
//   - nativeValue >  0n → EOA broadcasts (eoaWallet.sendTransaction) — EOA pays gas + carries the
//     native value to the Safe. Sponsor flow can't do this because the sponsor wallet doesn't fund
//     native sends.
// In both cases the ephemeral signs SafeTx as one of the two threshold-1 Safe owners.
export async function dispatchSafeSource(input: {
  chain: Chain;
  chainId: number;
  calls: SafeCall[];
  nativeValue: bigint;
  ephemeralWallet: PrivateKeyAccount;
  eoaWallet: WalletClient;
  eoaAddress: Address;
  publicClient: PublicClient;
  middleware: SafeDispatchMiddleware;
  safeAddress: Address;
  safeDeploymentPromise: Promise<EnsureSafeAccountV2Response>;
  onWalletPrompt?: () => void;
  simulationStep?: EoaSimulationStep;
}): Promise<{ txHash: Hex; safeAddress: Address }> {
  const {
    chain,
    chainId,
    calls,
    nativeValue,
    ephemeralWallet,
    eoaWallet,
    eoaAddress,
    publicClient,
    middleware,
  } = input;
  const { safeAddress } = input;

  await input.safeDeploymentPromise;

  if (nativeValue > 0n) {
    const eoaCall = await buildSafeExecuteEOACall({
      calls,
      chainId,
      ephemeralWallet,
      publicClient,
      safeAddress,
      nativeValue,
    });
    await simulateEoaTransaction({
      publicClient,
      eoaAddress,
      chainId,
      transaction: eoaCall,
      step: input.simulationStep ?? {
        stepId: `source_swap:${chainId}`,
        stepType: 'source_swap',
        label: 'Native source transaction',
      },
    });
    input.onWalletPrompt?.();
    await switchChain(eoaWallet, chain);
    const txHash = await eoaWallet.sendTransaction({
      account: eoaAddress,
      to: eoaCall.to,
      data: eoaCall.data,
      value: eoaCall.value,
      chain,
    });
    return { txHash, safeAddress };
  }

  const request = await createSafeExecuteTxFromCalls({
    calls,
    chainId,
    eoaAddress,
    ephemeralWallet,
    publicClient,
    safeAddress,
  });
  const result = await middleware.createSafeExecuteTx(request);
  return { txHash: result.txHash, safeAddress };
}
