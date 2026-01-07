import { Universe } from '@avail-project/ca-common';
import { describe, expect, it, vi } from 'vitest';
import { MAINNET_CHAIN_IDS } from '../../../commons';
import type { FlatBalance } from './data';
import { sortSourcesByPriority } from './utils';

vi.mock('../constants', () => ({
  getLogoFromSymbol: vi.fn(() => ''),
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  INTENT_EXPIRY: 15 * 60 * 1000,
  isNativeAddress: vi.fn(),
}));

const EADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`;

const createBalance = (
  chainID: number,
  symbol: string,
  tokenAddress: `0x${string}`,
  amount = '1000',
  priceUSD = 1
): FlatBalance => ({
  chainID,
  symbol,
  tokenAddress,
  amount,
  decimals: 18,
  universe: Universe.ETHEREUM,
  value: Number.parseFloat(amount) * priceUSD,
  logo: '',
});

describe('sortSourcesByPriority', () => {
  describe('Non-Ethereum destination (Polygon USDC)', () => {
    const destination = {
      chainID: 137,
      symbol: 'USDC',
      tokenAddress: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' as `0x${string}`,
    };

    it('Priority 1: Same token on destination chain', () => {
      const balances = [
        createBalance(42161, 'USDC', '0xaf88d065e77c8cc2239327c5edb3a432268e5831', '50', 1),
        createBalance(137, 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '100', 1),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(137);
      expect(sorted[0].symbol).toBe('USDC');
    });

    it('Priority 2: USDC/USDT on destination chain', () => {
      const balances = [
        createBalance(42161, 'USDT', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', '50', 1),
        createBalance(137, 'USDT', '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', '100', 1),
        createBalance(137, 'LINK', '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39', '10', 8),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(137);
      expect(sorted[0].symbol).toBe('USDT');
    });

    it('Priority 3: Native gas token on destination chain', () => {
      const balances = [
        createBalance(42161, 'ETH', EADDRESS, '0.05', 3000),
        createBalance(137, 'MATIC', EADDRESS, '100', 1),
        createBalance(137, 'LINK', '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39', '10', 8),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(137);
      expect(sorted[0].symbol).toBe('MATIC');
    });

    it('Priority 4: Any other token on destination chain', () => {
      const balances = [
        createBalance(42161, 'LINK', '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', '5', 10),
        createBalance(137, 'LINK', '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39', '10', 10),
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '8', 10),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(137);
      expect(sorted[0].symbol).toBe('LINK');
    });

    it('Priority 5: Same token on other non-Ethereum chains', () => {
      const balances = [
        createBalance(1, 'USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '50', 1),
        createBalance(42161, 'USDC', '0xaf88d065e77c8cc2239327c5edb3a432268e5831', '100', 1),
        createBalance(10, 'LINK', '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', '8', 10),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(42161);
      expect(sorted[0].symbol).toBe('USDC');
    });

    it('Priority 6: USDC/USDT on other non-Ethereum chains', () => {
      const balances = [
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '500', 1),
        createBalance(10, 'USDT', '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', '100', 1),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(10);
      expect(sorted[0].symbol).toBe('USDT');
    });

    it('Priority 7: Any other token on other non-Ethereum chains (including all other chains)', () => {
      const balances = [
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '800', 1),
        createBalance(42161, 'LINK', '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', '50', 1),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(42161);
      expect(sorted[0].symbol).toBe('LINK');
    });

    it('Priority 8: Same token on Ethereum', () => {
      const balances = [
        createBalance(1, 'USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '100', 1), // Priority 8
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '200', 1), // Priority 9
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('USDC');
    });

    it('Priority 9: USDC/USDT/DAI on Ethereum', () => {
      const balances = [
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '100', 1), // Priority 9
        createBalance(1, 'ETH', EADDRESS, '0.1', 3000), // Priority 10
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('DAI');
    });

    it('Priority 10: ETH on Ethereum', () => {
      const balances = [
        createBalance(1, 'ETH', EADDRESS, '0.1', 3000), // Priority 10
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '8', 10), // Priority 11
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('ETH');
    });

    it('Priority 11: Any other token on Ethereum', () => {
      const balances = [
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '100', 1), // Priority 11
        createBalance(1, 'PEPE', '0x6982508145454ce325ddbe47a25d4ec3d2311933', '50', 1), // Priority 11
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      // Both are Priority 11, so higher value (LINK) wins
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('LINK');
    });
  });

  describe('Ethereum destination (Ethereum USDC)', () => {
    const destination = {
      chainID: MAINNET_CHAIN_IDS.ETHEREUM,
      symbol: 'USDC',
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as `0x${string}`,
    };

    it('Priority 1: Same token on destination chain', () => {
      const balances = [
        createBalance(137, 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '50', 1),
        createBalance(1, 'USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '100', 1),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('USDC');
    });

    it('Priority 5: Same token on other non-Ethereum chains', () => {
      const balances = [
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '50', 1),
        createBalance(137, 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '100', 1),
        createBalance(42161, 'LINK', '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', '80', 1),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(137);
      expect(sorted[0].symbol).toBe('USDC');
    });

    it('Priority 9: USDC/USDT/DAI on Ethereum (same chain, different token)', () => {
      const balances = [
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '100', 1), // Priority 9
        createBalance(1, 'ETH', EADDRESS, '0.1', 3000), // Priority 10
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('DAI');
    });

    it('Priority 10: ETH on Ethereum (same chain, gas token)', () => {
      const balances = [
        createBalance(1, 'ETH', EADDRESS, '0.1', 3000), // Priority 10
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '100', 1), // Priority 11
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('ETH');
    });

    it('Priority 11: Any other token on Ethereum (same chain)', () => {
      const balances = [
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '100', 1), // Priority 11
        createBalance(1, 'PEPE', '0x6982508145454ce325ddbe47a25d4ec3d2311933', '50', 1), // Priority 11
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      // Both are Priority 11, so higher value (LINK) wins
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('LINK');
    });

    it('Priority 7: Non-Ethereum chains are deprioritized', () => {
      const balances = [
        createBalance(56, 'CAKE', '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', '50', 1),
        createBalance(137, 'LINK', '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39', '100', 1),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      // Both get priority 7, so higher value wins
      expect(sorted[0].chainID).toBe(137);
    });
  });

  describe('Full priority ordering', () => {
    it('should order all priorities correctly for non-Ethereum destination', () => {
      const destination = {
        chainID: 137,
        symbol: 'USDC',
        tokenAddress: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' as `0x${string}`,
      };

      const balances = [
        createBalance(1, 'PEPE', '0x6982508145454ce325ddbe47a25d4ec3d2311933', '110', 1), // Priority 11 = $110
        createBalance(1, 'ETH', EADDRESS, '120', 1), // Priority 10 = $120
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '130', 1), // Priority 9 = $130
        createBalance(1, 'USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '140', 1), // Priority 8 = $140
        createBalance(10, 'LINK', '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', '150', 1), // Priority 7 = $150
        createBalance(10, 'USDT', '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', '180', 1), // Priority 6 = $180
        createBalance(42161, 'USDC', '0xaf88d065e77c8cc2239327c5edb3a432268e5831', '150', 1), // Priority 5 = $150
        createBalance(137, 'LINK', '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39', '160', 1), // Priority 4 = $160
        createBalance(137, 'MATIC', EADDRESS, '170', 1), // Priority 3 = $170
        createBalance(137, 'USDT', '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', '180', 1), // Priority 2 = $180
        createBalance(137, 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '190', 1), // Priority 1 = $190
      ];

      const sorted = sortSourcesByPriority(balances, destination);

      expect(sorted[0].symbol).toBe('USDC');
      expect(sorted[0].chainID).toBe(137);
      expect(sorted[1].symbol).toBe('USDT');
      expect(sorted[1].chainID).toBe(137);
      expect(sorted[2].symbol).toBe('MATIC');
      expect(sorted[3].symbol).toBe('LINK');
      expect(sorted[3].chainID).toBe(137);
      expect(sorted[4].symbol).toBe('USDC');
      expect(sorted[4].chainID).toBe(42161);
      expect(sorted[5].symbol).toBe('USDT');
      expect(sorted[5].chainID).toBe(10);
      expect(sorted[6].symbol).toBe('LINK');
      expect(sorted[6].chainID).toBe(10);
      expect(sorted[7].symbol).toBe('USDC');
      expect(sorted[7].chainID).toBe(1);
      expect(sorted[8].symbol).toBe('DAI');
      expect(sorted[9].symbol).toBe('ETH');
      expect(sorted[10].symbol).toBe('PEPE');
    });
  });

  describe('Secondary sort by value', () => {
    it('should sort by value DESC when priority is the same', () => {
      const destination = {
        chainID: 137,
        symbol: 'USDC',
        tokenAddress: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' as `0x${string}`,
      };

      const balances = [
        createBalance(42161, 'USDC', '0xaf88d065e77c8cc2239327c5edb3a432268e5831', '50', 1), // Priority 5, value 50
        createBalance(10, 'USDC', '0x0b2c639c533813f4aa9d7837caf62653d097ff85', '200', 1), // Priority 5, value 200
        createBalance(8453, 'USDC', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '100', 1), // Priority 5, value 100
      ];

      const sorted = sortSourcesByPriority(balances, destination);

      expect(sorted[0].value).toBe(200);
      expect(sorted[1].value).toBe(100);
      expect(sorted[2].value).toBe(50);
    });
  });
});
