import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Hex } from 'viem';
import type { ChainListType, TokenInfo } from '../../../src/domain';
import { PermitVariant } from '../../../src/domain/permits';
import { SwapCache } from '../../../src/swap/wallet/cache';

type CacheClients = Parameters<SwapCache['process']>[0];

const TOKEN = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const OWNER = '0xaaaa000000000000000000000000000000000001' as Hex;
const SPENDER = '0xbbbb000000000000000000000000000000000002' as Hex;
const CHAIN_ID = 42161;
const MULTICALL = '0x00000000000000000000000000000000000000aa' as Hex;
const SAFE = '0xcccc000000000000000000000000000000000003' as Hex;
const SAFE_FACTORY = '0xdddd000000000000000000000000000000000004' as Hex;

const makePublicClient = (overrides?: {
  multicallResults?: unknown[];
  multicallError?: Error;
}) => ({
  multicall: overrides?.multicallError
    ? vi.fn().mockRejectedValue(overrides.multicallError)
    : vi.fn().mockResolvedValue(overrides?.multicallResults ?? []),
  getCode: vi.fn(),
  readContract: vi.fn(),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('SwapCache', () => {
  let cache: SwapCache;
  let chainList: ChainListType;

  const setTokenInfo = (token: TokenInfo) => {
    chainList = {
      getChainByID: vi.fn().mockReturnValue({ id: CHAIN_ID, multicallAddress: MULTICALL }),
      getTokenByAddress: vi.fn().mockReturnValue(token),
    } as unknown as ChainListType;
    cache = new SwapCache(chainList);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setTokenInfo({
      contractAddress: TOKEN,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      permitVariant: PermitVariant.EIP2612Canonical,
      permitVersion: 2,
    });
  });

  it('is a no-op with no queries', async () => {
    const client = makePublicClient();
    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);
    expect(client.multicall).not.toHaveBeenCalled();
  });

  it('batches and caches allowances case-insensitively', async () => {
    cache.addAllowanceQuery(TOKEN, OWNER, SPENDER, CHAIN_ID);
    const client = makePublicClient({
      multicallResults: [{ result: 1_000_000n, status: 'success' }],
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(
      cache.getAllowance(getAddress(TOKEN), getAddress(OWNER), getAddress(SPENDER), CHAIN_ID)
    ).toBe(1_000_000n);
  });

  it('returns zero for an unknown allowance and supports confirmed updates', () => {
    expect(cache.getAllowance(TOKEN, OWNER, SPENDER, CHAIN_ID)).toBe(0n);
    cache.setAllowance(TOKEN, OWNER, SPENDER, CHAIN_ID, 750n);
    expect(cache.getAllowance(TOKEN, OWNER, SPENDER, CHAIN_ID)).toBe(750n);
  });

  it('stores permit metadata from the chain list without probing', async () => {
    cache.addPermitQuery(TOKEN, CHAIN_ID);
    const client = makePublicClient();

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(client.multicall).not.toHaveBeenCalled();
    expect(cache.getPermit(TOKEN, CHAIN_ID)).toEqual({
      permitVariant: PermitVariant.EIP2612Canonical,
      permitContractVersion: 2,
    });
  });

  it('caches the derived Safe identity and its per-chain deployment state', async () => {
    cache = new SwapCache(chainList, { address: SAFE, factoryAddress: SAFE_FACTORY });
    cache.addSafeAccountQuery(CHAIN_ID);
    const client = makePublicClient();
    client.getCode.mockResolvedValue('0x60806040');

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(client.getCode).toHaveBeenCalledTimes(1);
    expect(client.getCode).toHaveBeenCalledWith({ address: SAFE });
    expect(cache.getSafeAccount(CHAIN_ID)).toEqual({
      address: SAFE,
      factoryAddress: SAFE_FACTORY,
      deployed: true,
    });
  });

  it('skips code reads for a known Safe deployment', async () => {
    cache = new SwapCache(chainList, { address: SAFE, factoryAddress: SAFE_FACTORY });
    cache.addSafeAccountQuery(CHAIN_ID);
    cache.setSafeDeployed(CHAIN_ID);
    const client = makePublicClient();

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(client.getCode).not.toHaveBeenCalled();
    expect(cache.getSafeAccount(CHAIN_ID)?.deployed).toBe(true);
  });

  it('probes canonical permit support when metadata is missing', async () => {
    setTokenInfo({
      contractAddress: TOKEN,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    });
    cache.addPermitQuery(TOKEN, CHAIN_ID);
    const client = makePublicClient({
      multicallResults: [
        { result: `0x${'11'.repeat(32)}`, status: 'success' },
        { result: 0n, status: 'success' },
        { result: '2', status: 'success' },
      ],
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(cache.getPermit(TOKEN, CHAIN_ID)).toEqual({
      permitVariant: PermitVariant.EIP2612Canonical,
      permitContractVersion: 2,
    });
  });

  it('starts allowance reads and permit probing concurrently', async () => {
    setTokenInfo({
      contractAddress: TOKEN,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    });
    cache.addAllowanceQuery(TOKEN, OWNER, SPENDER, CHAIN_ID);
    cache.addPermitQuery(TOKEN, CHAIN_ID);
    const allowance = deferred<unknown[]>();
    const permit = deferred<unknown[]>();
    const client = makePublicClient();
    client.multicall
      .mockImplementationOnce(() => allowance.promise)
      .mockImplementationOnce(() => permit.promise);

    const processing = cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);
    await Promise.resolve();
    await Promise.resolve();

    expect(client.multicall).toHaveBeenCalledTimes(2);

    allowance.resolve([{ result: 1_000_000n, status: 'success' }]);
    permit.resolve([
      { result: `0x${'11'.repeat(32)}`, status: 'success' },
      { result: 0n, status: 'success' },
      { result: '2', status: 'success' },
    ]);
    await processing;
  });

  it('falls back to zero when an allowance multicall fails', async () => {
    cache.addAllowanceQuery(TOKEN, OWNER, SPENDER, CHAIN_ID);
    await cache.process({
      [CHAIN_ID]: makePublicClient({ multicallError: new Error('RPC down') }),
    } as unknown as CacheClients);
    expect(cache.getAllowance(TOKEN, OWNER, SPENDER, CHAIN_ID)).toBe(0n);
  });
});
