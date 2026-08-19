import type { Hex, PublicClient } from 'viem';
import { erc20Abi } from 'viem';
import { type ChainListType, getLogger } from '../../domain';
import type { PermitDetails } from '../../domain/permits';
import { getPermitVariantAndVersion } from '../../services/permits';

const logger = getLogger();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AllowanceKey = `${Hex}:${Hex}:${Hex}:${number}`; // token:owner:spender:chainId
type PermitKey = `${Hex}:${number}`; // token:chainId
type SafeAccountIdentity = { address: Hex; factoryAddress: Hex };

const allowanceKey = (token: Hex, owner: Hex, spender: Hex, chainId: number): AllowanceKey =>
  `${token.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}:${chainId}` as AllowanceKey;
const permitKey = (token: Hex, chainId: number): PermitKey =>
  `${token.toLowerCase()}:${chainId}` as PermitKey;

type AllowanceQuery = {
  type: 'allowance';
  token: Hex;
  owner: Hex;
  spender: Hex;
  chainId: number;
};

type PermitQuery = {
  type: 'permit';
  token: Hex;
  chainId: number;
};

type SafeAccountQuery = {
  type: 'safe_account';
  chainId: number;
};

type CacheQuery = AllowanceQuery | PermitQuery | SafeAccountQuery;

type PublicClientMap = Record<number, Pick<PublicClient, 'multicall' | 'getCode' | 'readContract'>>;

// ---------------------------------------------------------------------------
// SwapCache
// ---------------------------------------------------------------------------

/**
 * Batches allowance, permit-support, and Safe deployment queries, then provides cached results.
 */
export class SwapCache {
  constructor(
    private readonly chainList: ChainListType,
    private readonly safeAccount?: SafeAccountIdentity
  ) {}

  private queries: CacheQuery[] = [];
  private allowances = new Map<AllowanceKey, bigint>();
  private permits = new Map<PermitKey, PermitDetails | undefined>();
  private safeDeployment = new Map<number, boolean>();

  // ---------------------------------------------------------------------------
  // Add queries
  // ---------------------------------------------------------------------------

  addAllowanceQuery(token: Hex, owner: Hex, spender: Hex, chainId: number): void {
    this.queries.push({ type: 'allowance', token, owner, spender, chainId });
  }

  addPermitQuery(token: Hex, chainId: number): void {
    this.queries.push({ type: 'permit', token, chainId });
  }

  addSafeAccountQuery(chainId: number): void {
    if (!this.safeAccount) return;
    this.queries.push({ type: 'safe_account', chainId });
  }

  // ---------------------------------------------------------------------------
  // Process all queued queries
  // ---------------------------------------------------------------------------

  async process(clients: PublicClientMap): Promise<void> {
    logger.debug('swap.cache.process.started', {
      queuedQueryCount: this.queries.length,
      chainIds: Object.keys(clients).map(Number),
    });

    if (this.queries.length === 0) {
      logger.debug('swap.cache.process.skipped', {
        reason: 'no_queries',
        chainIds: Object.keys(clients).map(Number),
      });
      return;
    }

    // Group queries by chainId
    const byChain = new Map<number, CacheQuery[]>();
    for (const q of this.queries) {
      const chainId = q.chainId;
      let bucket = byChain.get(chainId);
      if (!bucket) {
        bucket = [];
        byChain.set(chainId, bucket);
      }
      bucket.push(q);
    }

    // Process each chain in parallel
    await Promise.all(
      [...byChain.entries()].map(async ([chainId, chainQueries]) => {
        const client = clients[chainId];
        if (!client) {
          logger.debug('swap.cache.client.missing', {
            chainId,
            availableChainIds: Object.keys(clients).map(Number),
            queryCount: chainQueries.length,
            queryKinds: [...new Set(chainQueries.map((query) => query.type))],
          });
          return;
        }

        try {
          const allowanceQueries = chainQueries.filter(
            (q): q is AllowanceQuery => q.type === 'allowance'
          );
          const permitQueries = chainQueries.filter((q): q is PermitQuery => q.type === 'permit');
          const hasSafeAccountQuery = chainQueries.some((q) => q.type === 'safe_account');

          const allowanceProcess = (async () => {
            if (allowanceQueries.length === 0) return;

            const contracts = allowanceQueries.map((q) => ({
              address: q.token,
              abi: erc20Abi,
              functionName: 'allowance' as const,
              args: [q.owner, q.spender] as const,
            }));

            logger.debug('swap.cache.allowance.query_started', {
              chainId,
              queryCount: allowanceQueries.length,
            });

            const multicallAddress = this.chainList.getChainByID(chainId).multicallAddress;
            const results = await client.multicall({ multicallAddress, contracts });

            logger.debug('swap.cache.allowance.query_completed', {
              chainId,
              queryCount: allowanceQueries.length,
              successCount: results.filter((result) => result?.status === 'success').length,
              failureCount: results.filter((result) => result?.status !== 'success').length,
            });

            for (let i = 0; i < allowanceQueries.length; i++) {
              const q = allowanceQueries[i];
              const r = results[i];
              const key = allowanceKey(q.token, q.owner, q.spender, q.chainId);
              this.allowances.set(key, typeof r?.result === 'bigint' ? r.result : 0n);
            }
          })();
          const permitProcess = Promise.all(
            permitQueries.map(async (q) => {
              const key = permitKey(q.token, q.chainId);
              this.permits.set(
                key,
                await getPermitVariantAndVersion({
                  chainId: q.chainId,
                  tokenAddress: q.token,
                  chainList: this.chainList,
                  publicClient: client,
                })
              );
            })
          );
          const safeAccountProcess = (async () => {
            if (
              !hasSafeAccountQuery ||
              !this.safeAccount ||
              this.safeDeployment.get(chainId) === true
            ) {
              return;
            }
            try {
              const code = await client.getCode({ address: this.safeAccount.address });
              this.safeDeployment.set(chainId, code !== undefined && code !== '0x');
            } catch (error) {
              this.safeDeployment.set(chainId, false);
              logger.error('swap.cache.safe_account.query_failed', { chainId }, error);
            }
          })();

          await Promise.all([allowanceProcess, permitProcess, safeAccountProcess]);
        } catch (error) {
          logger.error('swapCache:processFailed', { chainId, chainQueries }, error);
          // Graceful fallback — leave defaults (0n / undefined)
        }
      })
    );

    // Clear processed queries
    this.queries = [];
  }

  // ---------------------------------------------------------------------------
  // Read results
  // ---------------------------------------------------------------------------

  getAllowance(token: Hex, owner: Hex, spender: Hex, chainId: number): bigint {
    const key = allowanceKey(token, owner, spender, chainId);
    return this.allowances.get(key) ?? 0n;
  }

  setAllowance(token: Hex, owner: Hex, spender: Hex, chainId: number, amount: bigint): void {
    const key = allowanceKey(token, owner, spender, chainId);
    this.allowances.set(key, amount);
  }

  getPermit(token: Hex, chainId: number): PermitDetails | undefined {
    const key = permitKey(token, chainId);
    return this.permits.get(key);
  }

  getSafeAccount(chainId: number): (SafeAccountIdentity & { deployed: boolean }) | undefined {
    if (!this.safeAccount) return undefined;
    return {
      ...this.safeAccount,
      deployed: this.safeDeployment.get(chainId) ?? false,
    };
  }

  setSafeDeployed(chainId: number, deployed = true): void {
    this.safeDeployment.set(chainId, deployed);
  }
}
