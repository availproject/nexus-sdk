import { encodeFunctionData, erc20Abi, type Hex } from 'viem';
import { getLogger } from '../../domain';
import {
  buildRefundSweepCall,
  dispatchSweepGroups,
  type SweepContext,
  type SweepGroup,
} from '../../services/init-refund-sweep';
import { type CurrencyID, resolveCOT } from '../cot';
import { predictSafeAccountAddressV2 } from '../safe/predict';
import type { ExecutionContext, SwapRoute } from '../types';
import { resolveSwapWalletPath } from '../wallet/capabilities';
import { buildEphemeralPermitCall } from '../wallet/ephemeral-permit';
import { readSettlementBalanceRaw } from './settlement-balance';

const logger = getLogger();
const CLEANUP_PERMIT_DEADLINE_SECONDS = 5n * 60n;

/**
 * The currency the on-failure cleanup should sweep, or `null` to skip it. A Nexus same-token bridge
 * deposits the exact amount directly from the EOA — nothing is staged on the ephemeral — so there's
 * nothing to sweep. The direct-destination fast path (Path A) is one atomic batch on one chain
 * (revertOnFailure), with no later stage, so nothing ever strands there either. Every other route
 * can strand the COT (or, for a Mayan same-token bridge, the bridged family token) on a failed leg,
 * swept under the route's settlement currency.
 */
export const resolveFailureSweepCurrencyId = (
  route: Pick<
    SwapRoute,
    'sameTokenBridge' | 'bridge' | 'settlementCurrencyId' | 'directDestination'
  >
): CurrencyID | null => {
  if (route.directDestination) return null;
  if (route.sameTokenBridge && route.bridge?.provider === 'nexus') return null;
  return route.settlementCurrencyId as CurrencyID;
};

type FailureCleanupContext = Pick<
  ExecutionContext,
  | 'cache'
  | 'chainList'
  | 'destinationDirectEoa'
  | 'eoaAddress'
  | 'ephemeralWallet'
  | 'middlewareClient'
  | 'publicClientList'
> & { destinationChainId: number };

/**
 * Sweep the route's COT stranded on a failed leg back to the EOA. Unlike a blind balance scan, we
 * know exactly what to look for: the single COT token, on the chains the failure left it (source
 * chains if we failed before the bridge, the destination chain if the destination swap failed), at
 * the holder for the failed stage. Remote source settlement is at the ephemeral on both wallet
 * paths; destination-chain settlement stays at its wrapper when another swap follows. On a
 * non-7702 remote source, the Safe submits an ephemeral permit + transferFrom recovery batch.
 * Best-effort; never rethrows.
 */
export const cleanupStrandedCot = async (input: {
  currencyId: CurrencyID;
  chainIds: number[];
  scope: 'source' | 'destination';
  ctx: FailureCleanupContext;
}): Promise<void> => {
  const { ctx } = input;
  const { address: safeAddress } = predictSafeAccountAddressV2(
    ctx.eoaAddress,
    ctx.ephemeralWallet.address
  );
  const groups: SweepGroup[] = [];
  logger.debug('swap.cleanup.sweep.started', {
    currencyId: input.currencyId,
    chainIds: input.chainIds,
    chainCount: input.chainIds.length,
    scope: input.scope,
  });

  for (const chainId of input.chainIds) {
    try {
      const chain = ctx.chainList.getChainByID(chainId);
      const usesEphemeral = resolveSwapWalletPath(chain) === 'ephemeral';
      const sourceOnDestination = input.scope === 'source' && chainId === ctx.destinationChainId;
      if (sourceOnDestination && ctx.destinationDirectEoa) continue;
      const sourceAtEphemeral = input.scope === 'source' && chainId !== ctx.destinationChainId;
      const holderAddress =
        usesEphemeral || sourceAtEphemeral ? ctx.ephemeralWallet.address : safeAddress;
      const cot = resolveCOT(chainId, ctx.chainList, input.currencyId);
      const tokenAddress = cot.address as Hex;
      const balance = await readSettlementBalanceRaw({
        chainId,
        tokenAddress,
        holderAddress,
        publicClientList: ctx.publicClientList,
      });

      if (balance <= 0n) continue;
      if (sourceAtEphemeral && !usesEphemeral) {
        const deadline = BigInt(Math.floor(Date.now() / 1000)) + CLEANUP_PERMIT_DEADLINE_SECONDS;
        const permitCall = await buildEphemeralPermitCall({
          tokenAddress,
          amount: balance,
          spender: safeAddress,
          chain,
          chainList: ctx.chainList,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient: ctx.publicClientList.get(chainId),
          deadline,
        });
        groups.push({
          chainId,
          holder: 'safe',
          calls: [
            permitCall,
            {
              to: tokenAddress,
              value: 0n,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transferFrom',
                args: [ctx.ephemeralWallet.address, ctx.eoaAddress, balance],
              }),
            },
          ],
        });
        continue;
      }
      groups.push({
        chainId,
        holder: usesEphemeral ? 'ephemeral' : 'safe',
        calls: [buildRefundSweepCall(tokenAddress, balance, ctx.eoaAddress)],
      });
    } catch (error) {
      logger.debug('swap.cleanup.chain.inspection_skipped', {
        chainId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await dispatchSweepGroups(groups, ctx satisfies SweepContext, 'Swap failure cleanup sweep');
    logger.debug('swap.cleanup.sweep.completed', {
      inspectedChainCount: input.chainIds.length,
      sweptChainIds: groups.map((group) => group.chainId),
      sweptChainCount: groups.length,
    });
  } catch (error) {
    logger.debug('swap.cleanup.sweep.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
