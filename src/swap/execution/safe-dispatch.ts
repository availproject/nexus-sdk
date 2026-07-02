import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { Chain } from '../../domain';
import { switchChain } from '../../services/evm';
import {
  buildSafeExecuteEOACall,
  createSafeExecuteTxFromCalls,
  type EnsureSafeMiddleware,
  ensureSafeForEphemeral,
  type SafeCall,
} from '../../services/safe';
import { predictSafeAccountAddress } from '../safe/predict';
import type { CreateSafeExecuteTxRequest, CreateSafeExecuteTxResponse } from '../safe/types';

export type SafeDispatchMiddleware = EnsureSafeMiddleware & {
  createSafeExecuteTx: (req: CreateSafeExecuteTxRequest) => Promise<CreateSafeExecuteTxResponse>;
};

// Dispatches a source-swap batch via the Safe smart-account path (non-7702 chains). Two sub-paths:
//   - nativeValue === 0n → sponsor broadcasts (middleware.createSafeExecuteTx) — pays gas, no
//     native value carried.
//   - nativeValue >  0n → EOA broadcasts (eoaWallet.sendTransaction) — EOA pays gas + carries the
//     native value to the Safe. Sponsor flow can't do this because the sponsor wallet doesn't fund
//     native sends.
// In both cases the ephemeral signs SafeTx (Safe owner == ephemeral).
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
  const { address: safeAddress } = predictSafeAccountAddress(ephemeralWallet.address);

  await ensureSafeForEphemeral({
    chainId,
    ephemeralWallet,
    publicClient,
    middleware,
  });

  if (nativeValue > 0n) {
    const eoaCall = await buildSafeExecuteEOACall({
      calls,
      chainId,
      ephemeralWallet,
      publicClient,
      safeAddress,
      nativeValue,
    });
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
    ephemeralWallet,
    publicClient,
    safeAddress,
  });
  const result = await middleware.createSafeExecuteTx(request);
  return { txHash: result.txHash, safeAddress };
}
