import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type {
  ChainListType,
  EthereumProvider,
  IntentRecord,
  ListIntentsResult,
} from '../../src';
import { IntentStatus, createNexusClient } from '../../src';
import { Universe } from '../../src/domain/chain-abstraction';
import type { MiddlewareClient } from '../../src/transport';
import { makeMiddlewareClient as makeBaseMiddlewareClient } from '../helpers/middleware-client';

const hoisted = vi.hoisted(() => ({
  createChainList: vi.fn(),
}));

vi.mock('../../src/services/chain-list', () => ({
  createChainList: hoisted.createChainList,
}));

const USER_ADDRESS = '0x0000000000000000000000000000000000000aaa' as Hex;
const SOLVER_ADDRESS = '0x0000000000000000000000000000000000000bbb' as Hex;
const RECIPIENT_ADDRESS = '0x0000000000000000000000000000000000000ccc' as Hex;
const SOURCE_TOKEN_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Hex;
const DESTINATION_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;
const REQUEST_HASH =
  '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;

const toBytes32Address = (address: Hex): Hex =>
  `0x${address.slice(2).padStart(64, '0')}` as Hex;

const makeProvider = (): EthereumProvider =>
  ({
    request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      switch (method) {
        case 'eth_accounts':
          return [USER_ADDRESS];
        case 'eth_chainId':
          return '0xa4b1';
        case 'personal_sign':
          return `0x${'ab'.repeat(65)}`;
        default:
          throw new Error(`Unhandled provider method: ${method}`);
      }
    }),
  }) as unknown as EthereumProvider;

const makeChainList = (): ChainListType =>
  ({
    getChainByID: vi.fn().mockImplementation((chainId: number) => {
      if (chainId === 1) {
        return {
          id: 1,
          name: 'Ethereum',
          universe: Universe.ETHEREUM,
          blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
          custom: {
            icon: 'https://example.com/ethereum.png',
            knownTokens: [],
          },
          nativeCurrency: {
            decimals: 18,
            logo: 'https://example.com/eth.png',
            name: 'Ether',
            symbol: 'ETH',
          },
          rpcUrls: { default: { http: ['https://eth.example'] } },
        };
      }

      return {
        id: 42161,
        name: 'Arbitrum',
        universe: Universe.ETHEREUM,
        blockExplorers: { default: { name: 'Arbiscan', url: 'https://arbiscan.io' } },
        custom: {
          icon: 'https://example.com/arbitrum.png',
          knownTokens: [],
        },
        nativeCurrency: {
          decimals: 18,
          logo: 'https://example.com/arb-eth.png',
          name: 'Ether',
          symbol: 'ETH',
        },
        rpcUrls: { default: { http: ['https://arb.example'] } },
      };
    }),
    getChainAndTokenByAddress: vi.fn().mockImplementation((chainId: number, address: Hex) => {
      const normalized = address.toLowerCase();

      if (chainId === 1 && normalized === SOURCE_TOKEN_ADDRESS.toLowerCase()) {
        return {
          chain: {
            id: 1,
            name: 'Ethereum',
            universe: Universe.ETHEREUM,
            custom: { icon: 'https://example.com/ethereum.png', knownTokens: [] },
          },
          token: {
            contractAddress: SOURCE_TOKEN_ADDRESS,
            decimals: 6,
            symbol: 'USDC',
            name: 'USD Coin',
            logo: 'https://example.com/usdc.png',
          },
          isNativeToken: false,
        };
      }

      if (chainId === 42161 && normalized === DESTINATION_TOKEN_ADDRESS.toLowerCase()) {
        return {
          chain: {
            id: 42161,
            name: 'Arbitrum',
            universe: Universe.ETHEREUM,
            custom: { icon: 'https://example.com/arbitrum.png', knownTokens: [] },
          },
          token: {
            contractAddress: DESTINATION_TOKEN_ADDRESS,
            decimals: 18,
            symbol: 'ETH',
            name: 'Ether',
            logo: 'https://example.com/eth.png',
          },
          isNativeToken: true,
        };
      }

      throw new Error(`Unexpected token lookup for ${chainId}:${address}`);
    }),
  }) as unknown as ChainListType;

