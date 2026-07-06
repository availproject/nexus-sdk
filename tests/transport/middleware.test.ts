import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateRffPayload } from '@avail-project/nexus-types';
import type { Hex } from 'viem';
import { createMiddlewareClient } from '../../src/transport/middleware';

vi.mock('axios', () => ({
  default: {
    create: vi.fn(),
  },
}));

type AxiosInstanceMock = {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

type AxiosRootMock = {
  create: ReturnType<typeof vi.fn>;
};

const axiosRootMock = axios as unknown as AxiosRootMock;

const makeClient = (): AxiosInstanceMock => ({
  get: vi.fn(),
  post: vi.fn(),
});

describe('createMiddlewareClient', () => {
  beforeEach(() => {
    axiosRootMock.create.mockReset();
    vi.unstubAllGlobals();
  });

  it('getBalances adapts v2 response to v1 format', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        '1': {
          universe: 'EVM',
          total_usd: '1.00',
          errored: false,
          currencies: [
            {
              token_address: '0x0000000000000000000000000000000000000001',
              balance: '100',
              symbol: 'USDC',
              decimals: 6,
              value: '1.00',
            },
          ],
        },
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getBalances('0x0000000000000000000000000000000000000000', 0);

    expect(result).toHaveLength(1);
    expect(result[0]?.universe).toBe(0);
    expect(result[0]?.currencies?.[0]?.balance).toBe('100');
    expect(axiosClient.get).toHaveBeenCalledTimes(1);
  });

  it('getBalances ignores chains with unsupported universes', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        '1': {
          universe: 'EVM',
          total_usd: '1.00',
          errored: false,
          currencies: [
            {
              token_address: '0x0000000000000000000000000000000000000001',
              balance: '100',
              symbol: 'USDC',
              decimals: 6,
              value: '1.00',
            },
          ],
        },
        '2': {
          universe: 'BTC',
          total_usd: '2.00',
          errored: false,
          currencies: [],
        },
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getBalances('0x0000000000000000000000000000000000000000', 0);

    expect(result).toHaveLength(1);
    expect(result[0]?.universe).toBe(0);
  });

  it('submitRFF returns response data', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.post.mockResolvedValue({
      data: {
        request_hash: '0xabc',
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const payload = {
      request: {
        sources: [
          {
            universe: 'EVM',
            chain_id: '1',
            contract_address: '0x0000000000000000000000000000000000000000',
            value: '1',
            fee: '0',
          },
        ],
        destination_universe: 'EVM',
        destination_chain_id: '1',
        recipient_address: '0x0000000000000000000000000000000000000000',
        destinations: [
          {
            contract_address: '0x0000000000000000000000000000000000000000',
            value: '1',
          },
        ],
        nonce: '1',
        expiry: '0',
        parties: [
          {
            universe: 'EVM',
            address: '0x0000000000000000000000000000000000000000',
          },
        ],
      },
      signature: '0x0000000000000000000000000000000000000000',
    } satisfies CreateRffPayload;

    const result = await client.submitRFF(payload);

    expect(result.request_hash).toBe('0xabc');
    expect(axiosClient.post).toHaveBeenCalledTimes(1);
  });

  it('getDeployment defaults permit fields when missing', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        network: 'testnet',
        statekeeperUrl: 'https://statekeeper.example',
        fulfillmentBps: 0,
        mayanEnabled: false,
        mayanThresholdUsd: 0,
        mayanCancelRefundMaxPercentage: 0,
        chains: [
          {
            chainId: 11155111,
            universe: 'EVM',
            name: 'Ethereum Sepolia',
            rpcUrl: 'https://sepolia.example',
            vaultAddress: '0x0000000000000000000000000000000000000001',
            multicallAddress: '0x0000000000000000000000000000000000000002',
            nativeCurrency: {
              name: 'Sepolia Ether',
              symbol: 'ETH',
              decimals: 18,
              logo: 'https://example.com/eth.png',
              currencyId: 3,
            },
            sponsored: false,
            explorerUrl: 'https://sepolia.etherscan.io',
            logo: 'https://example.com/chain.png',
            tokens: [
              {
                symbol: 'USDC',
                name: 'USD Coin',
                address: '0x0000000000000000000000000000000000000003',
                decimals: 6,
                balanceSlot: 9,
                logo: 'https://example.com/usdc.png',
                currencyId: 1,
              },
            ],
          },
        ],
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getDeployment();

    expect(result.chains[0]?.tokens[0]?.permitVariant).toBe(1);
    expect(result.chains[0]?.tokens[0]?.permitVersion).toBe(1);
  });

  it('getDeployment rejects nativeCurrency without currencyId', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        network: 'testnet',
        statekeeperUrl: 'https://statekeeper.example',
        fulfillmentBps: 0,
        mayanEnabled: false,
        mayanThresholdUsd: 0,
        mayanCancelRefundMaxPercentage: 0,
        chains: [
          {
            chainId: 11155111,
            universe: 'EVM',
            name: 'Ethereum Sepolia',
            rpcUrl: 'https://sepolia.example',
            vaultAddress: '0x0000000000000000000000000000000000000001',
            multicallAddress: '0x0000000000000000000000000000000000000002',
            nativeCurrency: {
              name: 'Sepolia Ether',
              symbol: 'ETH',
              decimals: 18,
              logo: 'https://example.com/eth.png',
            },
            sponsored: false,
            explorerUrl: 'https://sepolia.etherscan.io',
            logo: 'https://example.com/chain.png',
            tokens: [
              {
                symbol: 'USDC',
                name: 'USD Coin',
                address: '0x0000000000000000000000000000000000000003',
                decimals: 6,
                balanceSlot: 9,
                logo: 'https://example.com/usdc.png',
                currencyId: 1,
              },
            ],
          },
        ],
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');

    await expect(client.getDeployment()).rejects.toThrow(
      /Failed to fetch deployment from middleware/
    );
  });

  it('getDeployment parses currencyId on tokens and nativeCurrency', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        network: 'testnet',
        statekeeperUrl: 'https://statekeeper.example',
        fulfillmentBps: 0,
        mayanEnabled: false,
        mayanThresholdUsd: 0,
        mayanCancelRefundMaxPercentage: 0,
        chains: [
          {
            chainId: 11155111,
            universe: 'EVM',
            name: 'Ethereum Sepolia',
            rpcUrl: 'https://sepolia.example',
            vaultAddress: '0x0000000000000000000000000000000000000001',
            multicallAddress: '0x0000000000000000000000000000000000000002',
            nativeCurrency: {
              name: 'Sepolia Ether',
              symbol: 'ETH',
              decimals: 18,
              logo: 'https://example.com/eth.png',
              currencyId: 3,
            },
            sponsored: false,
            explorerUrl: 'https://sepolia.etherscan.io',
            logo: 'https://example.com/chain.png',
            tokens: [
              {
                symbol: 'USDC',
                name: 'USD Coin',
                address: '0x0000000000000000000000000000000000000003',
                decimals: 6,
                balanceSlot: 9,
                logo: 'https://example.com/usdc.png',
                currencyId: 1,
              },
            ],
          },
        ],
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getDeployment();

    expect(result.chains[0]?.tokens[0]?.currencyId).toBe(1);
    expect(result.chains[0]?.nativeCurrency.currencyId).toBe(3);
  });

  it('getDeployment ignores chains with unsupported universes', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        network: 'testnet',
        statekeeperUrl: 'https://statekeeper.example',
        fulfillmentBps: 0,
        mayanEnabled: false,
        mayanThresholdUsd: 0,
        mayanCancelRefundMaxPercentage: 0,
        chains: [
          {
            chainId: 11155111,
            universe: 'EVM',
            name: 'Ethereum Sepolia',
            rpcUrl: 'https://sepolia.example',
            vaultAddress: '0x0000000000000000000000000000000000000001',
            multicallAddress: '0x0000000000000000000000000000000000000002',
            nativeCurrency: {
              name: 'Sepolia Ether',
              symbol: 'ETH',
              decimals: 18,
              logo: 'https://example.com/eth.png',
              currencyId: 3,
            },
            sponsored: false,
            explorerUrl: 'https://sepolia.etherscan.io',
            logo: 'https://example.com/chain.png',
            tokens: [],
          },
          {
            chainId: 999999,
            universe: 'BTC',
            name: 'Future Chain',
            rpcUrl: 'https://future.example',
            vaultAddress: `0x${'33'.repeat(32)}`,
            multicallAddress: '0x0000000000000000000000000000000000000004',
            nativeCurrency: {
              name: 'Future Coin',
              symbol: 'FTR',
              decimals: 18,
              logo: 'https://example.com/ftr.png',
            },
            sponsored: false,
            explorerUrl: 'https://future.example/explorer',
            logo: 'https://example.com/future.png',
            tokens: [],
          },
        ],
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getDeployment();

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]?.chainId).toBe(11155111);
  });

  it('listRFFs ignores intents with unsupported universes', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        rffs: [
          {
            request_hash: `0x${'11'.repeat(32)}`,
            status: 'created',
            solver: null,
            request: {
              sources: [],
              destination_universe: 'EVM',
              destination_chain_id: '1',
              recipient_address: `0x${'22'.repeat(20)}`,
              destinations: [],
              nonce: '1',
              expiry: '0',
              parties: [],
            },
          },
          {
            request_hash: `0x${'33'.repeat(32)}`,
            status: 'created',
            solver: null,
            request: {
              sources: [],
              destination_universe: 'BTC',
              destination_chain_id: '1',
              recipient_address: `0x${'44'.repeat(20)}`,
              destinations: [],
              nonce: '2',
              expiry: '0',
              parties: [],
            },
          },
        ],
        total: 2,
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.listRFFs();

    expect(result.rffs).toHaveLength(1);
    expect(result.rffs[0]?.request_hash).toBe(`0x${'11'.repeat(32)}`);
    expect(result.total).toBe(2);
  });

  it('getRFFStatus tolerates unsupported universe fields when status is still readable', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        request_hash: `0x${'55'.repeat(32)}`,
        status: 'fulfilled',
        solver: null,
        request: {
          sources: [],
          destination_universe: 'BTC',
          destination_chain_id: '1',
          recipient_address: `0x${'66'.repeat(20)}`,
          destinations: [],
          nonce: '3',
          expiry: '0',
          parties: [],
        },
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getRFFStatus(`0x${'55'.repeat(32)}` as Hex);

    expect(result.status).toBe('fulfilled');
  });

  it('getOraclePrices ignores price entries with unsupported universes', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.get.mockResolvedValue({
      data: {
        priceData: [
          {
            universe: 'EVM',
            chainId: 1,
            tokenAddress: '0x0000000000000000000000000000000000000000',
            tokenSymbol: 'ETH',
            tokenDecimals: 18,
            priceUsd: '1800',
            timestamp: 1710000000,
          },
          {
            universe: 'BTC',
            chainId: 999999,
            tokenAddress: '0x0000000000000000000000000000000000000000',
            tokenSymbol: 'BTC',
            tokenDecimals: 8,
            priceUsd: '90000',
            timestamp: 1710000001,
          },
        ],
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getOraclePrices();

    expect(result).toHaveLength(1);
    expect(result[0]?.universe).toBe('EVM');
  });

  it('rejects unsupported websocket protocol', () => {
    expect(() => createMiddlewareClient('https://mw.example', 'http://mw.example')).toThrow(
      /Invalid middleware WebSocket URL/
    );
  });

  it('submitSBCs posts grouped-by-chain requests to /api/v2/create-sbc-tx and parses results', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    const txHash =
      '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
    const address = '0x0000000000000000000000000000000000000aaa' as Hex;

    const sbcTx = {
      chainId: 42161,
      address,
      nonce: '0x0000000000000000000000000000000000000000000000000000000000000001',
      keyHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      deadline: '0x00000000000000000000000000000000000000000000000000000000000000ff',
      calls: [
        {
          to: '0x0000000000000000000000000000000000000bbb',
          value: '0x0000000000000000000000000000000000000000000000000000000000000001',
          data: '0xabcdef',
        },
      ],
      revertOnFailure: true,
      signature: '0x1234',
    };

    axiosClient.post.mockResolvedValue({
      data: [{ chainId: 42161, address, errored: false, txHash }],
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const results = await client.submitSBCs([sbcTx as any]);

    expect(axiosClient.post).toHaveBeenCalledWith('/api/v2/create-sbc-tx', { 42161: [sbcTx] });
    expect(results).toEqual([{ chainId: 42161, address, errored: false, txHash }]);
  });

  it('submitSBCs parses a per-chain errored result carrying the typed envelope', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);
    const address = '0x0000000000000000000000000000000000000aaa' as Hex;

    axiosClient.post.mockResolvedValue({
      data: [
        {
          chainId: 42161,
          address,
          errored: true,
          message: 'SBC internal call failed: TRANSFER_FROM_FAILED',
          code: 'TRANSACTION_REVERTED',
          subcode: 'TRANSFER_FROM_FAILED',
          errorId: 'err-uuid-9',
          details: { source: 'inner-call' },
        },
      ],
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const results = await client.submitSBCs([{ chainId: 42161, address } as any]);

    expect(results[0]).toMatchObject({
      chainId: 42161,
      errored: true,
      code: 'TRANSACTION_REVERTED',
      subcode: 'TRANSFER_FROM_FAILED',
      errorId: 'err-uuid-9',
    });
  });

  it('getQuote posts to /api/v1/quote and parses response', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    const quoteResponseData = {
      fulfillmentBps: 10,
      sources: [
        {
          chainId: 1,
          tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          depositFeeUsd: '0.50',
          depositFeeToken: '0.500000',
          depositMayanFeeUsd: '0.00',
          depositMayanFeeToken: '0.000000',
        },
      ],
      destination: {
        chainId: 42161,
        tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        fulfillmentFeeUsd: '0.10',
        fulfillmentFeeToken: '0.100000',
      },
    };

    axiosClient.post.mockResolvedValue({ data: quoteResponseData });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getQuote({
      sources: [
        {
          chain_id: '0x1',
          contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
      ],
      destination: {
        chain_id: '0xa4b1',
        contract_address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      },
    });

    expect(result.fulfillmentBps).toBe(10);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.depositFeeToken).toBe('0.500000');
    expect(result.destination.fulfillmentFeeToken).toBe('0.100000');
    expect(axiosClient.post).toHaveBeenCalledWith('/api/v1/quote', {
      sources: [
        {
          chain_id: '0x1',
          contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
      ],
      destination: {
        chain_id: '0xa4b1',
        contract_address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      },
    });
  });

  it('getQuote accepts empty sources array for native-only bridges', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.post.mockResolvedValue({
      data: {
        fulfillmentBps: 10,
        sources: [],
        destination: {
          chainId: 42161,
          tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          fulfillmentFeeUsd: '0.10',
          fulfillmentFeeToken: '0.100000',
        },
      },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    const result = await client.getQuote({
      sources: [],
      destination: {
        chain_id: '0xa4b1',
        contract_address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      },
    });

    expect(result.fulfillmentBps).toBe(10);
    expect(result.sources).toHaveLength(0);
    expect(result.destination.fulfillmentFeeToken).toBe('0.100000');
  });

  it('getQuote throws on invalid response', async () => {
    const axiosClient = makeClient();
    axiosRootMock.create.mockReturnValue(axiosClient);

    axiosClient.post.mockResolvedValue({
      data: { invalid: true },
    });

    const client = createMiddlewareClient('https://mw.example', 'wss://mw.example');
    await expect(
      client.getQuote({
        sources: [],
        destination: {
          chain_id: '0x1',
          contract_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        },
      })
    ).rejects.toThrow(/Failed to get quote from middleware/);
  });
});
