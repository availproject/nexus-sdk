import { union } from 'es-toolkit';
import {
  createPublicClient,
  encodeFunctionData,
  fallback,
  type Hex,
  http,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { type Chain, getLogger } from '../domain';
import ERC20ABI from '../domain/erc20-abi';
import { Errors, formatUnknownError } from '../domain/errors';
import { isUserRejectedRequest } from './is-user-rejected-request';
import { minutesToMs } from './time';

const logger = getLogger();

const TRANSACTION_RECEIPT_WAIT_TIMEOUT_MS = minutesToMs(3);

type TransactionReceiptPublicClient = Pick<
  PublicClient,
  'getTransactionReceipt' | 'waitForTransactionReceipt'
>;

const wrapExternal = async <T>(
  message: string,
  service: 'wallet' | 'rpc',
  details: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    throw Errors.execution(`${message}: ${formatUnknownError(error)}`, { service, details });
  }
};

/**
 * Waits for a transaction receipt and returns `[receipt, error]` instead of throwing on revert:
 * `error` is `Errors.transactionReverted(hash)` for a reverted receipt, else `null`. Callers
 * `if (error) throw error` (or attach step-specific context). If the confirmation waiter fails,
 * make one direct receipt lookup before surfacing the original wait failure. The fallback accepts
 * a mined receipt without waiting for the requested confirmation count.
 */
export const waitForTxReceipt = async (
  hash: `0x${string}`,
  publicClient: TransactionReceiptPublicClient,
  confirmations = 1,
  timeout = TRANSACTION_RECEIPT_WAIT_TIMEOUT_MS
): Promise<[TransactionReceipt, ReturnType<typeof Errors.transactionReverted> | null]> => {
  const receipt = await wrapExternal(
    'Failed to wait for transaction receipt',
    'rpc',
    { hash, confirmations, timeout },
    async () => {
      try {
        return await publicClient.waitForTransactionReceipt({ confirmations, hash, timeout });
      } catch (waitError) {
        try {
          return await publicClient.getTransactionReceipt({ hash });
        } catch {
          throw waitError;
        }
      }
    }
  );
  return [receipt, receipt.status === 'reverted' ? Errors.transactionReverted(hash) : null];
};

export const switchChain = async (client: WalletClient, chain: Chain) => {
  const current = await wrapExternal('Failed to get wallet chain id', 'wallet', {}, () =>
    client.getChainId()
  );
  if (current === chain.id) return;

  try {
    await client.switchChain({ id: chain.id });
  } catch (outerErr) {
    if (isUserRejectedRequest(outerErr)) throw Errors.userRejectedTxSend();
    logger.error('switchChain failed, trying addChain', outerErr);
    try {
      await client.addChain({ chain });
      await client.switchChain({ id: chain.id });
    } catch (inner) {
      if (isUserRejectedRequest(inner)) throw Errors.userRejectedTxSend();
      logger.error('Unable to add/switch chain', inner);
      throw Errors.execution(`Unable to add/switch chain: ${formatUnknownError(inner)}`, {
        service: 'wallet',
        chainId: chain.id,
      });
    }
  }

  const after = await wrapExternal('Failed to get wallet chain id', 'wallet', {}, () =>
    client.getChainId()
  );
  if (after !== chain.id) {
    logger.error('Wallet did not switch chains even though no error was thrown');
    throw Errors.internal('wallet did not switch chain - no error thrown');
  }
};

export const createPublicClientWithFallback = (chain: Chain): PublicClient => {
  const rpcUrls = union(chain.rpcUrls.default.http, chain.rpcUrls.default.publicHttp ?? []);
  return createPublicClient({
    chain,
    transport: fallback(rpcUrls.map((s) => http(s))),
  });
};

export const packERC20Approve = (spender: Hex, amount: bigint) => {
  return encodeFunctionData({
    abi: ERC20ABI,
    args: [spender, amount],
    functionName: 'approve',
  });
};
