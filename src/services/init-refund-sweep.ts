import Decimal from 'decimal.js';
import { encodeFunctionData, erc20Abi, type Hex, type PrivateKeyAccount, parseUnits } from 'viem';
import { type ChainListType, getLogger, type SwapTokenBalance } from '../domain';
import { predictSafeAccountAddress } from '../swap/safe/predict';
import type { PublicClientList } from '../swap/types';
import type { SwapCache } from '../swap/wallet/cache';
import { chainSupports7702 } from '../swap/wallet/capabilities';
import type { MiddlewareSwapClient } from '../transport';
import { isNativeAddress } from './addresses';
import { getBalancesForSwap } from './balances';
import { createSafeExecuteTxFromCalls, ensureSafeForEphemeral } from './safe';
import { createSBCTxFromCalls, requireSuccessfulSbcResult } from './sbc';

const logger = getLogger();

export type SweepCall = { to: Hex; value: bigint; data: Hex };
export type SweepHolder = 'ephemeral' | 'safe';
// One sweep tx per (chain, holder): all that chain's token transfers batched into `calls`.
export type SweepGroup = { chainId: number; holder: SweepHolder; calls: SweepCall[] };

export type SweepContext = {
  chainList: ChainListType;
  middlewareClient: Pick<
    MiddlewareSwapClient,
    | 'getSwapBalances'
    | 'submitSBCs'
    | 'createSafeExecuteTx'
    | 'ensureSafeAccount'
    | 'getSafeAccountAddress'
  >;
  publicClientList: PublicClientList;
  ephemeralWallet: PrivateKeyAccount;
  eoaAddress: Hex;
  cache: SwapCache | undefined;
};

/**
 * Build a single "send the exact known amount to the EOA" call. Unlike the periodic Sweeper
 * (which sweeps an unknown balance via a contract), the init refund sweep already has the
 * amount from the balance fetch, so it's a plain transfer:
 *   - ERC-20 → `transfer(eoa, amount)` on the token (value 0)
 *   - native → a value send straight to the EOA (empty calldata)
 * The call shape is identical for the 7702 (Calibur SBC) and non-7702 (Safe execTransaction) paths.
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
 * Group a holder's positive, chainList-known token balances into one sweep per chain. Only the
 * chains whose wallet mode matches `holder` are kept (7702 → ephemeral, non-7702 → Safe), so the
 * ephemeral scan handles 7702 chains and the Safe scan handles the rest. Zero / dust-to-zero and
 * unknown (spam) tokens are dropped.
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
  holder: SweepHolder,
  chainList: ChainListType,
  eoaAddress: Hex
): SweepGroup[] => {
  const byChain = new Map<number, SweepGroup>();
  for (const asset of balances) {
    for (const entry of asset.chainBalances) {
      if (new Decimal(entry.balance).lte(0)) continue;
      const tokenAddress = entry.contractAddress as Hex;
      if (!isKnownToken(chainList, entry.chain.id, tokenAddress)) continue;
      const expectedHolder: SweepHolder = chainSupports7702(chainList.getChainByID(entry.chain.id))
        ? 'ephemeral'
        : 'safe';
      if (holder !== expectedHolder) continue;
      const amountRaw = parseUnits(entry.balance, entry.decimals);
      if (amountRaw <= 0n) continue;
      const call = buildRefundSweepCall(tokenAddress, amountRaw, eoaAddress);
      const group = byChain.get(entry.chain.id) ?? { chainId: entry.chain.id, holder, calls: [] };
      group.calls.push(call);
      byChain.set(entry.chain.id, group);
    }
  }
  return [...byChain.values()];
};

/**
 * One-shot sweep of bridge-failure refunds stranded on the intent signer back to the EOA. The
 * refund lands on the ephemeral-controlled account — Calibur on 7702 chains, the predicted Safe
 * on non-7702 — so we scan both, full-drain (no native reserve, the holder pays no gas), and fire
 * exactly one batched tx per chain (Calibur SBC or Safe execTransaction). Best-effort: a single
 * chain failure is logged and doesn't strand the rest. Sponsor-submitted, so no user prompt.
 */
export const sweepEphemeralRefundsToEoa = async (input: {
  ctx: SweepContext;
  label?: string;
}): Promise<void> => {
  const { ctx } = input;
  const label = input.label ?? 'Init refund sweep';
  const { address: safeAddress } = predictSafeAccountAddress(ctx.ephemeralWallet.address);

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

  const groups = [
    ...collectRefundSweepGroups(ephemeralBalances, 'ephemeral', ctx.chainList, ctx.eoaAddress),
    ...collectRefundSweepGroups(safeBalances, 'safe', ctx.chainList, ctx.eoaAddress),
  ];

  await dispatchSweepGroups(groups, ctx, label);
};

/**
 * Fire one batched tx per sweep group — Calibur SBC on 7702 chains, Safe execTransaction on
 * non-7702 (the Safe pays a native value from its own balance, outer msg.value 0). Best-effort:
 * a single chain failure is logged and doesn't strand the rest. Shared by the init refund sweep
 * and the swap failure-cleanup sweep.
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
  const { address: safeAddress } = predictSafeAccountAddress(ctx.ephemeralWallet.address);

  logger.debug('sweep:dispatch', {
    label,
    chains: groups.map((g) => `${g.chainId}:${g.holder}(${g.calls.length})`),
  });

  const results = await Promise.allSettled(
    groups.map(async (group) => {
      const publicClient = ctx.publicClientList.get(group.chainId);

      if (group.holder === 'safe') {
        const [firstCall] = group.calls;
        const nativeValue = group.calls.length === 1 && firstCall ? firstCall.value : 0n;
        await ensureSafeForEphemeral({
          chainId: group.chainId,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          middleware: ctx.middlewareClient,
        });
        const request = await createSafeExecuteTxFromCalls({
          calls: group.calls,
          chainId: group.chainId,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          safeAddress,
          nativeValue,
        });
        await ctx.middlewareClient.createSafeExecuteTx(request);
        return;
      }

      const sbcTx = await createSBCTxFromCalls({
        calls: group.calls,
        chainID: group.chainId,
        ephemeralAddress: ctx.ephemeralWallet.address,
        ephemeralWallet: ctx.ephemeralWallet,
        publicClient,
      });
      const sbcResults = await ctx.middlewareClient.submitSBCs([sbcTx]);
      requireSuccessfulSbcResult(sbcResults, group.chainId, label);
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
