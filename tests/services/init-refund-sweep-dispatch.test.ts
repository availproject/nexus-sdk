import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { ChainListType } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { EADDRESS } from '../../src/swap/constants';
import { predictSafeAccountAddress, predictSafeAccountAddressV2 } from '../../src/swap/safe/predict';
import type { PublicClientList } from '../../src/swap/types';
import { sweepEphemeralRefundsToEoa } from '../../src/services/init-refund-sweep';
import { makeSwapMiddlewareClient } from '../helpers/middleware-client';

vi.mock('../../src/services/safe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/services/safe')>();
  return {
    ...orig,
    createSafeExecuteTxFromCalls: vi.fn().mockResolvedValue({
      chainId: 42161,
      eoaAddress: '0xaaaa000000000000000000000000000000000001',
      ephemeralAddress: '0xbbbb000000000000000000000000000000000002',
      safeAddress: '0xacc1ffaf0000000000000000000000000000beef',
      to: '0xacc1ffaf0000000000000000000000000000beef',
      value: '0',
      data: '0xdeadbeef',
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce: '0',
      signature: '0x',
    }),
    ensureSafeForEphemeral: vi.fn().mockResolvedValue({
      chainId: 42161,
      eoaAddress: '0xaaaa000000000000000000000000000000000001',
      ephemeralAddress: '0xbbbb000000000000000000000000000000000002',
      address: '0xacc1ffaf0000000000000000000000000000beef',
      factoryAddress: '0x0000000000000000000000000000000000000000',
      exists: true,
    }),
  };
});

import { createSafeExecuteTxFromCalls } from '../../src/services/safe';

const CHAIN_ID = 42161;
const MULTICALL = '0xca11000000000000000000000000000000000001' as Hex;
const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDT = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' as Hex;
const NON_BRIDGE_TOKEN = '0x1111000000000000000000000000000000000004' as Hex;
const EPHEMERAL = '0xbbbb000000000000000000000000000000000002' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;

const bridgeTokens = [
  {
    contractAddress: USDC,
    decimals: 6,
    symbol: 'USDC',
    name: 'USD Coin',
    logo: '',
    currencyId: 1,
    permitVariant: 1,
    permitVersion: 2,
  },
  {
    contractAddress: USDT,
    decimals: 6,
    symbol: 'USDT',
    name: 'Tether USD',
    logo: '',
    currencyId: 2,
  },
];

const makeChainList = (): ChainListType => {
  const chain = {
    id: CHAIN_ID,
    name: 'Arbitrum',
    multicallAddress: MULTICALL,
    nativeCurrency: {
      decimals: 18,
      symbol: 'ETH',
      name: 'Ether',
      logo: '',
      currencyId: 3,
    },
    custom: {
      icon: '',
      knownTokens: [
        ...bridgeTokens,
        {
          contractAddress: NON_BRIDGE_TOKEN,
          decimals: 18,
          symbol: 'OTHER',
          name: 'Other',
          logo: '',
        },
      ],
    },
    rpcUrls: { default: { http: ['https://example.invalid'], webSocket: [] } },
    swapSupported: true,
    universe: Universe.ETHEREUM,
  };

  return {
    chains: [chain],
    getChainByID: vi.fn(() => chain),
    getTokenByAddress: vi.fn((_id: number, address: Hex) => {
      const token = bridgeTokens.find(
        (candidate) => candidate.contractAddress.toLowerCase() === address.toLowerCase()
      );
      if (!token) throw new Error('token not found');
      return token;
    }),
    getNativeToken: vi.fn(() => ({
      contractAddress: EADDRESS,
      decimals: 18,
      symbol: 'ETH',
      name: 'Ether',
      logo: '',
      currencyId: 3,
    })),
    getTokenByCurrencyId: vi.fn(),
    getChainAndTokenByAddress: vi.fn(),
    getTokenInfoBySymbol: vi.fn(),
    getVaultContractAddress: vi.fn(),
    getChainAndTokenFromSymbol: vi.fn(),
  } as unknown as ChainListType;
};

type BalanceKey = `${string}:${string}`;

const makePublicClientList = (balances: Map<BalanceKey, bigint> = new Map()) => {
  const legacySafeAddress = predictSafeAccountAddress(EPHEMERAL).address;
  const multicall = vi.fn(
    async ({
      contracts,
    }: {
      multicallAddress: Hex;
      contracts: Array<{ address: Hex; functionName: string; args: Hex[] }>;
    }) =>
      contracts.map((contract) => {
        const holder = contract.args[0]!;
        const tokenAddress = contract.functionName === 'getEthBalance' ? EADDRESS : contract.address;
        return {
          status: 'success' as const,
          result: balances.get(
            `${holder.toLowerCase()}:${tokenAddress.toLowerCase()}` as BalanceKey
          ) ?? 0n,
        };
      })
  );
  const publicClient = {
    getCode: vi.fn(async ({ address }: { address: Hex }) =>
      address.toLowerCase() === legacySafeAddress.toLowerCase() ? ('0x6000' as Hex) : undefined
    ),
    multicall,
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) =>
      functionName === 'name' ? 'USD Coin' : 0n
    ),
  };
  const list = { get: vi.fn().mockReturnValue(publicClient) } as unknown as PublicClientList;
  return { list, multicall, publicClient };
};

