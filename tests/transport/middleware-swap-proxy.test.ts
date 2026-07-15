import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('MiddlewareClient swap proxy methods', () => {
  beforeEach(() => {
    axiosRootMock.create.mockReset();
  });

  // -------------------------------------------------------------------------
  // getLiFiQuote
  // -------------------------------------------------------------------------

  describe('getLiFiQuote', () => {
    it('proxies exact-in quote through /api/v1/proxy/lifi/quote', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      const quoteResponse = { estimate: { toAmount: '1000000' } };
      axiosClient.get.mockResolvedValue({ data: quoteResponse });

      const mw = createMiddlewareClient('https://mw.example');
      const params = { fromChain: '1', toChain: '42161', fromToken: '0xaaa', toToken: '0xbbb', fromAmount: '1000000' };
      const result = await mw.getLiFiQuote(params);

      expect(result).toEqual(quoteResponse);
      expect(axiosClient.get).toHaveBeenCalledWith('/api/v1/proxy/lifi/quote', { params });
    });

    it('proxies exact-out quote through /api/v1/proxy/lifi/quote/toAmount', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      const quoteResponse = { estimate: { fromAmount: '2000000' } };
      axiosClient.get.mockResolvedValue({ data: quoteResponse });

      const mw = createMiddlewareClient('https://mw.example');
      const params = { fromChain: '1', toChain: '42161' };
      const result = await mw.getLiFiQuote(params, true);

      expect(result).toEqual(quoteResponse);
      expect(axiosClient.get).toHaveBeenCalledWith('/api/v1/proxy/lifi/quote/toAmount', { params });
    });
  });

  describe('token prices', () => {
    it('normalizes LiFi token price responses', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);
      axiosClient.get.mockResolvedValue({ data: [{ priceUSD: '2500.25' }] });

      const mw = createMiddlewareClient('https://mw.example', 'wss://mw.example');

      await expect(mw.getLiFiTokenPrice(8453, '0xaaa')).resolves.toBe('2500.25');
      expect(axiosClient.get).toHaveBeenCalledWith('/api/v1/proxy/lifi/token', {
        params: { chain: '8453', token: '0xaaa' },
      });
    });

    it('normalizes Relay token price responses', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);
      axiosClient.get.mockResolvedValue({ data: { price: 2500.25 } });

      const mw = createMiddlewareClient('https://mw.example', 'wss://mw.example');

      await expect(mw.getRelayTokenPrice(8453, '0xaaa')).resolves.toBe('2500.25');
      expect(axiosClient.get).toHaveBeenCalledWith(
        '/api/v1/proxy/relay/currencies/token/price',
        { params: { address: '0xaaa', chainId: '8453' } }
      );
    });

    it('returns null for invalid or non-positive provider prices', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);
      axiosClient.get
        .mockResolvedValueOnce({ data: { priceUSD: 'not-a-price' } })
        .mockResolvedValueOnce({ data: { price: 0 } });

      const mw = createMiddlewareClient('https://mw.example', 'wss://mw.example');

      await expect(mw.getLiFiTokenPrice(8453, '0xaaa')).resolves.toBeNull();
      await expect(mw.getRelayTokenPrice(8453, '0xaaa')).resolves.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getBebopQuote
  // -------------------------------------------------------------------------

  describe('getBebopQuote', () => {
    it('proxies quote through /api/v1/proxy/bebop/router/{chain}/v1/quote', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      const quoteResponse = { routes: [{ quote: {} }] };
      axiosClient.get.mockResolvedValue({ data: quoteResponse });

      const mw = createMiddlewareClient('https://mw.example');
      const params = { chain: 'ethereum', sell_tokens: '0xaaa', buy_tokens: '0xbbb' };
      const result = await mw.getBebopQuote(params);

      expect(result).toEqual(quoteResponse);
      // chain is extracted from params and used in the URL path, not sent as query param
      expect(axiosClient.get).toHaveBeenCalledWith(
        '/api/v1/proxy/bebop/router/ethereum/v1/quote',
        { params: { sell_tokens: '0xaaa', buy_tokens: '0xbbb' } },
      );
    });
  });

  describe('Fibrous V2', () => {
    it('gets a route without requesting calldata', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);
      const route = { success: true, outputAmount: '900' };
      axiosClient.get.mockResolvedValue({ data: route });

      const mw = createMiddlewareClient('https://mw.example', 'wss://mw.example') as any;
      const params = {
        chain: 'citrea',
        amount: '1000',
        tokenInAddress: '0xaaa',
        tokenOutAddress: '0xbbb',
      };

      expect(mw).toHaveProperty('getFibrousRoute');
      await expect(mw.getFibrousRoute(params)).resolves.toEqual(route);
      expect(axiosClient.get).toHaveBeenCalledWith('/api/v1/proxy/fibrous/citrea/v2/route', {
        params: {
          amount: '1000',
          tokenInAddress: '0xaaa',
          tokenOutAddress: '0xbbb',
        },
      });
      expect(axiosClient.post).not.toHaveBeenCalled();
    });

    it('gets routeAndCallData for a serious quote', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);
      const quote = { route: { success: true }, calldata: { swap_parameters: [] } };
      axiosClient.get.mockResolvedValue({ data: quote });

      const mw = createMiddlewareClient('https://mw.example', 'wss://mw.example') as any;
      const params = {
        chain: 'citrea',
        amount: '1000',
        slippage: '0.25',
        destination: '0xdestination',
      };

      expect(mw).toHaveProperty('getFibrousQuote');
      await expect(mw.getFibrousQuote(params)).resolves.toEqual(quote);
      expect(axiosClient.get).toHaveBeenCalledWith(
        '/api/v1/proxy/fibrous/citrea/v2/routeAndCallData',
        { params: { amount: '1000', slippage: '0.25', destination: '0xdestination' } }
      );
    });
  });

  // -------------------------------------------------------------------------
  // getSwapBalances
  // -------------------------------------------------------------------------

  describe('getSwapBalances', () => {
    it('returns FlatBalance[] from middleware /api/v1/swap-balance/EVM/:addr', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      axiosClient.get.mockResolvedValue({
        data: {
          '1': {
            universe: 'EVM',
            total_usd: '150.00',
            errored: false,
            currencies: [
              {
                balance: '150000000',
                token_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                name: 'USD Coin',
                symbol: 'USDC',
                decimals: 6,
                value: '150.00',
                logo: 'https://example.com/usdc.png',
              },
            ],
          },
        },
      });

      const mw = createMiddlewareClient('https://mw.example');
      const result = await mw.getSwapBalances('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toEqual([
        {
          amount: '150',
          chainID: 1,
          name: 'USD Coin',
          decimals: 6,
          logo: 'https://example.com/usdc.png',
          symbol: 'USDC',
          tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          value: 150,
        },
      ]);
      expect(axiosClient.get).toHaveBeenCalledWith('/api/v1/swap-balance/EVM/0x1234567890abcdef1234567890abcdef12345678');
    });

    it('coerces an empty USD value to 0 (unpriced long-tail token) instead of NaN', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      axiosClient.get.mockResolvedValue({
        data: {
          '1': {
            universe: 'EVM',
            total_usd: '0',
            errored: false,
            currencies: [
              {
                balance: '150000000',
                token_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                name: 'Long Tail',
                symbol: 'LONGTAIL',
                decimals: 6,
                value: '',
                logo: 'https://example.com/x.png',
              },
            ],
          },
        },
      });

      const mw = createMiddlewareClient('https://mw.example');
      const result = await mw.getSwapBalances('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toHaveLength(1);
      expect(result[0]?.value).toBe(0);
    });

    it('maps native token zero address to EADDRESS', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      axiosClient.get.mockResolvedValue({
        data: {
          '1': {
            universe: 'EVM',
            total_usd: '3000.00',
            errored: false,
            currencies: [
              {
                balance: '1000000000000000000',
                token_address: '0x0000000000000000000000000000000000000000',
                name: 'Ether',
                symbol: 'ETH',
                decimals: 18,
                value: '3000.00',
                logo: 'https://example.com/eth.png',
              },
            ],
          },
        },
      });

      const mw = createMiddlewareClient('https://mw.example');
      const result = await mw.getSwapBalances('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toHaveLength(1);
      expect(result[0]?.logo).toBe('https://example.com/eth.png');
      expect(result[0]?.tokenAddress).toBe('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
    });

    it('skips errored chains', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      axiosClient.get.mockResolvedValue({
        data: {
          '1': {
            universe: 'EVM',
            total_usd: '0',
            errored: true,
            currencies: [],
          },
          '42161': {
            universe: 'EVM',
            total_usd: '50.00',
            errored: false,
            currencies: [
              {
                balance: '50000000',
                token_address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
                name: 'USD Coin',
                symbol: 'USDC',
                decimals: 6,
                value: '50.00',
                logo: 'https://example.com/usdc.png',
              },
            ],
          },
        },
      });

      const mw = createMiddlewareClient('https://mw.example');
      const result = await mw.getSwapBalances('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toHaveLength(1);
      expect(result[0]?.chainID).toBe(42161);
    });

    it('skips zero balances', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      axiosClient.get.mockResolvedValue({
        data: {
          '1': {
            universe: 'EVM',
            total_usd: '0',
            errored: false,
            currencies: [
              {
                balance: '0',
                token_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                name: 'USD Coin',
                symbol: 'USDC',
                decimals: 6,
                value: '0',
                logo: 'https://example.com/usdc.png',
              },
            ],
          },
        },
      });

      const mw = createMiddlewareClient('https://mw.example');
      const result = await mw.getSwapBalances('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toEqual([]);
    });

    it('handles large balances with precision via formatUnits', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      axiosClient.get.mockResolvedValue({
        data: {
          '1': {
            universe: 'EVM',
            total_usd: '999999999999.999999',
            errored: false,
            currencies: [
              {
                balance: '999999999999999999999',
                token_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                name: 'USD Coin',
                symbol: 'USDC',
                decimals: 6,
                value: '999999999999999.999999',
                logo: 'https://example.com/usdc.png',
              },
            ],
          },
        },
      });

      const mw = createMiddlewareClient('https://mw.example');
      const result = await mw.getSwapBalances('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toHaveLength(1);
      // formatUnits(999999999999999999999n, 6) = '999999999999999.999999'
      expect(result[0]?.amount).toBe('999999999999999.999999');
    });

    it('returns empty array on network error', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      axiosClient.get.mockRejectedValue(new Error('Network error'));

      const mw = createMiddlewareClient('https://mw.example');
      const result = await mw.getSwapBalances('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toEqual([]);
    });

    it('defaults missing name and logo at the parsing boundary', async () => {
      const axiosClient = makeClient();
      axiosRootMock.create.mockReturnValue(axiosClient);

      axiosClient.get.mockResolvedValue({
        data: {
          '8453': {
            universe: 'EVM',
            total_usd: '0',
            errored: false,
            currencies: [
              {
                balance: '1000000000000000000',
                token_address: '0xD262A4c7108C8139b2B189758e8D17c3DFC91a38',
                symbol: 'CYPR',
                decimals: 18,
                value: '0',
              },
            ],
          },
        },
      });

      const mw = createMiddlewareClient('https://mw.example');
      const result = await mw.getSwapBalances('0x1234567890abcdef1234567890abcdef12345678');

      expect(result).toEqual([
        expect.objectContaining({
          chainID: 8453,
          symbol: 'CYPR',
          name: '',
          logo: expect.stringMatching(/^data:image\/svg\+xml/),
        }),
      ]);
    });
  });
});
