import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SwapCache } from '../../../src/swap/wallet/cache';
import { getAddress, type Hex } from 'viem';
import { EADDRESS, CALIBUR_ADDRESS } from '../../../src/swap/constants';
import { PermitVariant } from '../../../src/domain/permits';
import type { ChainListType, TokenInfo } from '../../../src/domain';

type CacheClients = Parameters<SwapCache['process']>[0];

const MOCK_TOKEN = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const MOCK_OWNER = '0xaaaa000000000000000000000000000000000001' as Hex;
const MOCK_SPENDER = '0xbbbb000000000000000000000000000000000002' as Hex;
const MOCK_ADDRESS = '0xcccc000000000000000000000000000000000003' as Hex;
const CHAIN_ID = 42161;
const CALIBUR_DELEGATED_CODE = `0xef0100${CALIBUR_ADDRESS.slice(2).toLowerCase()}` as Hex;
const DEPLOYMENT_MULTICALL_ADDRESS = '0x00000000000000000000000000000000000000aa' as Hex;

const makePublicClient = (overrides?: {
  multicallResults?: unknown[];
  multicallError?: Error;
  code?: string | undefined;
  getCodeError?: Error;
  readContractResult?: unknown;
  readContractError?: Error;
}) => ({
  multicall: overrides?.multicallError
    ? vi.fn().mockRejectedValue(overrides.multicallError)
    : vi.fn().mockResolvedValue(overrides?.multicallResults ?? []),
  getCode: overrides?.getCodeError
    ? vi.fn().mockRejectedValue(overrides.getCodeError)
    : vi.fn().mockResolvedValue(overrides?.code),
  readContract: overrides?.readContractError
    ? vi.fn().mockRejectedValue(overrides.readContractError)
    : vi.fn().mockResolvedValue(overrides?.readContractResult),
});