const makeEphemeralWallet = (): PrivateKeyAccount =>
  ({
    address: EPHEMERAL,
    signTypedData: vi.fn().mockResolvedValue(`0x${'11'.repeat(64)}1b` as Hex),
  }) as unknown as PrivateKeyAccount;

describe('sweepEphemeralRefundsToEoa dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads all bridge balances for the ephemeral, V1 Safe, and V2 Safe in one multicall', async () => {
    const { list, multicall } = makePublicClientList();
    const getSwapBalances = vi.fn().mockResolvedValue([]);
    const middlewareClient = makeSwapMiddlewareClient({ getSwapBalances });

    await sweepEphemeralRefundsToEoa({
      ctx: {
        chainList: makeChainList(),
        middlewareClient,
        publicClientList: list,
        ephemeralWallet: makeEphemeralWallet(),
        eoaAddress: EOA,
        cache: undefined,
      },
    });

    expect(getSwapBalances).not.toHaveBeenCalled();
    expect(multicall).toHaveBeenCalledTimes(1);
    const request = multicall.mock.calls[0]![0];
    expect(request.multicallAddress).toBe(MULTICALL);
    expect(request.contracts).toHaveLength(9);
    expect(request.contracts.some((contract) => contract.address === NON_BRIDGE_TOKEN)).toBe(false);

    const expectedHolders = [
      EPHEMERAL,
      predictSafeAccountAddress(EPHEMERAL).address,
      predictSafeAccountAddressV2(EOA, EPHEMERAL).address,
    ].map((address) => address.toLowerCase());
    const queriedHolders = new Set(
      request.contracts.map((contract) => contract.args[0]!.toLowerCase())
    );
    expect(queriedHolders).toEqual(new Set(expectedHolders));
  });

  it('refunds a legacy V1 Safe balance through the V1 middleware execution path', async () => {
    const legacySafeAddress = predictSafeAccountAddress(EPHEMERAL).address;
    const balances = new Map<BalanceKey, bigint>([
      [`${legacySafeAddress.toLowerCase()}:${USDC.toLowerCase()}`, 5_000_000n],
    ]);
    const { list } = makePublicClientList(balances);
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xv2' as Hex });
    const createLegacySafeExecuteTx = vi.fn().mockResolvedValue({
      chainId: CHAIN_ID,
      safeAddress: legacySafeAddress,
      txHash: '0xv1' as Hex,
    });
    const legacySafe = {
      getSafeAccountAddress: vi.fn(),
      ensureSafeAccount: vi.fn(),
      createSafeExecuteTx: createLegacySafeExecuteTx,
    };
    const middlewareClient = Object.assign(
      makeSwapMiddlewareClient({ createSafeExecuteTx }),
      { legacySafe }
    );

    await sweepEphemeralRefundsToEoa({
      ctx: {
        chainList: makeChainList(),
        middlewareClient,
        publicClientList: list,
        ephemeralWallet: makeEphemeralWallet(),
        eoaAddress: EOA,
        cache: undefined,
      },
    });

    expect(createLegacySafeExecuteTx).toHaveBeenCalledTimes(1);
    expect(createLegacySafeExecuteTx.mock.calls[0]![0].safeAddress).toBe(legacySafeAddress);
    expect(createSafeExecuteTx).not.toHaveBeenCalled();
    expect(createSafeExecuteTxFromCalls).not.toHaveBeenCalled();
  });

  it('keeps ephemeral permit pulls and V2 Safe balances in one V2 transaction per chain', async () => {
    const safeAddress = predictSafeAccountAddressV2(EOA, EPHEMERAL).address;
    const balances = new Map<BalanceKey, bigint>([
      [`${EPHEMERAL.toLowerCase()}:${USDC.toLowerCase()}`, 5_000_000n],
      [`${safeAddress.toLowerCase()}:${EADDRESS.toLowerCase()}`, 300_000_000_000_000_000n],
    ]);
    const { list } = makePublicClientList(balances);
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xv2' as Hex });
    const middlewareClient = makeSwapMiddlewareClient({ createSafeExecuteTx });

    await sweepEphemeralRefundsToEoa({
      ctx: {
        chainList: makeChainList(),
        middlewareClient,
        publicClientList: list,
        ephemeralWallet: makeEphemeralWallet(),
        eoaAddress: EOA,
        cache: undefined,
      },
    });

    expect(createSafeExecuteTx).toHaveBeenCalledTimes(1);
    expect(createSafeExecuteTxFromCalls).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]![0]).toMatchObject({
      chainId: CHAIN_ID,
      safeAddress,
    });
    expect(vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]![0].calls).toHaveLength(3);
  });
});
