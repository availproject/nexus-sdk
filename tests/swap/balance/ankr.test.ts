import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnkrClient, ANKR_CHAIN_MAP } from '../../../src/swap/balance/ankr';

vi.mock('axios');

const makeAnkrAsset = (
  blockchain: string,
  tokenAddress: string,
  symbol: string,
  balance: string,
  balanceUsd: string,
  decimals: number,
) => ({
  blockchain,
  contractAddress: tokenAddress === '' ? undefined : tokenAddress,
  tokenType: tokenAddress === '' ? 'NATIVE' : 'ERC20',
  tokenSymbol: symbol,
  tokenDecimals: decimals,
  balance,
  balanceUsd,
});

const makeAnkrResponse = (assets: ReturnType<typeof makeAnkrAsset>[]) => ({
  data: {
    result: {
      assets,
    },
  },
});

describe('AnkrClient', () => {
  let client: AnkrClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new AnkrClient();
  });

  it('maps Ankr response to FlatBalance array', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce(
      makeAnkrResponse([
        makeAnkrAsset('arbitrum', '0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'USDC', '10.5', '10.50', 6),
      ]),
    );

    const balances = await client.getBalances('0xUser' as `0x${string}`);

    expect(balances).toHaveLength(1);
    expect(balances[0].chainID).toBe(42161);
    expect(balances[0].symbol).toBe('USDC');
    expect(balances[0].amount).toBe('10.5');
    expect(balances[0].name).toBe('');
    expect(balances[0].logo).toMatch(/^data:image\/svg\+xml/);
    expect(balances[0].value).toBe(10.5);
    expect(balances[0].tokenAddress).toBe('0xaf88d065e77c8cc2239327c5edb3a432268e5831');
  });

  it('maps native token to EADDRESS', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce(
      makeAnkrResponse([makeAnkrAsset('eth', '', 'ETH', '1.5', '3000', 18)]),
    );

    const balances = await client.getBalances('0xUser' as `0x${string}`);

    expect(balances).toHaveLength(1);
    expect(balances[0].tokenAddress.toLowerCase()).toBe(
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    );
    expect(balances[0].chainID).toBe(1);
  });

  it('chain name mapping covers known chains', () => {
    // Verify key chain mappings
    expect(ANKR_CHAIN_MAP.eth).toBe(1);
    expect(ANKR_CHAIN_MAP.arbitrum).toBe(42161);
    expect(ANKR_CHAIN_MAP.optimism).toBe(10);
    expect(ANKR_CHAIN_MAP.base).toBe(8453);
    expect(ANKR_CHAIN_MAP.polygon).toBe(137);
    expect(ANKR_CHAIN_MAP.bsc).toBe(56);
    expect(ANKR_CHAIN_MAP.avalanche).toBe(43114);
    expect(ANKR_CHAIN_MAP.scroll).toBe(534352);
  });

  it('returns empty array on API failure', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('network failure'));

    const balances = await client.getBalances('0xUser' as `0x${string}`);

    expect(balances).toHaveLength(0);
  });

  it('filters out zero-balance tokens', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce(
      makeAnkrResponse([
        makeAnkrAsset('arbitrum', '0xtoken1', 'TK1', '0', '0', 18),
        makeAnkrAsset('arbitrum', '0xtoken2', 'TK2', '5.0', '10.0', 18),
      ]),
    );

    const balances = await client.getBalances('0xUser' as `0x${string}`);

    expect(balances).toHaveLength(1);
    expect(balances[0].symbol).toBe('TK2');
  });

  it('skips assets with unknown blockchain name', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce(
      makeAnkrResponse([
        makeAnkrAsset('unknown_chain', '0xtoken', 'TK', '10', '20', 18),
        makeAnkrAsset('arbitrum', '0xtoken2', 'TK2', '5.0', '10.0', 18),
      ]),
    );

    const balances = await client.getBalances('0xUser' as `0x${string}`);

    expect(balances).toHaveLength(1);
    expect(balances[0].chainID).toBe(42161);
  });
});
