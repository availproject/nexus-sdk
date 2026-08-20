import { describe, expect, it } from 'vitest';
import {
  normalizeIntentBalances,
  normalizeIntentChains,
  normalizeIntentQuote,
  normalizeIntentTokens,
} from '../../src/intent/normalize';

const ACCOUNT = '0x00000000000000000000000000000000000000aa';
const TOKEN = '0x00000000000000000000000000000000000000bb';
const SPENDER = '0x00000000000000000000000000000000000000cc';
const QUOTE_ID = `0x${'11'.repeat(32)}`;
const SIGNATURE_MESSAGE = `0x${'22'.repeat(32)}`;

describe('Better Intent response normalization', () => {
  it('normalizes the chain catalog at the transport boundary', () => {
    const result = normalizeIntentChains([
      {
        chainId: 'EVM_8453',
        name: 'Base',
        logo: 'base.svg',
        explorerUrl: 'https://basescan.org',
        rpcUrl: 'https://base.example',
        nativeCurrency: {
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18,
          logo: 'eth.svg',
        },
        asSource: ['nexus-v2', 'mayan'],
        asDestination: ['nexus-v2'],
        tokens: [
          {
            address: TOKEN.toUpperCase().replace('0X', '0x'),
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            isNative: false,
            asSource: [{ id: 'nexus-v2', currencyId: 1 }, { id: 'mayan' }],
            asDestination: [{ id: 'nexus-v2', currencyId: 1 }],
          },
        ],
      },
    ]);

    expect(result[0]).toMatchObject({ id: 8453, name: 'Base' });
    expect(result[0]).toMatchObject({
      providers: ['nexus-v2', 'mayan'],
      asSource: ['nexus-v2', 'mayan'],
      asDestination: ['nexus-v2'],
    });
    expect(result[0]?.tokens[0]).toMatchObject({
      chainId: 8453,
      address: TOKEN,
      symbol: 'USDC',
    });
  });

  it('normalizes asset deployments and raw balances', () => {
    const tokens = normalizeIntentTokens([
      {
        assetId: 'usd-coin',
        symbol: 'USDC',
        name: 'USD Coin',
        coingeckoId: 'usd-coin',
        chains: [
          {
            universe: 'EVM',
            chainId: 'EVM_8453',
            address: TOKEN,
            name: 'USD Coin',
            decimals: 6,
            isNative: false,
            providers: [{ id: 'nexus-v2', currencyId: 1 }],
          },
        ],
      },
    ]);
    const balances = normalizeIntentBalances({
      errored: false,
      balances: [
        {
          universe: 'EVM',
          chainId: 'EVM_8453',
          address: TOKEN,
          name: 'USD Coin',
          symbol: 'USDC',
          decimals: 6,
          isNative: false,
          providers: [{ id: 'nexus-v2', currencyId: 1 }],
          balance: '1234567',
          valueUsd: 1.23,
          priceSource: 'oracle',
          usable: true,
        },
      ],
    });

    expect(tokens[0]?.chains[0]).toMatchObject({ chainId: 8453, address: TOKEN });
    expect(balances).toEqual({
      errored: false,
      balances: [
        expect.objectContaining({
          chainId: 8453,
          tokenAddress: TOKEN,
          balanceRaw: 1_234_567n,
        }),
      ],
    });
  });

  it('keeps signing, RFF, and ABI details outside the public quote', () => {
    const result = normalizeIntentQuote({
      quoteId: QUOTE_ID,
      provider: 'nexus-v2',
      tradeType: 'exactOutput',
      input: [
        {
          chainId: 'EVM_8453',
          tokenAddress: TOKEN,
          tokenSymbol: 'USDC',
          amount: '1000000',
          depositFee: '1000',
          totalRequired: '1001000',
        },
      ],
      output: { chainId: 'EVM_1', tokenAddress: TOKEN, amount: '990000' },
      minAmountOut: '985000',
      fees: {
        deposit: '1000',
        fulfillment: '2000',
        protocol: '3000',
        solver: '4000',
        caGas: '5000',
      },
      expiry: '2000000000',
      rff: { sources: [], destinations: [], parties: [] },
      rffHash: QUOTE_ID,
      signing: {
        type: 'personal_sign',
        messagePrefix: 'Sign this intent to proceed',
        message: SIGNATURE_MESSAGE,
        hash: QUOTE_ID,
      },
      allowances: [
        {
          chainId: 8453,
          tokenAddress: TOKEN,
          spender: SPENDER,
          owner: ACCOUNT,
          current: '0',
          required: '1001000',
          deficit: '1001000',
          approval: { type: 'erc20_approve', to: TOKEN, data: '0x1234', value: '0' },
        },
      ],
      nativeTransactions: [
        {
          chainId: 10,
          sourceIndex: 0,
          kind: 'native_source_deposit',
          to: SPENDER,
          value: '42',
          functionName: 'deposit',
          needsRffSignature: true,
          abi: [],
          vaultRequest: {},
          argsTemplate: {
            request: 'nativeTransactions[n].vaultRequest',
            signature: 'rffSignature',
            sourceIndex: 0,
          },
          usage: 'source deposit',
        },
      ],
      submitRequirements: {
        requiresIntentSignature: true,
        requiresApprovals: true,
        requiresNativeTxReceipts: true,
      },
      sourceVerdicts: [
        {
          chainId: 'EVM_8453',
          tokenAddress: TOKEN,
          tokenSymbol: 'USDC',
          state: 'selected',
        },
      ],
    });

    expect(result.quote).toMatchObject({
      id: QUOTE_ID,
      provider: 'nexus-v2',
      input: [{ amountRaw: 1_000_000n, totalRequiredRaw: 1_001_000n }],
      output: { chainId: 1, amountRaw: 990_000n, minAmountRaw: 985_000n },
      sourceVerdicts: [{ chainId: 8453, tokenAddress: TOKEN, state: 'selected' }],
      expiresAt: 2_000_000_000,
    });
    expect(result.quote).not.toHaveProperty('rff');
    expect(result.quote).not.toHaveProperty('signing');
    expect(result.execution.signing.message).toBe(SIGNATURE_MESSAGE);
    expect(result.execution.nativeTransactions[0]?.abi).toEqual([]);
  });

  it('rejects malformed chain references', () => {
    expect(() =>
      normalizeIntentChains([
        {
          chainId: '8453',
          name: 'Base',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          providers: ['nexus-v2'],
          tokens: [],
        },
      ])
    ).toThrow(/Better Intent chains response/);
  });
});
