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

  it('falls back to zero when an allowance multicall fails', async () => {
    cache.addAllowanceQuery(TOKEN, OWNER, SPENDER, CHAIN_ID);
    await cache.process({
      [CHAIN_ID]: makePublicClient({ multicallError: new Error('RPC down') }),
    } as unknown as CacheClients);
    expect(cache.getAllowance(TOKEN, OWNER, SPENDER, CHAIN_ID)).toBe(0n);
  });
});
