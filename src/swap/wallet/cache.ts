import type { Hex, PublicClient } from 'viem';
import { erc20Abi } from 'viem';
import { type ChainListType, getLogger } from '../../domain';
import type { PermitDetails } from '../../domain/permits';
import { getPermitVariantAndVersion } from '../../services/permits';
import { CALIBUR_ADDRESS, EADDRESS } from '../constants';

const logger = getLogger();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AllowanceKey = `${Hex}:${Hex}:${Hex}:${number}`; // token:owner:spender:chainId
type SetCodeKey = `${Hex}:${number}`; // address:chainId
type PermitKey = `${Hex}:${number}`; // token:chainId

const allowanceKey = (token: Hex, owner: Hex, spender: Hex, chainId: number): AllowanceKey =>
  `${token.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}:${chainId}` as AllowanceKey;
const setCodeKey = (address: Hex, chainId: number): SetCodeKey =>
  `${address.toLowerCase()}:${chainId}` as SetCodeKey;
const permitKey = (token: Hex, chainId: number): PermitKey =>
  `${token.toLowerCase()}:${chainId}` as PermitKey;

type AllowanceQuery = {
  type: 'allowance';
  token: Hex;
  owner: Hex;
  spender: Hex;
  chainId: number;
};

type SetCodeQuery = {
  type: 'setCode';
  address: Hex;
  chainId: number;
};

type NativeAllowanceQuery = {
  type: 'nativeAllowance';
  address: Hex;
  spender: Hex;
  chainId: number;
};

type PermitQuery = {
  type: 'permit';
  token: Hex;
  chainId: number;
};

type CacheQuery = AllowanceQuery | SetCodeQuery | NativeAllowanceQuery | PermitQuery;

type PublicClientMap = Record<number, Pick<PublicClient, 'multicall' | 'getCode' | 'readContract'>>;

