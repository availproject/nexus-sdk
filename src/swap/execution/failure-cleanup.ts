import { erc20Abi, type Hex } from 'viem';
import { getLogger } from '../../domain';
import { isNativeAddress } from '../../services/addresses';
import {
  buildRefundSweepCall,
  dispatchSweepGroups,
  type SweepContext,
  type SweepGroup,
} from '../../services/init-refund-sweep';
import { type CurrencyID, resolveCOT } from '../cot';
import { predictSafeAccountAddress } from '../safe/predict';
import type { ExecutionContext, SwapRoute } from '../types';
import { chainSupports7702 } from '../wallet/capabilities';

const logger = getLogger();

/**
 * The currency the on-failure cleanup should sweep, or `null` to skip it. A Nexus same-token bridge
 * deposits the exact amount directly from the EOA — nothing is staged on the ephemeral — so there's
 * nothing to sweep. The direct-destination fast path (Path A) is one atomic batch on one chain
 * (revertOnFailure), with no later stage, so nothing ever strands there either. Every other route
 * can strand the COT (or, for a Mayan same-token bridge, the bridged family token) on a failed leg,
 * swept under the route's settlement currency.
 */
export const resolveFailureSweepCurrencyId = (
  route: Pick<SwapRoute, 'sameTokenBridge' | 'bridge' | 'settlementCurrencyId' | 'directDestination'>
): CurrencyID | null => {
  if (route.directDestination) return null;
  if (route.sameTokenBridge && route.bridge?.provider === 'nexus') return null;
  return route.settlementCurrencyId as CurrencyID;
};

type FailureCleanupContext = Pick<
  ExecutionContext,
  'cache' | 'chainList' | 'eoaAddress' | 'ephemeralWallet' | 'middlewareClient' | 'publicClientList'
>;

/**
 * Sweep the route's COT stranded on a failed leg back to the EOA. Unlike a blind balance scan, we
 * know exactly what to look for: the single COT token, on the chains the failure left it (source
 * chains if we failed before the bridge, the destination chain if the destination swap failed), at
 * the one holder that chain uses (ephemeral on 7702, predicted Safe otherwise). So we read just that
 * one balance per chain (`balanceOf` / `getBalance`) and direct-transfer the exact amount — no full
 * `getBalancesForSwap` over every token on every chain for two addresses. Best-effort; never rethrows.
 */
export const cleanupStrandedCot = async (input: {
  currencyId: CurrencyID;
  chainIds: number[];
  ctx: FailureCleanupContext;
}): Promise<void> => {
  const { ctx } = input;
  const { address: safeAddress } = predictSafeAccountAddress(ctx.ephemeralWallet.address);
  const groups: SweepGroup[] = [];

  for (const chainId of input.chainIds) {
    try {
      const is7702 = chainSupports7702(ctx.chainList.getChainByID(chainId));
      const holderAddress = is7702 ? ctx.ephemeralWallet.address : safeAddress;
      const cot = resolveCOT(chainId, ctx.chainList, input.currencyId);
      const tokenAddress = cot.address as Hex;
      const publicClient = ctx.publicClientList.get(chainId);

      const balance = isNativeAddress(tokenAddress)
        ? await publicClient.getBalance({ address: holderAddress })
        : await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [holderAddress],
          });

      if (balance <= 0n) continue;
      groups.push({
        chainId,
        holder: is7702 ? 'ephemeral' : 'safe',
        calls: [buildRefundSweepCall(tokenAddress, balance, ctx.eoaAddress)],
      });
    } catch (error) {
      logger.debug('cleanupStrandedCot:chainSkipped', {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await dispatchSweepGroups(groups, ctx satisfies SweepContext, 'Swap failure cleanup sweep');
  } catch (error) {
    logger.debug('cleanupStrandedCot:failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