const makeMiddlewareClient = (): MiddlewareClient =>
  makeBaseMiddlewareClient({
    getDeployment: vi.fn().mockResolvedValue({ network: 'testnet' }),
    getRFFStatus: vi.fn().mockResolvedValue({ status: IntentStatus.Fulfilled }),
    configureTiming: vi.fn(),
    listRFFs: vi.fn().mockResolvedValue({
      rffs: [
        {
          request_hash: REQUEST_HASH,
          status: IntentStatus.Fulfilled,
          solver: toBytes32Address(SOLVER_ADDRESS),
          created_at: 1710000000,
          updated_at: 1710000123,
          request: {
            sources: [
              {
                universe: 'EVM',
                chain_id: '1',
                contract_address: toBytes32Address(SOURCE_TOKEN_ADDRESS),
                value: '1230000',
                fee: '1000',
              },
            ],
            destination_universe: 'EVM',
            destination_chain_id: '42161',
            recipient_address: toBytes32Address(RECIPIENT_ADDRESS),
            destinations: [
              {
                contract_address: toBytes32Address(DESTINATION_TOKEN_ADDRESS),
                value: '1200000000000000000',
              },
            ],
            nonce: '7',
            expiry: '1710003600',
            parties: [],
          },
        },
      ],
      total: 1,
    }),
  });

describe('createNexusClient listIntents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createChainList.mockReturnValue(makeChainList());
  });

  it('maps middleware RFFs into enriched display-ready intent records', async () => {
    const middlewareClient = makeMiddlewareClient();
    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());

    const result: ListIntentsResult = await client.listIntents({
      page: 2,
      status: IntentStatus.Fulfilled,
    });

    const expectedIntent: IntentRecord = {
      requestHash: REQUEST_HASH,
      explorerUrl:
        'https://nexus-v2.testnet.avail.so/rff/0x1111111111111111111111111111111111111111111111111111111111111111',
      status: IntentStatus.Fulfilled,
      solver: SOLVER_ADDRESS,
      createdAt: 1710000000,
      updatedAt: 1710000123,
      expiry: 1710003600,
      recipientAddress: RECIPIENT_ADDRESS,
      destinationChain: {
        id: 42161,
        name: 'Arbitrum',
        logo: 'https://example.com/arbitrum.png',
        universe: 'EVM',
      },
      sources: [
        {
          chain: {
            id: 1,
            name: 'Ethereum',
            logo: 'https://example.com/ethereum.png',
            universe: 'EVM',
          },
          token: {
            contractAddress: SOURCE_TOKEN_ADDRESS,
            decimals: 6,
            symbol: 'USDC',
            name: 'USD Coin',
            logo: 'https://example.com/usdc.png',
          },
          amountRaw: 1230000n,
          amount: '1.230000',
          feeRaw: 1000n,
          fee: '0.001000',
        },
      ],
      destinations: [
        {
          token: {
            contractAddress: DESTINATION_TOKEN_ADDRESS,
            decimals: 18,
            symbol: 'ETH',
            name: 'Ether',
            logo: 'https://example.com/eth.png',
          },
          amountRaw: 1200000000000000000n,
          amount: '1.200000000000000000',
        },
      ],
    };

    expect(result).toEqual({
      intents: [expectedIntent],
      total: 1,
    });
    expect(middlewareClient.listRFFs).toHaveBeenCalledWith({
      user: USER_ADDRESS,
      status: IntentStatus.Fulfilled,
      limit: 20,
      offset: 20,
    });
  });

  it('throws before hitting middleware when page is less than 1', async () => {
    const middlewareClient = makeMiddlewareClient();
    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());

    await expect(client.listIntents({ page: 0 })).rejects.toThrow();
    expect(middlewareClient.listRFFs).not.toHaveBeenCalled();
  });
});
