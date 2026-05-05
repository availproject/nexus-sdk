import { CurrencyID, ERC20ABI, Universe } from '@avail-project/ca-common';
import { decodeFunctionData } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { SWEEP_ABI } from '../abi/sweep';
import { MAINNET_CHAIN_IDS } from '../commons';
import { SWEEPER_ADDRESS } from './constants';
import type { FlatBalance } from './data';
import { createPermitOnlyApprovalTx, createSweeperTxs, sortSourcesByPriority } from './utils';

vi.mock('../core/constants', () => ({
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

describe('createPermitOnlyApprovalTx', () => {
  it('signs an EIP-2612 permit with the explicit chain id and returns a Tx', async () => {
    const publicClient = {
      readContract: vi.fn(async ({ functionName }) => {
        switch (functionName) {
          case 'DOMAIN_SEPARATOR':
            return `0x${'01'.repeat(32)}`;
          case 'name':
            return 'USD Coin';
          case 'nonces':
            return 7n;
          case 'version':
            return '2';
          default:
            throw new Error(`unexpected readContract ${functionName}`);
        }
      }),
    };
    const signerWallet = {
      address: '0x2222222222222222222222222222222222222222',
      signTypedData: vi.fn().mockResolvedValue(`0x${'11'.repeat(32)}${'22'.repeat(32)}1b`),
    };

    const tx = await createPermitOnlyApprovalTx({
      amount: 1_000_000n,
      chainId: 999,
      contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deadline: 123456789n,
      owner: '0x2222222222222222222222222222222222222222',
      publicClient: publicClient as never,
      signerWallet: signerWallet as never,
      spender: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });

    expect(signerWallet.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: expect.objectContaining({
          chainId: 999n,
          name: 'USD Coin',
          verifyingContract: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          version: '2',
        }),
        message: expect.objectContaining({
          deadline: 123456789n,
          owner: '0x2222222222222222222222222222222222222222',
          spender: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          value: 1_000_000n,
        }),
        primaryType: 'Permit',
      })
    );
    expect(tx).toEqual(
      expect.objectContaining({
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        value: 0n,
      })
    );
  });
});

describe('createSweeperTxs', () => {
  // Cache double — only `getAllowance` is exercised by createSweeperTxs.
  const makeCache = (allowance?: bigint) =>
    ({
      getAllowance: () => allowance,
    }) as unknown as Parameters<typeof createSweeperTxs>[0]['cache'];

  const ERC20_TOKEN = '0xb88339cb7199b77e23db6e890353e22632ba630f' as const;
  const RECEIVER = '0x1111111111111111111111111111111111111111' as const;
  const SENDER = '0x2222222222222222222222222222222222222222' as const;

  it('throws when tokenAddress is the EADDRESS native sentinel — native sweeping is no longer supported', () => {
    expect(() =>
      createSweeperTxs({
        cache: makeCache(0n),
        chainID: 999,
        COTCurrencyID: CurrencyID.USDC,
        receiver: RECEIVER,
        sender: SENDER,
        tokenAddress: EADDRESS,
      })
    ).toThrow(/native sweeping is not supported/);
  });

  it('throws when tokenAddress is the zero-address native sentinel', () => {
    expect(() =>
      createSweeperTxs({
        cache: makeCache(0n),
        chainID: 999,
        COTCurrencyID: CurrencyID.USDC,
        receiver: RECEIVER,
        sender: SENDER,
        tokenAddress: '0x0000000000000000000000000000000000000000',
      })
    ).toThrow(/native sweeping is not supported/);
  });

  it('emits [approve(SWEEPER, max), sweepERC20(token, receiver)] when no allowance cached', () => {
    const txs = createSweeperTxs({
      cache: makeCache(0n),
      chainID: 999,
      COTCurrencyID: CurrencyID.USDC,
      receiver: RECEIVER,
      sender: SENDER,
      tokenAddress: ERC20_TOKEN,
    });

    expect(txs).toHaveLength(2);
    // First call: token.approve(SWEEPER, max)
    expect(txs[0].to).toBe(ERC20_TOKEN);
    expect(txs[0].value).toBe(0n);
    const decodedApprove = decodeFunctionData({ abi: ERC20ABI, data: txs[0].data });
    expect(decodedApprove.functionName).toBe('approve');
    expect(decodedApprove.args![0]).toBe(SWEEPER_ADDRESS);
    expect(decodedApprove.args![1]).toBe(2n ** 256n - 1n);
    // Second call: Sweeper.sweepERC20(token, receiver)
    expect(txs[1].to).toBe(SWEEPER_ADDRESS);
    expect(txs[1].value).toBe(0n);
    const decodedSweep = decodeFunctionData({ abi: SWEEP_ABI, data: txs[1].data });
    expect(decodedSweep.functionName).toBe('sweepERC20');
    expect((decodedSweep.args![0] as string).toLowerCase()).toBe(ERC20_TOKEN);
    expect((decodedSweep.args![1] as string).toLowerCase()).toBe(RECEIVER);
  });

  it('skips the approve when allowance is already maxUint256', () => {
    const txs = createSweeperTxs({
      cache: makeCache(2n ** 256n - 1n),
      chainID: 999,
      COTCurrencyID: CurrencyID.USDC,
      receiver: RECEIVER,
      sender: SENDER,
      tokenAddress: ERC20_TOKEN,
    });

    expect(txs).toHaveLength(1);
    expect(txs[0].to).toBe(SWEEPER_ADDRESS);
    const decoded = decodeFunctionData({ abi: SWEEP_ABI, data: txs[0].data });
    expect(decoded.functionName).toBe('sweepERC20');
  });

  it('does NOT emit any approveNative or sweepERC7914 selector regardless of inputs', () => {
    // Calldata for approveNative(address,uint256) is 0x23d57886...
    // Calldata for sweepERC7914(address) is 0x... (Sweeper ABI). Either way, neither selector
    // should ever appear in createSweeperTxs output after this change.
    const txs = createSweeperTxs({
      cache: makeCache(0n),
      chainID: 999,
      COTCurrencyID: CurrencyID.USDC,
      receiver: RECEIVER,
      sender: SENDER,
      tokenAddress: ERC20_TOKEN,
    });

    for (const tx of txs) {
      expect(tx.data.startsWith('0x23d57886')).toBe(false); // approveNative
    }
    // sweepERC7914 is decoded via SWEEP_ABI and would appear as functionName if used.
    const sweepCall = txs.find((tx) => tx.to === SWEEPER_ADDRESS);
    if (sweepCall) {
      const decoded = decodeFunctionData({ abi: SWEEP_ABI, data: sweepCall.data });
      expect(decoded.functionName).not.toBe('sweepERC7914');
    }
  });
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

    it('Priority 1: Same token on destination chain (Ethereum)', () => {
      const balances = [
        createBalance(137, 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '50', 1),
        createBalance(1, 'USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '100', 1),
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('USDC');
    });

    it('Priority 2: Stablecoin on same-chain Ethereum beats cross-chain stablecoin', () => {
      const balances = [
        createBalance(42161, 'USDT', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', '500', 1), // Priority 6
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '100', 1), // Priority 2
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('DAI');
    });

    it('Priority 2: Stablecoin on same-chain Ethereum', () => {
      const balances = [
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '100', 1), // Priority 2
        createBalance(1, 'ETH', EADDRESS, '0.1', 3000), // Priority 3
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('DAI');
    });

    it('Priority 3: Gas token on same-chain Ethereum beats other tokens', () => {
      const balances = [
        createBalance(1, 'ETH', EADDRESS, '0.1', 3000), // Priority 3
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '100', 1), // Priority 4
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('ETH');
    });

    it('Priority 4: Other token on same-chain Ethereum', () => {
      const balances = [
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '100', 1), // Priority 4
        createBalance(1, 'PEPE', '0x6982508145454ce325ddbe47a25d4ec3d2311933', '50', 1), // Priority 4
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      // Both are Priority 4, so higher value (LINK) wins
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('LINK');
    });

    it('Priority 4: Same-chain Ethereum other token beats cross-chain other token', () => {
      const balances = [
        createBalance(42161, 'LINK', '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', '500', 1), // Priority 7
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '100', 1), // Priority 4
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('LINK');
    });

    it('Priority 5: Same token on other non-Ethereum chains', () => {
      const balances = [
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '50', 1), // Priority 2
        createBalance(137, 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '100', 1), // Priority 5
        createBalance(42161, 'LINK', '0xf97f4df75117a78c1a5a0dbb814af92458539fb4', '80', 1), // Priority 7
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].chainID).toBe(1);
      expect(sorted[0].symbol).toBe('DAI');
      expect(sorted[1].chainID).toBe(137);
      expect(sorted[1].symbol).toBe('USDC');
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

  describe('Address normalization', () => {
    it('isGasToken: raw EADDRESS is recognized as gas token (priority 3)', () => {
      const destination = {
        chainID: 137,
        symbol: 'USDC',
        tokenAddress: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' as `0x${string}`,
      };
      const balances = [
        createBalance(137, 'MATIC', EADDRESS, '100', 1), // should be priority 3
        createBalance(137, 'LINK', '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39', '200', 1), // priority 4
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      expect(sorted[0].symbol).toBe('MATIC');
    });

    it('destination ZERO_ADDRESS matches EADDRESS balance (isSameToken)', () => {
      const destination = {
        chainID: 137,
        symbol: 'ETH',
        tokenAddress: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      };
      const balances = [
        createBalance(137, 'ETH', EADDRESS, '1', 3000), // same token via ZERO→EADDRESS normalization
        createBalance(137, 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '5000', 1), // stablecoin, priority 2
      ];
      const sorted = sortSourcesByPriority(balances, destination);
      // ETH on same chain with ZERO_ADDRESS destination should match as same token (priority 1)
      expect(sorted[0].symbol).toBe('ETH');
    });
  });

  describe('Full priority ordering', () => {
    it('should order all priorities correctly for Ethereum destination', () => {
      const destination = {
        chainID: MAINNET_CHAIN_IDS.ETHEREUM,
        symbol: 'USDC',
        tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as `0x${string}`,
      };

      const balances = [
        createBalance(10, 'LINK', '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', '170', 1), // Priority 7 = $170
        createBalance(42161, 'USDT', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', '160', 1), // Priority 6 = $160
        createBalance(137, 'USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '150', 1), // Priority 5 = $150
        createBalance(1, 'LINK', '0x514910771af9ca656af840dff83e8264ecf986ca', '140', 1), // Priority 4 = $140
        createBalance(1, 'ETH', EADDRESS, '0.1', 1300000), // Priority 3 = $130000 (value shouldn't overcome priority)
        createBalance(1, 'DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', '120', 1), // Priority 2 = $120
        createBalance(1, 'USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '110', 1), // Priority 1 = $110
      ];

      const sorted = sortSourcesByPriority(balances, destination);

      expect(sorted[0].symbol).toBe('USDC');
      expect(sorted[0].chainID).toBe(1); // P1
      expect(sorted[1].symbol).toBe('DAI');
      expect(sorted[1].chainID).toBe(1); // P2
      expect(sorted[2].symbol).toBe('ETH');
      expect(sorted[2].chainID).toBe(1); // P3
      expect(sorted[3].symbol).toBe('LINK');
      expect(sorted[3].chainID).toBe(1); // P4
      expect(sorted[4].symbol).toBe('USDC');
      expect(sorted[4].chainID).toBe(137); // P5
      expect(sorted[5].symbol).toBe('USDT');
      expect(sorted[5].chainID).toBe(42161); // P6
      expect(sorted[6].symbol).toBe('LINK');
      expect(sorted[6].chainID).toBe(10); // P7
    });

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
