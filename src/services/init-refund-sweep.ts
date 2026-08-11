import Decimal from 'decimal.js';
import { encodeFunctionData, erc20Abi, type Hex, type PrivateKeyAccount, parseUnits } from 'viem';
import { type ChainListType, getLogger, type SwapTokenBalance } from '../domain';
import { predictSafeAccountAddressV2 } from '../swap/safe/predict';
import type { PublicClientList } from '../swap/types';
import { readCachedSafeAddress, type SwapCache } from '../swap/wallet/cache';
import { buildEphemeralPermitCall } from '../swap/wallet/ephemeral-permit';
import type { MiddlewareSwapClient } from '../transport';
import { isNativeAddress } from './addresses';
import { getBalancesForSwap } from './balances';
import { createSafeExecuteTxFromCalls, ensureSafeForEphemeral } from './safe';

const logger = getLogger();

export type SweepCall = { to: Hex; value: bigint; data: Hex };
export type SweepHolder = 'safe';
// One sweep tx per (chain, holder): all that chain's token transfers batched into `calls`.
export type SweepGroup = { chainId: number; holder: SweepHolder; calls: SweepCall[] };

export type SweepContext = {
  chainList: ChainListType;
  middlewareClient: Pick<
    MiddlewareSwapClient,
    'getSwapBalances' | 'createSafeExecuteTx' | 'ensureSafeAccount' | 'getSafeAccountAddress'
  >;
  publicClientList: PublicClientList;
  ephemeralWallet: PrivateKeyAccount;
  eoaAddress: Hex;
  cache: SwapCache | undefined;
  safeDeploymentPromises?: ReadonlyMap<
    number,
    Promise<import('../swap/safe/types').EnsureSafeAccountV2Response>
  >;
};

/**
 * Build a single "send the exact known amount to the EOA" call. Unlike the periodic Sweeper
 * (which sweeps an unknown balance via a contract), the init refund sweep already has the
 * amount from the balance fetch, so it's a plain transfer:
 *   - ERC-20 → `transfer(eoa, amount)` on the token (value 0)
 *   - native → a value send straight to the EOA (empty calldata)
 * The Safe batches these calls in one execTransaction.
 */
export const buildRefundSweepCall = (
  tokenAddress: Hex,
  amountRaw: bigint,
  eoaAddress: Hex
): SweepCall =>
  isNativeAddress(tokenAddress)
    ? { to: eoaAddress, value: amountRaw, data: '0x' }
    : {
        to: tokenAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [eoaAddress, amountRaw],
        }),
      };

/**
 * Group the Safe's positive, chainList-known token balances into one sweep per chain. Zero,
 * dust-to-zero, and unknown (spam) tokens are dropped.
 */
const isKnownToken = (chainList: ChainListType, chainId: number, tokenAddress: Hex): boolean => {
  if (isNativeAddress(tokenAddress)) return true;
  try {
    return !!chainList.getTokenByAddress(chainId, tokenAddress);
  } catch {
    return false;
  }
};

export const collectRefundSweepGroups = (
  balances: SwapTokenBalance[],
  _holder: SweepHolder,
  chainList: ChainListType,
  eoaAddress: Hex
): SweepGroup[] => {
  const byChain = new Map<number, SweepGroup>();
  for (const asset of balances) {
    for (const entry of asset.chainBalances) {
      if (new Decimal(entry.balance).lte(0)) continue;
      const tokenAddress = entry.contractAddress as Hex;
      if (!isKnownToken(chainList, entry.chain.id, tokenAddress)) continue;
      const amountRaw = parseUnits(entry.balance, entry.decimals);
      if (amountRaw <= 0n) continue;
      const call = buildRefundSweepCall(tokenAddress, amountRaw, eoaAddress);
      const group = byChain.get(entry.chain.id) ?? {
        chainId: entry.chain.id,
        holder: 'safe' as const,
        calls: [],
      };
      group.calls.push(call);
      byChain.set(entry.chain.id, group);
    }
  }
  return [...byChain.values()];
};

/**
 * One-shot sweep of bridge-failure refunds stranded on the intent signer back to the EOA. The
 * Refunds can land at the Safe or at the ephemeral bridge holder. Safe balances transfer directly;
 * ERC-20 balances at the ephemeral are pulled by the Safe with EIP-2612 permit + transferFrom.
 * Best-effort and sponsor-submitted, so there is no user prompt.
 */