describe('SwapCache', () => {
  let cache: SwapCache;
  let chainList: ChainListType;

  const setTokenInfo = (token: TokenInfo | undefined) => {
    chainList = {
      getChainByID: vi
        .fn()
        .mockReturnValue({ id: CHAIN_ID, multicallAddress: DEPLOYMENT_MULTICALL_ADDRESS }),
      getTokenByAddress: vi.fn().mockImplementation((_chainId: number, tokenAddress: Hex) => {
        if (!token || token.contractAddress.toLowerCase() !== tokenAddress.toLowerCase()) {
          throw new Error('Token not found');
        }
        return token;
      }),
    } as unknown as ChainListType;
    cache = new SwapCache(chainList);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setTokenInfo({
      contractAddress: MOCK_TOKEN,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      permitVariant: PermitVariant.EIP2612Canonical,
      permitVersion: 2,
    });
  });

  it('process with no queries is a no-op', async () => {
    const client = makePublicClient();
    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);
    expect(client.multicall).not.toHaveBeenCalled();
  });

  it('batches and returns allowance from multicall', async () => {
    cache.addAllowanceQuery(MOCK_TOKEN, MOCK_OWNER, MOCK_SPENDER, CHAIN_ID);

    const client = makePublicClient({
      multicallResults: [{ result: 1000000n, status: 'success' }],
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    const allowance = cache.getAllowance(MOCK_TOKEN, MOCK_OWNER, MOCK_SPENDER, CHAIN_ID);
    expect(allowance).toBe(1000000n);
  });

  it('matches allowance, permit, and code entries across address casing', async () => {
    cache.addAllowanceQuery(MOCK_TOKEN, MOCK_OWNER, MOCK_SPENDER, CHAIN_ID);
    cache.addPermitQuery(MOCK_TOKEN, CHAIN_ID);
    cache.addSetCodeQuery(MOCK_ADDRESS, CHAIN_ID);

    await cache.process({
      [CHAIN_ID]: makePublicClient({
        multicallResults: [{ result: 123n, status: 'success' }],
        code: CALIBUR_DELEGATED_CODE,
      }),
    } as unknown as CacheClients);

    expect(
      cache.getAllowance(
        getAddress(MOCK_TOKEN),
        getAddress(MOCK_OWNER),
        getAddress(MOCK_SPENDER),
        CHAIN_ID
      )
    ).toBe(123n);
    expect(cache.getPermit(getAddress(MOCK_TOKEN), CHAIN_ID)).toMatchObject({
      permitVariant: PermitVariant.EIP2612Canonical,
    });
    expect(cache.hasAuthCodeSet(getAddress(MOCK_ADDRESS), CHAIN_ID)).toBe(true);
  });

  it('hasAuthCodeSet detects 0xef0100 delegation prefix', async () => {
    cache.addSetCodeQuery(MOCK_ADDRESS, CHAIN_ID);

    const client = makePublicClient({
      code: '0xef0100aabbccdd',
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(cache.hasAuthCodeSet(MOCK_ADDRESS, CHAIN_ID)).toBe(true);
  });

  it('processes setCode queries via getCode directly instead of multicall', async () => {
    cache.addSetCodeQuery(MOCK_ADDRESS, CHAIN_ID);

    const client = makePublicClient({
      code: '0xef0100aabbccdd',
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(client.getCode).toHaveBeenCalledWith({ address: MOCK_ADDRESS });
    expect(client.multicall).not.toHaveBeenCalled();
    expect(cache.hasAuthCodeSet(MOCK_ADDRESS, CHAIN_ID)).toBe(true);
  });

  it('hasAuthCodeSet returns false when no code set', async () => {
    cache.addSetCodeQuery(MOCK_ADDRESS, CHAIN_ID);

    const client = makePublicClient({
      multicallResults: [{ result: undefined, status: 'success' }],
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(cache.hasAuthCodeSet(MOCK_ADDRESS, CHAIN_ID)).toBe(false);
  });

  it('returns 0n for unqueried allowance', () => {
    const allowance = cache.getAllowance(MOCK_TOKEN, MOCK_OWNER, MOCK_SPENDER, CHAIN_ID);
    expect(allowance).toBe(0n);
  });

  it('tracks native allowance queries against the delegated ephemeral account', async () => {
    cache.addNativeAllowanceQuery(MOCK_ADDRESS, MOCK_SPENDER, CHAIN_ID);

    const client = makePublicClient({
      code: CALIBUR_DELEGATED_CODE,
      readContractResult: 123n,
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(client.getCode).toHaveBeenCalledWith({ address: MOCK_ADDRESS });
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MOCK_ADDRESS,
        functionName: 'nativeAllowance',
        args: [MOCK_SPENDER],
      })
    );
    expect(client.multicall).not.toHaveBeenCalled();
    expect(cache.getAllowance(EADDRESS as Hex, MOCK_ADDRESS, MOCK_SPENDER, CHAIN_ID)).toBe(123n);
  });

  it('stores 0n for native allowance when delegated code does not point at Calibur', async () => {
    cache.addNativeAllowanceQuery(MOCK_ADDRESS, MOCK_SPENDER, CHAIN_ID);

    const client = makePublicClient({
      code: '0xef0100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      readContractResult: 999n,
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(cache.getAllowance(EADDRESS as Hex, MOCK_ADDRESS, MOCK_SPENDER, CHAIN_ID)).toBe(0n);
  });

  it('stores 0n for native allowance when nativeAllowance read reverts', async () => {
    cache.addNativeAllowanceQuery(MOCK_ADDRESS, MOCK_SPENDER, CHAIN_ID);

    const client = makePublicClient({
      code: CALIBUR_DELEGATED_CODE,
      readContractError: new Error('missing nativeAllowance'),
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(cache.getAllowance(EADDRESS as Hex, MOCK_ADDRESS, MOCK_SPENDER, CHAIN_ID)).toBe(0n);
  });

  it('stores permit registry results for queued permit queries', async () => {
    cache.addPermitQuery(MOCK_TOKEN, CHAIN_ID);

    await cache.process({ [CHAIN_ID]: makePublicClient() } as unknown as CacheClients);

    expect(cache.getPermit(MOCK_TOKEN, CHAIN_ID)).toEqual({
      permitVariant: PermitVariant.EIP2612Canonical,
      permitContractVersion: 2,
    });
  });

  it('uses chainlist permit metadata without probing the chain', async () => {
    cache.addPermitQuery(MOCK_TOKEN, CHAIN_ID);
    const client = makePublicClient();

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(client.multicall).not.toHaveBeenCalled();
    expect(cache.getPermit(MOCK_TOKEN, CHAIN_ID)).toEqual({
      permitVariant: PermitVariant.EIP2612Canonical,
      permitContractVersion: 2,
    });
  });

  it('probes canonical permit support via multicall when chainlist permit metadata is missing', async () => {
    setTokenInfo({
      contractAddress: MOCK_TOKEN,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
    });
    cache.addPermitQuery(MOCK_TOKEN, CHAIN_ID);

    const client = makePublicClient({
      multicallResults: [
        { result: `0x${'11'.repeat(32)}`, status: 'success' },
        { result: 0n, status: 'success' },
        { result: '2', status: 'success' },
      ],
    });

    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    expect(client.multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        multicallAddress: DEPLOYMENT_MULTICALL_ADDRESS,
        allowFailure: true,
      })
    );
    expect(client.getCode).not.toHaveBeenCalled();
    expect(client.readContract).not.toHaveBeenCalled();
    expect(cache.getPermit(MOCK_TOKEN, CHAIN_ID)).toEqual({
      permitVariant: PermitVariant.EIP2612Canonical,
      permitContractVersion: 2,
    });
  });

  it('gracefully handles multicall failure', async () => {
    cache.addAllowanceQuery(MOCK_TOKEN, MOCK_OWNER, MOCK_SPENDER, CHAIN_ID);

    const client = makePublicClient({
      multicallError: new Error('RPC down'),
    });

    // Should not throw
    await cache.process({ [CHAIN_ID]: client } as unknown as CacheClients);

    // Fallback to 0n
    const allowance = cache.getAllowance(MOCK_TOKEN, MOCK_OWNER, MOCK_SPENDER, CHAIN_ID);
    expect(allowance).toBe(0n);
  });

  it('handles multiple queries across different chains', async () => {
    const chainA = 42161;
    const chainB = 10;

    cache.addAllowanceQuery(MOCK_TOKEN, MOCK_OWNER, MOCK_SPENDER, chainA);
    cache.addSetCodeQuery(MOCK_ADDRESS, chainB);

    const clientA = makePublicClient({
      multicallResults: [{ result: 500n, status: 'success' }],
    });
    const clientB = makePublicClient({
      code: '0xef0100aabb',
    });

    await cache.process({ [chainA]: clientA, [chainB]: clientB } as unknown as CacheClients);

    expect(cache.getAllowance(MOCK_TOKEN, MOCK_OWNER, MOCK_SPENDER, chainA)).toBe(500n);
    expect(cache.hasAuthCodeSet(MOCK_ADDRESS, chainB)).toBe(true);
  });
});