const CALIBUR_NATIVE_ALLOWANCE_ABI = [
  {
    type: 'function',
    name: 'nativeAllowance',
    inputs: [{ name: 'spender', type: 'address' }],
    outputs: [{ name: 'allowance', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const CALIBUR_DELEGATED_CODE = `0xef0100${CALIBUR_ADDRESS.slice(2).toLowerCase()}` as const;

// ---------------------------------------------------------------------------
// SwapCache
// ---------------------------------------------------------------------------

/**
 * Batches allowance and code queries, processes them via multicall,
 * then provides cached results.
 */
export class SwapCache {
  constructor(private readonly chainList: ChainListType) {}

  private queries: CacheQuery[] = [];
  private allowances = new Map<AllowanceKey, bigint>();
  private codeResults = new Map<SetCodeKey, string | undefined>();
  private permits = new Map<PermitKey, PermitDetails | undefined>();

  // ---------------------------------------------------------------------------
  // Add queries
  // ---------------------------------------------------------------------------

  addAllowanceQuery(token: Hex, owner: Hex, spender: Hex, chainId: number): void {
    this.queries.push({ type: 'allowance', token, owner, spender, chainId });
  }

  addSetCodeQuery(address: Hex, chainId: number): void {
    this.queries.push({ type: 'setCode', address, chainId });
  }

  addNativeAllowanceQuery(address: Hex, spender: Hex, chainId: number): void {
    this.queries.push({ type: 'nativeAllowance', address, spender, chainId });
  }

  addPermitQuery(token: Hex, chainId: number): void {
    this.queries.push({ type: 'permit', token, chainId });
  }

  // ---------------------------------------------------------------------------
  // Process all queued queries
  // ---------------------------------------------------------------------------

  async process(clients: PublicClientMap): Promise<void> {
    logger.debug('swapCache:processStart', {
      queuedQueryCount: this.queries.length,
      clientChainIds: Object.keys(clients).map(Number),
    });

    if (this.queries.length === 0) {
      logger.debug('swapCache:skip_no_queries', {
        clientChainIds: Object.keys(clients).map(Number),
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
          logger.debug('swapCache:skip_missing_client', {
            chainId,
            availableClientChainIds: Object.keys(clients).map(Number),
            chainQueries,
          });
          return;
        }

        try {
          const allowanceQueries = chainQueries.filter(
            (q): q is AllowanceQuery => q.type === 'allowance'
          );
          const nativeAllowanceQueries = chainQueries.filter(
            (q): q is NativeAllowanceQuery => q.type === 'nativeAllowance'
          );
          const setCodeQueries = chainQueries.filter(
            (q): q is SetCodeQuery => q.type === 'setCode'
          );
          const permitQueries = chainQueries.filter((q): q is PermitQuery => q.type === 'permit');

          if (allowanceQueries.length > 0) {
            const contracts = allowanceQueries.map((q) => {
              if (q.type === 'allowance') {
                return {
                  address: q.token,
                  abi: erc20Abi,
                  functionName: 'allowance' as const,
                  args: [q.owner, q.spender] as const,
                };
              }
              return {
                address: CALIBUR_ADDRESS,
                abi: erc20Abi,
                functionName: 'allowance' as const,
                args: [q.owner, q.spender] as const,
              };
            });

            logger.debug('swapCache:allowanceQueries', {
              chainId,
              queries: allowanceQueries.map((q) => ({
                type: q.type,
                token: q.token,
                owner: q.owner,
                spender: q.spender,
              })),
              contracts,
            });

            const multicallAddress = this.chainList.getChainByID(chainId).multicallAddress;
            const results = await client.multicall({ multicallAddress, contracts });

            logger.debug('swapCache:allowanceResults', {
              chainId,
              results: results.map((r, i) => ({
                query: allowanceQueries[i],
                status: r?.status,
                result: typeof r?.result === 'bigint' ? r.result.toString() : r?.result,
                error: r && 'error' in r && r.error instanceof Error ? r.error.message : undefined,
              })),
            });

            for (let i = 0; i < allowanceQueries.length; i++) {
              const q = allowanceQueries[i];
              const r = results[i];
              const key = allowanceKey(q.token, q.owner, q.spender, q.chainId);
              this.allowances.set(key, typeof r?.result === 'bigint' ? r.result : 0n);
            }
          }

          if (nativeAllowanceQueries.length > 0) {
            const nativeResults = await Promise.all(
              nativeAllowanceQueries.map(async (q) => {
                const [code, allowance] = await Promise.all([
                  client.getCode({ address: q.address }).catch(() => undefined),
                  typeof client.readContract === 'function'
                    ? client
                        .readContract({
                          address: q.address,
                          abi: CALIBUR_NATIVE_ALLOWANCE_ABI,
                          functionName: 'nativeAllowance',
                          args: [q.spender],
                        })
                        .catch(() => 0n)
                    : Promise.resolve(0n),
                ]);

                const normalizedCode = typeof code === 'string' ? code.toLowerCase() : undefined;
                const result =
                  normalizedCode === CALIBUR_DELEGATED_CODE && typeof allowance === 'bigint'
                    ? allowance
                    : 0n;
                const key = allowanceKey(EADDRESS as Hex, q.address, q.spender, q.chainId);
                this.allowances.set(key, result);
                return {
                  address: q.address,
                  spender: q.spender,
                  code,
                  result,
                };
              })
            );

            logger.debug('swapCache:nativeAllowanceResults', {
              chainId,
              results: nativeResults.map((result) => ({
                address: result.address,
                spender: result.spender,
                code: result.code,
                result: result.result.toString(),
              })),
            });
          }

          if (setCodeQueries.length > 0) {
            const codeResults = await Promise.all(
              setCodeQueries.map(async (q) => ({
                query: q,
                code: await client.getCode({ address: q.address }).catch(() => undefined),
              }))
            );

            for (const result of codeResults) {
              const key = setCodeKey(result.query.address, result.query.chainId);
              this.codeResults.set(key, result.code);
            }
          }

          await Promise.all(
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

  hasAuthCodeSet(address: Hex, chainId: number): boolean {
    const key = setCodeKey(address, chainId);
    const code = this.codeResults.get(key);
    return code != null && typeof code === 'string' && code.startsWith('0xef0100');
  }

  markAuthCodeSet(address: Hex, chainId: number): void {
    const key = setCodeKey(address, chainId);
    this.codeResults.set(key, CALIBUR_DELEGATED_CODE);
  }

  getPermit(token: Hex, chainId: number): PermitDetails | undefined {
    const key = permitKey(token, chainId);
    return this.permits.get(key);
  }
}
