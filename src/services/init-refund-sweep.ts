import {
  encodeFunctionData,
  erc20Abi,
  type Hex,
  multicall3Abi,
  type PrivateKeyAccount,
} from 'viem';
import { type ChainListType, getLogger } from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { Errors } from '../domain/errors';
import { EADDRESS } from '../swap/constants';
import type { SafeMiddlewareClient } from '../swap/safe/client';
import { predictSafeAccountAddress, predictSafeAccountAddressV2 } from '../swap/safe/predict';
import { createSafeClient } from '../swap/safe/safe-client';
import type { PublicClientList } from '../swap/types';
import type { SwapCache } from '../swap/wallet/cache';
import { buildEphemeralPermitCall } from '../swap/wallet/ephemeral-permit';
import type { MiddlewareSwapClient } from '../transport';
import { isNativeAddress } from './addresses';
import { createSafeExecuteTxFromCalls, ensureSafeForEphemeral } from './safe';

const logger = getLogger();

export type SweepCall = { to: Hex; value: bigint; data: Hex };
export type SweepHolder = 'safe' | 'safe-v1';
// One sweep tx per (chain, holder): all that chain's token transfers batched into `calls`.
export type SweepGroup = { chainId: number; holder: SweepHolder; calls: SweepCall[] };

export type SweepContext = {
  chainList: ChainListType;
  middlewareClient: Pick<
    MiddlewareSwapClient,
    'getSwapBalances' | 'createSafeExecuteTx' | 'ensureSafeAccount' | 'getSafeAccountAddress'
  > & { legacySafe?: SafeMiddlewareClient };
  publicClientList: PublicClientList;
  ephemeralWallet: PrivateKeyAccount;
  eoaAddress: Hex;
  cache: SwapCache | undefined;
  safeAddress?: Hex;
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

type RefundBalanceHolder = 'ephemeral' | SweepHolder;
type RefundBalance = {
  chainId: number;
  holder: RefundBalanceHolder;
  tokenAddress: Hex;
  amountRaw: bigint;
};

const readRefundBalances = async (input: {
  ctx: SweepContext;
  holders: Array<{ holder: RefundBalanceHolder; address: Hex }>;
}): Promise<RefundBalance[]> => {
  const chains = input.ctx.chainList.chains.filter(
    (chain) => chain.universe === Universe.ETHEREUM && chain.swapSupported === true
  );

  const balancesByChain = await Promise.all(
    chains.map(async (chain): Promise<RefundBalance[]> => {
      const bridgeTokens = chain.custom.knownTokens.filter((token) => token.currencyId != null);
      const reads = input.holders.flatMap(({ holder, address }) => [
        ...bridgeTokens.map((token) => ({
          holder,
          holderAddress: address,
          tokenAddress: token.contractAddress as Hex,
        })),
        { holder, holderAddress: address, tokenAddress: EADDRESS },
      ]);
      const contracts = reads.map((read) =>
        isNativeAddress(read.tokenAddress)
          ? {
              address: chain.multicallAddress,
              abi: multicall3Abi,
              functionName: 'getEthBalance' as const,
              args: [read.holderAddress] as const,
            }
          : {
              address: read.tokenAddress,
              abi: erc20Abi,
              functionName: 'balanceOf' as const,
              args: [read.holderAddress] as const,
            }
      );

      try {
        const results = await input.ctx.publicClientList.get(chain.id).multicall({
          multicallAddress: chain.multicallAddress,
          allowFailure: true,
          contracts,
        });
        return reads.flatMap((read, index) => {
          const result = results[index];
          return result?.status === 'success' &&
            typeof result.result === 'bigint' &&
            result.result > 0n
            ? [
                {
                  chainId: chain.id,
                  holder: read.holder,
                  tokenAddress: read.tokenAddress,
                  amountRaw: result.result,
                },
              ]
            : [];
        });
      } catch (error) {
        logger.debug('sweep:balanceReadSkipped', {
          chainId: chain.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    })
  );

  return balancesByChain.flat();
};

const addSweepCall = (
  groups: Map<string, SweepGroup>,
  chainId: number,
  holder: SweepHolder,
  ...calls: SweepCall[]
): void => {
  const key = `${chainId}:${holder}`;
  const group = groups.get(key) ?? { chainId, holder, calls: [] };
  group.calls.push(...calls);
  groups.set(key, group);
};

/**
 * One-shot sweep of bridge-failure refunds stranded on the intent signer back to the EOA. Refunds
 * can land at either Safe version or at the ephemeral bridge holder. Safe balances transfer
 * directly; ERC-20 balances at the ephemeral are pulled by the V2 Safe with EIP-2612 permit +
 * transferFrom. Best-effort and sponsor-submitted, so there is no user prompt.
 */
export const sweepEphemeralRefundsToEoa = async (input: {
  ctx: SweepContext;
  label?: string;
}): Promise<void> => {
  const { ctx } = input;
  const label = input.label ?? 'Init refund sweep';
  const safeAddress =
    ctx.safeAddress ??
    predictSafeAccountAddressV2(ctx.eoaAddress, ctx.ephemeralWallet.address).address;
  const legacySafeAddress = predictSafeAccountAddress(ctx.ephemeralWallet.address).address;
  const balances = await readRefundBalances({
    ctx,
    holders: [
      { holder: 'ephemeral', address: ctx.ephemeralWallet.address },
      { holder: 'safe-v1', address: legacySafeAddress },
      { holder: 'safe', address: safeAddress },
    ],
  });
  const groups = new Map<string, SweepGroup>();

  for (const balance of balances) {
    if (balance.holder === 'ephemeral') continue;
    addSweepCall(
      groups,
      balance.chainId,
      balance.holder,
      buildRefundSweepCall(balance.tokenAddress, balance.amountRaw, ctx.eoaAddress)
    );
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 5n * 60n;
  for (const balance of balances) {
    if (balance.holder !== 'ephemeral' || isNativeAddress(balance.tokenAddress)) continue;
    try {
      const permitCall = await buildEphemeralPermitCall({
        tokenAddress: balance.tokenAddress,
        amount: balance.amountRaw,
        spender: safeAddress,
        chain: ctx.chainList.getChainByID(balance.chainId),
        chainList: ctx.chainList,
        ephemeralWallet: ctx.ephemeralWallet,
        publicClient: ctx.publicClientList.get(balance.chainId),
        deadline,
      });
      addSweepCall(groups, balance.chainId, 'safe', permitCall, {
        to: balance.tokenAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transferFrom',
          args: [ctx.ephemeralWallet.address, ctx.eoaAddress, balance.amountRaw],
        }),
      });
    } catch (error) {
      logger.debug('sweep:ephemeralTokenSkipped', {
        chainId: balance.chainId,
        tokenAddress: balance.tokenAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await dispatchSweepGroups([...groups.values()], ctx, label);
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
    ctx.safeAddress ??
    predictSafeAccountAddressV2(ctx.eoaAddress, ctx.ephemeralWallet.address).address;

  logger.debug('sweep:dispatch', {
    label,
    chains: groups.map((g) => `${g.chainId}:${g.holder}(${g.calls.length})`),
  });

  const results = await Promise.allSettled(
    groups.map(async (group) => {
      const publicClient = ctx.publicClientList.get(group.chainId);

      if (group.holder === 'safe-v1') {
        if (!ctx.middlewareClient.legacySafe) {
          throw Errors.internal('Legacy Safe middleware is unavailable');
        }
        const legacySafe = createSafeClient({
          chainId: group.chainId,
          owner: ctx.ephemeralWallet,
          publicClient,
          middleware: ctx.middlewareClient.legacySafe,
        });
        await legacySafe.ensure();
        await legacySafe.executeBatch(group.calls);
        return;
      }

      const safeDeployment = ctx.safeDeploymentPromises?.get(group.chainId);
      if (safeDeployment) {
        await safeDeployment;
      } else {
        await ensureSafeForEphemeral({
          chainId: group.chainId,
          eoaAddress: ctx.eoaAddress,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          middleware: ctx.middlewareClient,
        });
      }
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
