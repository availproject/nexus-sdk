import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSignature, type Hex, type PublicClient, type WalletClient } from 'viem';
import { PermitVariant } from '../../../src/domain/permits';

vi.mock('../../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn().mockResolvedValue(
    (`0x${'aa'.repeat(65)}`) as Hex
  ),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    parseSignature: vi.fn().mockReturnValue({
      r: `0x${'11'.repeat(32)}` as Hex,
      s: `0x${'22'.repeat(32)}` as Hex,
      v: undefined,
      yParity: undefined,
    }),
  };
});

import {
  buildTransferAuthorization,
  materializePermitAuthorizationCall,
} from '../../../src/swap/wallet/transfer-authorization';
import { SwapCache } from '../../../src/swap/wallet/cache';
import { makeChain } from '../../helpers/chains';
import { signPermitForAddressAndValue } from '../../../src/services/allowance-utils';
import type { ChainListType, TokenInfo } from '../../../src/domain';
import type { PublicClientList } from '../../../src/swap/types';

const TOKEN = '0x0000000000000000000000000000000000000001' as Hex;
const EOA = '0x0000000000000000000000000000000000000002' as Hex;
const EPH = '0x0000000000000000000000000000000000000003' as Hex;
const CHAIN_ID = 42161;
const CHAIN = makeChain(CHAIN_ID, 'Arbitrum');

describe('materializePermitAuthorizationCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the parsed permit signature does not include a recovery id', async () => {
    await expect(
      materializePermitAuthorizationCall({
        chain: CHAIN,
        authorization: {
          kind: 'permit',
          call: null,
          permit: {
            signature: null,
            permitVariant: PermitVariant.EIP2612Canonical,
            permitContractVersion: 1,
          },
        },
        tokenAddress: TOKEN,
        tokenDecimals: 6,
        amount: 1n,
        eoaAddress: EOA,
        eoaWallet: {} as WalletClient,
        ephemeralAddress: EPH,
        publicClient: {} as PublicClient,
      })
    ).rejects.toThrow('Permit signature missing recovery id');
  });

  it('threads the chain into lazy permit signing', async () => {
    vi.mocked(signPermitForAddressAndValue).mockResolvedValueOnce(
      (`0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}`) as Hex
    );
    vi.mocked(parseSignature).mockReturnValueOnce({
      r: `0x${'11'.repeat(32)}` as Hex,
      s: `0x${'22'.repeat(32)}` as Hex,
      v: 27n,
      yParity: 0,
    });

    await materializePermitAuthorizationCall({
      chain: CHAIN,
      authorization: {
        kind: 'permit',
        call: null,
        permit: {
          signature: null,
          permitVariant: PermitVariant.EIP2612Canonical,
          permitContractVersion: 1,
        },
      },
      tokenAddress: TOKEN,
      tokenDecimals: 6,
      amount: 1n,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralAddress: EPH,
      publicClient: {} as PublicClient,
    });

    expect(signPermitForAddressAndValue).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAddress: TOKEN }),
      CHAIN,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ address: EOA }),
      EPH,
      1n
    );
  });
});

describe('buildTransferAuthorization', () => {
  const PERMIT_TOKEN: TokenInfo = {
    contractAddress: TOKEN,
    decimals: 6,
    logo: '',
    name: 'USD Coin',
    symbol: 'USDC',
    permitVariant: PermitVariant.EIP2612Canonical,
    permitVersion: 2,
  };

  // Seed a cache whose token supports EIP-2612 permit (so the default decision is 'permit').
  const makeCacheWithPermit = async (): Promise<SwapCache> => {
    const chainList = {
      getChainByID: vi
        .fn()
        .mockReturnValue({ id: CHAIN_ID, multicallAddress: CHAIN.multicallAddress }),
      getTokenByAddress: vi.fn().mockReturnValue(PERMIT_TOKEN),
    } as unknown as ChainListType;
    const cache = new SwapCache(chainList);
    cache.addPermitQuery(TOKEN, CHAIN_ID);
    await cache.process({
      [CHAIN_ID]: { multicall: vi.fn(), getCode: vi.fn(), readContract: vi.fn() },
    } as unknown as Parameters<SwapCache['process']>[0]);
    return cache;
  };

  const clientList = { get: () => ({}) } as unknown as PublicClientList;

  const build = (cache: SwapCache) =>
    buildTransferAuthorization({
      chain: CHAIN,
      tokenAddress: TOKEN,
      tokenDecimals: 6,
      amount: 5_000_000n,
      eoaAddress: EOA,
      eoaWallet: {} as WalletClient,
      ephemeralAddress: EPH,
      publicClientList: clientList,
      cache,
      eagerPermit: false,
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chooses approve over permit when the funding EOA has 7702 auth code set', async () => {
    const cache = await makeCacheWithPermit();
    cache.markAuthCodeSet(EOA, CHAIN_ID); // funding EOA is a delegated smart account

    const result = await build(cache);

    expect(result?.kind).toBe('approve');
  });

  it('still chooses permit for a non-delegated funding EOA', async () => {
    const cache = await makeCacheWithPermit();

    const result = await build(cache);

    expect(result?.kind).toBe('permit');
  });
});
