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
import ERC20ABI from '../abi/erc20';
import { ARBITRUM_GAS_ORACLE_ABI, OP_STACK_GAS_ORACLE_ABI } from '../abi/gasOracle';
import { type Chain, getLogger } from '../domain';
import { ERROR_CODES, Errors, ExecutionError, formatUnknownError } from '../domain/errors';
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

export const requestTimeout = (timeout: number, ac: AbortController, requestHash: Hex) => {
  return new Promise((_, reject) => {
    const t = setTimeout(() => {
      ac.abort();
      return reject(Errors.liquidityTimeout(requestHash));
    }, minutesToMs(timeout));

    ac.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
      },
      { once: true }
    );
  });
};

const DEFAULT_GAS_ORACLE_ADDRESS = '0x420000000000000000000000000000000000000F';

const GAS_ORACLE_CHAIN_IDS = {
  OPTIMISM: 10,
  OPTIMISM_SEPOLIA: 11155420,
  SCROLL: 534352,
  BASE: 8453,
  BASE_SEPOLIA: 84532,
  ARBITRUM: 42161,
} as const;

const L1_GAS_ORACLES: Record<number, `0x${string}`> = {
  [GAS_ORACLE_CHAIN_IDS.OPTIMISM]: DEFAULT_GAS_ORACLE_ADDRESS,
  [GAS_ORACLE_CHAIN_IDS.OPTIMISM_SEPOLIA]: DEFAULT_GAS_ORACLE_ADDRESS,
  [GAS_ORACLE_CHAIN_IDS.SCROLL]: '0x5300000000000000000000000000000000000002',
  [GAS_ORACLE_CHAIN_IDS.BASE]: DEFAULT_GAS_ORACLE_ADDRESS,
  [GAS_ORACLE_CHAIN_IDS.BASE_SEPOLIA]: DEFAULT_GAS_ORACLE_ADDRESS,
  [GAS_ORACLE_CHAIN_IDS.ARBITRUM]: '0x00000000000000000000000000000000000000C8',
} as const;

const chainsWithGasOracles = Object.keys(L1_GAS_ORACLES).map(Number);

export type L1FeeInput = {
  toAddress: Hex;
  input: `0x${string}`;
};

export const getL1Fee = async (chain: Chain, inputs: readonly L1FeeInput[] = []) => {
  if (!chainsWithGasOracles.includes(chain.id) || inputs.length === 0) {
    return 0n;
  }

  const fees = await Promise.all(
    inputs.map(({ toAddress, input }) => fetchL1Fee(toAddress, chain, input))
  );
  return fees.reduce((total, fee) => total + fee, 0n);
};

const fetchL1Fee = async (toAddress: Hex, chain: Chain, input: `0x${string}`) => {
  const pc = createPublicClientWithFallback(chain);

  if (chain.id === GAS_ORACLE_CHAIN_IDS.ARBITRUM) {
    const result = await wrapExternal(
      'Failed to fetch Arbitrum L1 fee',
      'rpc',
      {
        chainId: chain.id,
        toAddress,
      },
      () =>
        pc.readContract({
          abi: ARBITRUM_GAS_ORACLE_ABI,
          address: L1_GAS_ORACLES[chain.id],
          functionName: 'gasEstimateL1Component',
          args: [toAddress, false, input],
        })
    );
    return result[0] * result[1];
  } else {
    return wrapExternal(
      'Failed to fetch L1 fee',
      'rpc',
      {
        chainId: chain.id,
        toAddress,
      },
      () =>
        pc.readContract({
          abi: OP_STACK_GAS_ORACLE_ABI,
          address: L1_GAS_ORACLES[chain.id],
          args: [input],
          functionName: 'getL1Fee',
        })
    );
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

/** Wait one confirmation on every chain. Same `[receipt, error]` contract as waitForTxReceipt. */
export const waitForTxReceiptByChain = (
  hash: `0x${string}`,
  publicClient: TransactionReceiptPublicClient,
  _chainId: number,
  timeout = TRANSACTION_RECEIPT_WAIT_TIMEOUT_MS
) => waitForTxReceipt(hash, publicClient, 1, timeout);

/**
 * Waits (chain-aware) for an execution step's receipt and, on revert, throws a step-tagged
 * `ExecutionError` (`errors.md`: step-bound failures throw the subclass directly with
 * `{ service, stepId, stepType, chainId }`). Throwing a fully-typed error at the revert site keeps
 * the `EXEC_TX_ONCHAIN_REVERTED` code and step metadata intact as it passes through the flow's
 * boundaries — instead of bubbling up as a context-less revert. Returns the txHash on success.
 */
export const confirmStepReceipt = async (
  publicClient: TransactionReceiptPublicClient,
  txHash: `0x${string}`,
  chainId: number,
  step: { stepId: string; stepType: string; label: string }
): Promise<`0x${string}`> => {
  const [, error] = await waitForTxReceiptByChain(txHash, publicClient, chainId);
  if (error) {
    throw new ExecutionError(
      ERROR_CODES.EXEC_TX_ONCHAIN_REVERTED,
      `${step.label} reverted on chain ${chainId}`,
      {
        context: { service: 'rpc', stepId: step.stepId, stepType: step.stepType, chainId },
        details: { txHash },
      }
    );
  }
  return txHash;
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
