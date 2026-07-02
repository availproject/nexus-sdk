import type { Hex, WalletClient } from 'viem';
import type { Chain } from '../../domain';
import { switchChain } from '../../services/evm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EoaCall = {
  to: Hex;
  data: Hex;
  value: bigint;
};

type ExecuteViaEoaInput = {
  walletClient: WalletClient;
  calls: EoaCall[];
  chain: Chain;
  address: Hex;
  maxWaitMs?: number;
};

type ExecuteViaEoaResult = {
  txHash: Hex;
};

export type DispatchedEoaCalls = {
  id: string;
  chainId: number;
  address: Hex;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_WAIT_MS = 120_000; // 2 minutes

// ---------------------------------------------------------------------------
// executeViaEoa
// ---------------------------------------------------------------------------

export const dispatchViaEoa = async (input: ExecuteViaEoaInput): Promise<DispatchedEoaCalls> => {
  const { walletClient, calls, address, chain } = input;

  await switchChain(walletClient, chain);
  const { id } = await walletClient.sendCalls({
    account: address,
    calls,
    chain,
    experimental_fallback: true,
  });

  return {
    id,
    chainId: chain.id,
    address,
  };
};

export const waitForDispatchedEoaCalls = async (input: {
  walletClient: WalletClient;
  dispatch: DispatchedEoaCalls;
  maxWaitMs?: number;
}): Promise<Hex> => {
  const { walletClient, dispatch, maxWaitMs = DEFAULT_MAX_WAIT_MS } = input;

  const result = await walletClient.waitForCallsStatus({
    id: dispatch.id,
    timeout: maxWaitMs,
  });

  if (result.status === 'failure') {
    throw new Error('executeViaEoa: wallet calls failed');
  }

  const txHash = result.receipts?.[0]?.transactionHash as Hex | undefined;
  if (!txHash) {
    throw new Error('executeViaEoa: success but no receipt txHash');
  }

  return txHash;
};

/**
 * Executes batched calls via the EOA wallet using EIP-5792.
 *
 * 1. Send calls via walletClient.sendCalls
 * 2. Wait for completion via walletClient.waitForCallsStatus
 * 3. Return txHash from first receipt
 *
 * Throws on timeout or failure status.
 */
export const executeViaEoa = async (input: ExecuteViaEoaInput): Promise<ExecuteViaEoaResult> => {
  const dispatch = await dispatchViaEoa(input);
  const txHash = await waitForDispatchedEoaCalls({
    walletClient: input.walletClient,
    dispatch,
    maxWaitMs: input.maxWaitMs,
  });

  return { txHash };
};