export const sweepEphemeralRefundsToEoa = async (input: {
  ctx: SweepContext;
  label?: string;
}): Promise<void> => {
  const { ctx } = input;
  const label = input.label ?? 'Init refund sweep';
  const safeAddress =
    readCachedSafeAddress(ctx.cache) ??
    predictSafeAccountAddressV2(ctx.eoaAddress, ctx.ephemeralWallet.address).address;

  const [ephemeralBalances, safeBalances] = await Promise.all([
    getBalancesForSwap({
      middlewareClient: ctx.middlewareClient,
      evmAddress: ctx.ephemeralWallet.address,
      chainList: ctx.chainList,
      deductNativeReserve: false,
    }),
    getBalancesForSwap({
      middlewareClient: ctx.middlewareClient,
      evmAddress: safeAddress,
      chainList: ctx.chainList,
      deductNativeReserve: false,
    }),
  ]);

  const groups = [...collectRefundSweepGroups(safeBalances, 'safe', ctx.chainList, ctx.eoaAddress)];

  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 5n * 60n;
  const ephemeralByChain = new Map<number, SweepGroup>();
  for (const asset of ephemeralBalances) {
    for (const entry of asset.chainBalances) {
      const tokenAddress = entry.contractAddress as Hex;
      if (new Decimal(entry.balance).lte(0) || isNativeAddress(tokenAddress)) continue;
      if (!isKnownToken(ctx.chainList, entry.chain.id, tokenAddress)) continue;
      const amountRaw = parseUnits(entry.balance, entry.decimals);
      if (amountRaw <= 0n) continue;
      try {
        const permitCall = await buildEphemeralPermitCall({
          tokenAddress,
          amount: amountRaw,
          spender: safeAddress,
          chain: ctx.chainList.getChainByID(entry.chain.id),
          chainList: ctx.chainList,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient: ctx.publicClientList.get(entry.chain.id),
          deadline,
        });
        const group = ephemeralByChain.get(entry.chain.id) ?? {
          chainId: entry.chain.id,
          holder: 'safe' as const,
          calls: [],
        };
        group.calls.push(permitCall, {
          to: tokenAddress,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transferFrom',
            args: [ctx.ephemeralWallet.address, ctx.eoaAddress, amountRaw],
          }),
        });
        ephemeralByChain.set(entry.chain.id, group);
      } catch (error) {
        logger.debug('sweep:ephemeralTokenSkipped', {
          chainId: entry.chain.id,
          tokenAddress,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  groups.push(...ephemeralByChain.values());

  await dispatchSweepGroups(groups, ctx, label);
};

/**
 * Fire one Safe execTransaction per sweep group. Best-effort: a single chain failure is logged and
 * doesn't strand the rest. Shared by the init refund sweep and swap failure cleanup.
 */
export const dispatchSweepGroups = async (
  groups: SweepGroup[],
  ctx: SweepContext,
  label: string
): Promise<void> => {
  if (groups.length === 0) {
    logger.debug('sweep:noGroups', { label, ephemeralAddress: ctx.ephemeralWallet.address });
    return;
  }
  const safeAddress =
    readCachedSafeAddress(ctx.cache) ??
    predictSafeAccountAddressV2(ctx.eoaAddress, ctx.ephemeralWallet.address).address;

  logger.debug('sweep:dispatch', {
    label,
    chains: groups.map((g) => `${g.chainId}:${g.holder}(${g.calls.length})`),
  });

  const results = await Promise.allSettled(
    groups.map(async (group) => {
      const publicClient = ctx.publicClientList.get(group.chainId);

      await ensureSafeForEphemeral({
        chainId: group.chainId,
        eoaAddress: ctx.eoaAddress,
        ephemeralWallet: ctx.ephemeralWallet,
        publicClient,
        middleware: ctx.middlewareClient,
        deploymentPromise: ctx.safeDeploymentPromises?.get(group.chainId),
      });
      const request = await createSafeExecuteTxFromCalls({
        calls: group.calls,
        chainId: group.chainId,
        eoaAddress: ctx.eoaAddress,
        ephemeralWallet: ctx.ephemeralWallet,
        publicClient,
        safeAddress,
      });
      await ctx.middlewareClient.createSafeExecuteTx(request);
    })
  );

  results.forEach((result, idx) => {
    const group = groups[idx];
    if (!group) return;
    logger.debug('sweep:chainResult', {
      label,
      chainId: group.chainId,
      holder: group.holder,
      status: result.status === 'fulfilled' ? 'success' : 'failed',
      ...(result.status === 'rejected'
        ? { error: result.reason instanceof Error ? result.reason.message : String(result.reason) }
        : {}),
    });
  });
};
