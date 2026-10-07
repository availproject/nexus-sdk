import { describe, expect, it } from 'vitest';
import {
  normalizeIntentBalances,
  normalizeIntentChains,
  normalizeIntentQuote,
  normalizeIntentTokens,
} from '../../src/intent/normalize';
import { sponsoredQuoteResponse } from '../fixtures/better-intent';

const ACCOUNT = '0x00000000000000000000000000000000000000aa';
const TOKEN = '0x00000000000000000000000000000000000000bb';
const SPENDER = '0x00000000000000000000000000000000000000cc';
const QUOTE_ID = `0x${'11'.repeat(32)}`;
const SIGNATURE_MESSAGE = `0x${'22'.repeat(32)}`;

describe('Better Intent response normalization', () => {
  it('preserves destination refusals in normalized quote source verdicts', () => {
    const sourceVerdict = {
      chainId: 'EVM_8453', tokenAddress: TOKEN, tokenSymbol: 'USDC',
      state: 'unroutable', reason: 'DESTINATION_NOT_SERVED',
    };
    expect(normalizeIntentQuote({
      ...sponsoredQuoteResponse(), sourceVerdicts: [sourceVerdict],
    }).quote.sourceVerdicts).toEqual([{ ...sourceVerdict, chainId: 8453 }]);
  });

  it.each([true, false])('preserves verification status on tokens and balances (%s)', (verified) => {
    const asset = {
      universe: 'EVM', chainId: 'EVM_1', address: TOKEN, name: 'Token', symbol: 'TOKEN',
      decimals: 6, isNative: false, verified, providers: [{ id: 'relay' }],
    };
    expect(normalizeIntentTokens({
      tokens: [{ ...asset, sponsoredApproval: false }], offset: 0, limit: 50, total: 1,
    }).tokens[0]).toMatchObject({ verified });
    expect(normalizeIntentBalances({
      errored: false, balances: [{
        ...asset, balance: '42', valueUsd: null, priceSource: null, usable: false,
      }],
    }).balances[0]).toMatchObject({ verified, balanceRaw: 42n });
  });

  it.each([undefined, 'true', null])('rejects missing or invalid verification status (%s)', (verified) => {
    const asset = {
      universe: 'EVM', chainId: 'EVM_1', address: TOKEN, name: 'Token', symbol: 'TOKEN',
      decimals: 6, isNative: false, verified, providers: [{ id: 'relay' }],
    };
    expect(() => normalizeIntentTokens({
      tokens: [{ ...asset, sponsoredApproval: false }], offset: 0, limit: 50, total: 1,
    })).toThrow(/tokens response/i);
    expect(() => normalizeIntentBalances({
      errored: false, balances: [{
        ...asset, balance: '42', valueUsd: null, priceSource: null, usable: false,
      }],
    })).toThrow(/balances response/i);
  });

  it('preserves executability and normalizes balance warnings without losing precision', () => {
    const response = {
      ...sponsoredQuoteResponse(),
      isExecutable: false,
      executionWarnings: [{
        code: 'INSUFFICIENT_BALANCE', message: 'Insufficient source balance',
        shortfalls: [{
          chainId: 8453, address: TOKEN.toUpperCase().replace('0X', '0x'),
          required: '9007199254740993', actual: '1',
        }],
      }],
    };
    expect(normalizeIntentQuote(response).quote).toMatchObject({
      isExecutable: false,
      executionWarnings: [{
        code: 'INSUFFICIENT_BALANCE', message: 'Insufficient source balance',
        shortfalls: [{ chainId: 8453, tokenAddress: TOKEN, requiredRaw: 9007199254740993n, actualRaw: 1n }],
      }],
    });
  });

  it.each([undefined, 'false'])('rejects an invalid executable flag (%s)', (isExecutable) => {
    expect(() => normalizeIntentQuote({
      ...sponsoredQuoteResponse(), isExecutable, executionWarnings: [],
    })).toThrow(/quote response/i);
  });

  it('normalizes the chain catalog at the transport boundary', () => {
    const response = [
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
        asSource: ['nexus-v2', 'mayan', 'relay'],
        asDestination: ['nexus-v2', 'relay'],
        tokens: [
          {
            address: TOKEN.toUpperCase().replace('0X', '0x'),
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            isNative: false,
            verified: true,
            asSource: [{ id: 'nexus-v2', currencyId: 1 }, { id: 'mayan' }, { id: 'relay' }],
            asDestination: [{ id: 'nexus-v2', currencyId: 1 }, { id: 'relay' }],
          },
        ],
      },
    ];
    const result = normalizeIntentChains(response.map(({ tokens: _tokens, ...chain }) => chain));
    const page = normalizeIntentTokens({
      tokens: response[0]!.tokens.map((token) => ({
        ...token, universe: 'EVM', chainId: 'EVM_8453', sponsoredApproval: false,
      })),
      offset: 0, limit: 1000, total: 1,
    });

    expect(result[0]).toMatchObject({ id: 8453, name: 'Base' });
    expect(result[0]).toMatchObject({
      providers: ['nexus-v2', 'mayan', 'relay'],
      asSource: ['nexus-v2', 'mayan', 'relay'],
      asDestination: ['nexus-v2', 'relay'],
    });
    expect(result[0]).not.toHaveProperty('tokens');
    expect(page.tokens[0]).toMatchObject({
      chainId: 8453,
      address: TOKEN,
      symbol: 'USDC',
      providers: [{ id: 'nexus-v2', currencyId: 1 }, { id: 'mayan' }, { id: 'relay' }],
    });
  });

  it.each(['relay', 'coingecko'] as const)('accepts %s balance pricing', (priceSource) => {
    expect(normalizeIntentBalances({
      errored: false, balances: [{
        universe: 'EVM', chainId: 'EVM_1', address: TOKEN,
        name: 'USD Coin', symbol: 'USDC', decimals: 6, isNative: false, verified: true,
        providers: [{ id: 'relay', currencyId: 'usdc' }], balance: '10',
        valueUsd: 0.00001, priceSource, usable: true,
      }],
    }).balances[0]).toMatchObject({ priceSource, balanceRaw: 10n });
  });

  it('normalizes sponsored signatures without legacy quote fields', () => {
    const result = normalizeIntentQuote(sponsoredQuoteResponse());
    expect(result.quote.fees).not.toHaveProperty('caGasRaw');
    expect(result.quote.input[0]).toMatchObject({
      amountUsd: '0.00001',
      depositFeeUsd: '0',
      totalRequiredUsd: '0.00001',
    });
    expect(result.quote.output).toMatchObject({
      amountUsd: '0.000009',
      minAmountUsd: '0.000008',
    });
    expect(result.quote.fees).toMatchObject({
      depositUsd: '0',
      fulfillmentUsd: '0',
      protocolUsd: '0',
      solverUsd: '0',
    });
    expect(result.execution.requiredSignatures).toEqual(
      sponsoredQuoteResponse().submitRequirements.requiredSignatures
    );
    expect(result.quote.plan.steps.map(({ type }) => type)).toEqual([
      'source_approval_signature', 'intent_signature', 'intent_submission', 'intent_fulfillment',
    ]);
    expect(result.quote).not.toHaveProperty('requiredSignatures');
    expect(result.quote.allowances[0]).toMatchObject({ authorizationType: 'permit' });
  });

  it.each(['missing intent', 'duplicate intent', 'missing permit', 'wrong token', 'wrong chain'])(
    'rejects inconsistent signing instructions: %s', (scenario) => {
      const response = sponsoredQuoteResponse();
      const signatures = response.submitRequirements.requiredSignatures;
      if (scenario === 'missing intent') signatures.shift();
      if (scenario === 'duplicate intent') signatures.push(signatures[0]!);
      if (scenario === 'missing permit') signatures.pop();
      const approval = signatures.find((entry) => entry.kind === 'sourceApproval');
      if (approval && scenario === 'wrong token') approval.data.domain.verifyingContract = SPENDER;
      if (approval && scenario === 'wrong chain') approval.data.domain.chainId = 1;
      expect(() => normalizeIntentQuote(response)).toThrow(/signature|signing/i);
    }
  );

  it('normalizes raw balances', () => {
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
          verified: true,
          providers: [{ id: 'nexus-v2', currencyId: 1 }],
          balance: '1234567',
          valueUsd: 1.23,
          priceSource: 'oracle',
          usable: true,
        },
      ],
    });

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
      isExecutable: true,
      executionWarnings: [],
      input: [
        {
          chainId: 'EVM_8453',
          tokenAddress: TOKEN,
          tokenSymbol: 'USDC',
          amount: '1000000',
          amountUsd: '1',
          depositFee: '1000',
          depositFeeUsd: '0.001',
          totalRequired: '1001000',
          totalRequiredUsd: '1.001',
        },
      ],
      output: { chainId: 'EVM_1', tokenAddress: TOKEN, amount: '990000', amountUsd: '0.99' },
      minAmountOut: '985000',
      minAmountOutUsd: '0.985',
      fees: {
        deposit: '1000',
        depositUsd: '0.001',
        fulfillment: '2000',
        fulfillmentUsd: '0.002',
        protocol: '3000',
        protocolUsd: '0.003',
        solver: '4000',
        solverUsd: '0.004',
      },
      expiry: '2000000000',
      rff: { sources: [], destinations: [], parties: [] },
      rffHash: QUOTE_ID,
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
          needsIntentSignature: true,
          abi: [],
          vaultRequest: {},
          argsTemplate: {
            request: 'nativeTransactions[n].vaultRequest',
            signature: 'signatures[kind=intent].signature',
            sourceIndex: 0,
          },
          usage: 'source deposit',
        },
      ],
      submitRequirements: {
        requiredSignatures: [{
          kind: 'intent', universe: 'EVM', signingScheme: 'personal_sign',
          data: { messagePrefix: 'Sign this intent to proceed', message: SIGNATURE_MESSAGE, hash: QUOTE_ID },
        }],
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
    expect(result.execution.requiredSignatures[0]).toMatchObject({ data: { message: SIGNATURE_MESSAGE } });
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
