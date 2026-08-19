import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { createSwapPlan } from '../../src/swap/swap-steps-builder';
import { EADDRESS } from '../../src/swap/constants';
import type { BridgeAsset, DestinationSwap, SwapRoute } from '../../src/swap/types';
import { SwapMode } from '../../src/swap/types';
import { CurrencyID } from '../../src/swap/cot';
import { PermitVariant } from '../../src/domain/permits';
import type { Aggregator, Holding, Quote } from '../../src/swap/aggregators/types';
import { makeChain, makeChainList } from '../helpers/chains';
import { quoteFixture } from '../helpers/quote';

const token = {
  contractAddress: '0x0000000000000000000000000000000000000001' as const,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
};

const chainA = makeChain(42161, 'Arbitrum');
const chainB = makeChain(10, 'Optimism');
const chainDst = makeChain(8453, 'Base');
const chainList = makeChainList([chainA, chainB, chainDst], token);

const noSwap: DestinationSwap = { tokenSwap: null, gasSwap: null };
const withTokenSwap: DestinationSwap = {
  tokenSwap: {
    chainID: 8453,
    quote: quoteFixture({
      input: {
        contractAddress: token.contractAddress,
        amount: '100',
        amountRaw: 100000000n,
        decimals: 6,
        value: 100,
        symbol: 'USDC',
      },
      output: {
        contractAddress: '0x00000000000000000000000000000000000000ee' as Hex,
        amount: '0.05',
        amountRaw: 50000000000000000n,
        decimals: 18,
        value: 100,
        symbol: 'ETH',
      },
      txData: {
        approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
        tx: {
          to: '0x2222222222222222222222222222222222222222' as Hex,
          data: '0x1234' as Hex,
          value: '0x0' as Hex,
        },
      },
    }),
    holding: {} as Holding,
    aggregator: {} as Aggregator,
  },
  gasSwap: null,
};

const makeRoute = (overrides: Partial<SwapRoute> = {}): SwapRoute => ({
  type: SwapMode.EXACT_OUT,
  settlementCurrencyId: CurrencyID.USDC,
  sameTokenBridge: false,
  source: { swaps: [], creationTime: Date.now(), srcBuffer: new Decimal(0) },
  bridge: null,
  destination: {
    chainId: 8453,
    eoaToEphemeral: null,
    inputAmount: { min: new Decimal(0), max: new Decimal(0) },
    swap: noSwap,
    getDstSwap: async () => null,
  },
  buffer: { amount: '0' },
  dstTokenInfo: token,
  extras: { aggregators: [], oraclePrices: [], balances: [], assetsUsed: [] },
  sourceExecutionPaths: new Map(),
  ...overrides,
});

const makeQuoteResponse = (
  chainID: number,
  inputAddress: Hex = '0x00000000000000000000000000000000000000aa'
) => ({
  chainID,
  quote: quoteFixture({
    input: {
      contractAddress: inputAddress,
      amount: '50000',
      amountRaw: 50000000000n,
      decimals: 6,
      value: 50,
      symbol: 'PEPE',
    },
    output: {
      contractAddress: token.contractAddress,
      amount: '1.1',
      amountRaw: 1100000n,
      decimals: 6,
      value: 1.1,
      symbol: 'USDC',
    },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: {
        to: '0x2222222222222222222222222222222222222222' as Hex,
        data: '0x1234' as Hex,
        value: '0x0' as Hex,
      },
    },
  }),
  holding: {
    chainID,
    tokenAddress: '0x01' as Hex,
    amountRaw: 100n,
    decimals: 6,
    symbol: 'PEPE',
  },
  aggregator: {} as Aggregator,
});

const makeBridgeAsset = (chainID: number, eoaBalance: number): BridgeAsset => ({
  chainID,
  contractAddress: token.contractAddress,
  decimals: 6,
  eoaBalance: new Decimal(eoaBalance),
  ephemeralBalance: new Decimal(10),
});

const makeBridge = (
  assets: BridgeAsset[],
  overrides: Partial<NonNullable<SwapRoute['bridge']>> = {}
): NonNullable<SwapRoute['bridge']> => ({
  provider: 'nexus',
  amount: new Decimal(5),
  amounts: {
    tokenAmount: new Decimal(5),
    gasInCot: new Decimal(0),
    totalAmount: new Decimal(5),
  },
  assets,
  chainID: 8453,
  decimals: 6,
  tokenAddress: token.contractAddress,
  estimatedFees: {
    collection: new Decimal(0),
    fulfilment: new Decimal(0),
    caGas: new Decimal(0),
    protocol: new Decimal(0),
    solver: new Decimal(0),
  },
  ...overrides,
});

const makeAuthorization = (permitVariant: PermitVariant) => ({
  cache: {
    getAllowance: () => 0n,
    getPermit: () => ({
      permitVariant,
      permitContractVersion: permitVariant === PermitVariant.Unsupported ? 0 : 1,
    }),
  },
  eoaAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
  safeAddress: '0xbbbb000000000000000000000000000000000002' as Hex,
});

describe('createSwapPlan', () => {
  it('returns source-only steps without synthetic lifecycle markers', () => {
    const route = makeRoute({
      source: { swaps: [makeQuoteResponse(42161)], creationTime: Date.now(), srcBuffer: new Decimal(0) },
      sourceExecutionPaths: new Map([[42161, 'safe']]),
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.hasBridge).toBe(false);
    expect(plan.hasDestinationSwap).toBe(false);
    expect(plan.steps).toEqual([
      expect.objectContaining({
        type: 'source_swap',
        id: 'source_swap:42161',
        chain: expect.objectContaining({ id: 42161, name: 'Arbitrum' }),
        walletPath: 'safe',
        submissionMode: 'sponsored',
        swaps: [
          expect.objectContaining({
            input: expect.objectContaining({
              amount: '50000',
              amountRaw: 50000000000n,
              contractAddress: '0x00000000000000000000000000000000000000aa',
            }),
            output: expect.objectContaining({
              symbol: 'USDC',
              amount: '1.1',
              amountRaw: 1100000n,
            }),
          }),
        ],
      }),
    ]);
  });

  it('uses the execution order and marks native-value batches as EOA-submitted', () => {
    const erc20 = makeQuoteResponse(42161, token.contractAddress);
    const native = makeQuoteResponse(42161, EADDRESS);
    const route = makeRoute({
      source: {
        swaps: [erc20, makeQuoteResponse(10, token.contractAddress), native],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
      },
      sourceExecutionPaths: new Map([
        [42161, 'safe'],
        [10, 'safe'],
      ]),
    });

    const plan = createSwapPlan(route, chainList);
    const sourceSteps = plan.steps.filter((step) => step.type === 'source_swap');

    expect(sourceSteps.map((step) => step.chain.id)).toEqual([10, 42161]);
    expect(sourceSteps[0]).toMatchObject({ submissionMode: 'sponsored' });
    expect(sourceSteps[1]).toMatchObject({
      submissionMode: 'eoa',
      swaps: [
        { input: { contractAddress: EADDRESS } },
        { input: { contractAddress: token.contractAddress } },
      ],
    });
  });

  it('precedes source swaps with one allowance step per required EOA authorization', () => {
    const route = makeRoute({
      source: {
        swaps: [
          makeQuoteResponse(42161, token.contractAddress),
          makeQuoteResponse(10, token.contractAddress),
        ],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
      },
      sourceExecutionPaths: new Map([
        [42161, 'safe'],
        [10, 'safe'],
      ]),
    });
    const plan = createSwapPlan(route, chainList, {
      cache: {
        getAllowance: () => 0n,
        getPermit: (_tokenAddress: Hex, chainId: number) => ({
          permitVariant:
            chainId === 10 ? PermitVariant.EIP2612Canonical : PermitVariant.Unsupported,
          permitContractVersion: chainId === 10 ? 1 : 0,
        }),
      },
      eoaAddress: '0xaaaa000000000000000000000000000000000001',
      safeAddress: '0xbbbb000000000000000000000000000000000002',
    });

    expect(plan.steps.map((step) => [step.type, 'method' in step ? step.method : null])).toEqual([
      ['allowance', 'permit'],
      ['source_swap', null],
      ['allowance', 'approval'],
      ['source_swap', null],
    ]);
    expect(plan.steps[0]).toMatchObject({
      chain: { id: 10 },
      token: { contractAddress: token.contractAddress },
      spender: '0xbbbb000000000000000000000000000000000002',
      amount: { amountRaw: 50000000000n },
    });
  });

  it('builds source allowance metadata for tokens outside the static chain list', () => {
    const inputAddress = '0x00000000000000000000000000000000000000dd' as Hex;
    const route = makeRoute({
      source: {
        swaps: [makeQuoteResponse(42161, inputAddress)],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
      },
      sourceExecutionPaths: new Map([[42161, 'safe']]),
    });
    const strictChainList = {
      ...chainList,
      getTokenByAddress: (chainId: number, address: Hex) => {
        if (address.toLowerCase() === inputAddress.toLowerCase()) {
          throw new Error(`Token ${address} is not in the static list`);
        }
        return chainList.getTokenByAddress(chainId, address);
      },
    };

    const plan = createSwapPlan(
      route,
      strictChainList,
      makeAuthorization(PermitVariant.Unsupported)
    );

    expect(plan.steps[0]).toMatchObject({
      type: 'allowance',
      token: {
        contractAddress: inputAddress,
        decimals: 6,
        symbol: 'PEPE',
      },
    });
  });

  it('omits allowance steps when the existing EOA allowance covers the transfer', () => {
    const route = makeRoute({
      source: {
        swaps: [makeQuoteResponse(10, token.contractAddress)],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
      },
      sourceExecutionPaths: new Map([[10, 'safe']]),
    });

    const plan = createSwapPlan(route, chainList, {
      cache: {
        getAllowance: () => 50000000000n,
        getPermit: () => ({
          permitVariant: PermitVariant.Unsupported,
          permitContractVersion: 0,
        }),
      },
      eoaAddress: '0xaaaa000000000000000000000000000000000001',
      safeAddress: '0xbbbb000000000000000000000000000000000002',
    });

    expect(plan.steps.map((step) => step.type)).toEqual(['source_swap']);
  });

  it('places destination funding allowance before the destination swap', () => {
    const route = makeRoute({
      destination: {
        chainId: 8453,
        eoaToEphemeral: { contractAddress: token.contractAddress, amount: 100000000n },
        inputAmount: { min: new Decimal(100), max: new Decimal(100) },
        swap: withTokenSwap,
        getDstSwap: async () => null,
      },
    });

    const plan = createSwapPlan(route, chainList, {
      cache: {
        getAllowance: () => 0n,
        getPermit: () => ({
          permitVariant: PermitVariant.EIP2612Canonical,
          permitContractVersion: 1,
        }),
      },
      eoaAddress: '0xaaaa000000000000000000000000000000000001',
      safeAddress: '0xbbbb000000000000000000000000000000000002',
    });

    expect(plan.steps.map((step) => step.type)).toEqual(['allowance', 'destination_swap']);
    expect(plan.steps[0]).toMatchObject({
      method: 'permit',
      chain: { id: 8453 },
      amount: { amountRaw: 100000000n },
    });
  });

  it('builds bridge and destination steps with deterministic ids', () => {
    const route = makeRoute({
      source: {
        swaps: [makeQuoteResponse(42161), makeQuoteResponse(10)],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
        cotByChain: new Map([
          [42161, { contractAddress: token.contractAddress, decimals: 6, currencyId: 1 }],
          [10, { contractAddress: token.contractAddress, decimals: 6, currencyId: 1 }],
        ]),
      },
      bridge: {
        provider: 'nexus',
        amount: new Decimal('2.2'),
        amounts: {
          tokenAmount: new Decimal('2.2'),
          gasInCot: new Decimal(0),
          totalAmount: new Decimal('2.2'),
        },
        assets: [makeBridgeAsset(42161, 5), makeBridgeAsset(10, 0)],
        chainID: 8453,
        decimals: 6,
        tokenAddress: token.contractAddress,
        estimatedFees: {
          collection: new Decimal(0),
          fulfilment: new Decimal(0),
          caGas: new Decimal(0),
          protocol: new Decimal(0),
          solver: new Decimal(0),
        },
      },
      destination: {
        chainId: 8453,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: withTokenSwap,
        getDstSwap: async () => null,
      },
      sourceExecutionPaths: new Map([
        [42161, 'safe'],
        [10, 'safe'],
      ]),
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.hasBridge).toBe(true);
    expect(plan.hasDestinationSwap).toBe(true);
    expect(plan.steps.map((step) => step.id)).toEqual([
      'source_swap:10',
      'source_swap:42161',
      'bridge_intent_submission',
      'bridge_deposit:10',
      'eoa_to_ephemeral_transfer:42161',
      'bridge_deposit:42161',
      'bridge_fill:8453',
      'destination_swap:8453',
    ]);
  });

  it('includes eoa_to_ephemeral_transfer only for bridge assets with eoa balance', () => {
    const route = makeRoute({
      source: {
        swaps: [makeQuoteResponse(42161)],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
      },
      bridge: {
        provider: 'nexus',
        amount: new Decimal(50),
        amounts: {
          tokenAmount: new Decimal(50),
          gasInCot: new Decimal(0),
          totalAmount: new Decimal(50),
        },
        assets: [makeBridgeAsset(42161, 5), makeBridgeAsset(10, 0)],
        chainID: 8453,
        decimals: 6,
        tokenAddress: token.contractAddress,
        estimatedFees: {
          collection: new Decimal(0),
          fulfilment: new Decimal(0),
          caGas: new Decimal(0),
          protocol: new Decimal(0),
          solver: new Decimal(0),
        },
      },
      destination: {
        chainId: 8453,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: withTokenSwap,
        getDstSwap: async () => null,
      },
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.steps.filter((step) => step.type === 'eoa_to_ephemeral_transfer')).toEqual([
      expect.objectContaining({
        chain: expect.objectContaining({ id: 42161, name: 'Arbitrum' }),
        asset: expect.objectContaining({ amountRaw: 5000000n, amount: '5.000000' }),
      }),
    ]);
  });

  it('places composed bridge funding allowance where execution requests it', () => {
    const route = makeRoute({
      source: {
        swaps: [makeQuoteResponse(42161)],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
      },
      bridge: makeBridge([makeBridgeAsset(42161, 5)]),
    });

    const authorization = makeAuthorization(PermitVariant.EIP2612Canonical);
    const plan = createSwapPlan(route, chainList, authorization);

    expect(plan.steps.map((step) => step.type)).toEqual([
      'allowance',
      'source_swap',
      'bridge_intent_submission',
      'allowance',
      'eoa_to_ephemeral_transfer',
      'bridge_deposit',
      'bridge_fill',
    ]);
    expect(plan.steps[3]).toMatchObject({
      id: `allowance:bridge:42161:${token.contractAddress}`,
      method: 'permit',
      spender: '0xbbbb000000000000000000000000000000000002',
      amount: { amountRaw: 5000000n },
    });

    const mayanPlan = createSwapPlan(
      { ...route, bridge: { ...route.bridge!, provider: 'mayan' } },
      chainList,
      authorization
    );
    expect(mayanPlan.steps.map((step) => step.type)).toEqual([
      'allowance',
      'source_swap',
      'allowance',
      'eoa_to_ephemeral_transfer',
      'bridge_deposit',
      'bridge_intent_submission',
      'bridge_fill',
    ]);
  });

  it('places direct EOA bridge allowance before intent submission', () => {
    const route = makeRoute({
      bridge: makeBridge([makeBridgeAsset(42161, 5)]),
    });

    const plan = createSwapPlan(
      route,
      chainList,
      makeAuthorization(PermitVariant.Unsupported)
    );

    expect(plan.steps.map((step) => step.type)).toEqual([
      'allowance',
      'bridge_intent_submission',
      'bridge_deposit',
      'bridge_fill',
    ]);
    expect(plan.steps[0]).toMatchObject({
      id: `allowance:bridge:42161:${token.contractAddress}`,
      method: 'approval',
      spender: '0x0000000000000000000000000000000000000000',
      amount: { amountRaw: 5000000n },
    });
  });

  it('builds direct bridge allowance metadata from routed balances', () => {
    const assetAddress = '0x00000000000000000000000000000000000000ee' as Hex;
    const asset = { ...makeBridgeAsset(42161, 5), contractAddress: assetAddress, decimals: 18 };
    const route = makeRoute({
      bridge: makeBridge([asset], { tokenAddress: assetAddress, decimals: 18 }),
      extras: {
        aggregators: [],
        oraclePrices: [],
        assetsUsed: [],
        balances: [
          {
            amount: '5',
            chainID: 42161,
            decimals: 18,
            logo: '',
            name: 'Wrapped Ether',
            symbol: 'WETH',
            tokenAddress: assetAddress,
            value: 15_000,
          },
        ],
      },
    });
    const strictChainList = {
      ...chainList,
      getTokenByAddress: (_chainId: number, address: Hex) => {
        if (address.toLowerCase() === assetAddress.toLowerCase()) {
          throw new Error(`Token ${address} is not in the static list`);
        }
        return token;
      },
    };

    const plan = createSwapPlan(
      route,
      strictChainList,
      makeAuthorization(PermitVariant.Unsupported)
    );

    expect(plan.steps[0]).toMatchObject({
      type: 'allowance',
      token: {
        contractAddress: assetAddress,
        decimals: 18,
        symbol: 'WETH',
      },
    });
  });

  it('does not model native bridge value as an EOA-to-ephemeral transfer', () => {
    const route = makeRoute({
      source: {
        swaps: [makeQuoteResponse(42161)],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
      },
      bridge: makeBridge(
        [
          {
            ...makeBridgeAsset(42161, 5),
            contractAddress: EADDRESS,
            decimals: 18,
            ephemeralBalance: new Decimal(0),
          },
        ],
        { decimals: 18, tokenAddress: EADDRESS }
      ),
    });

    const plan = createSwapPlan(
      route,
      chainList,
      makeAuthorization(PermitVariant.Unsupported)
    );

    expect(plan.steps.map((step) => step.type)).toEqual([
      'allowance',
      'source_swap',
      'bridge_intent_submission',
      'bridge_deposit',
      'bridge_fill',
    ]);

    const mayanPlan = createSwapPlan(
      { ...route, bridge: { ...route.bridge!, provider: 'mayan' } },
      chainList
    );
    expect(mayanPlan.steps.map((step) => step.type)).toEqual([
      'source_swap',
      'bridge_intent_submission',
      'bridge_deposit',
      'bridge_fill',
    ]);
  });

  it('uses the destination token amount for an EOA bridge fill that also delivers gas', () => {
    const route = makeRoute({
      bridge: {
        provider: 'nexus',
        amount: new Decimal(8),
        amounts: {
          tokenAmount: new Decimal(5),
          gasInCot: new Decimal(0),
          totalAmount: new Decimal(8),
        },
        destinationGas: {
          amount: new Decimal('0.001'),
          amountRaw: 1_000_000_000_000_000n,
          amountInToken: new Decimal('2.5'),
        },
        assets: [{ ...makeBridgeAsset(42161, 8), ephemeralBalance: new Decimal(0) }],
        chainID: 8453,
        decimals: 6,
        tokenAddress: token.contractAddress,
        estimatedFees: {
          collection: new Decimal(0),
          fulfilment: new Decimal(0),
          caGas: new Decimal(0),
          protocol: new Decimal(0),
          solver: new Decimal(0),
        },
      },
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.steps.map((step) => step.type)).toEqual([
      'bridge_intent_submission',
      'bridge_deposit',
      'bridge_fill',
    ]);
    expect(plan.steps[1]).toMatchObject({ asset: { amount: '8.000000', amountRaw: 8_000_000n } });
    expect(plan.steps[2]).toMatchObject({ asset: { amount: '5.000000', amountRaw: 5_000_000n } });
  });

  it('omits any public sweep step even for ephemeral destination execution', () => {
    const route = makeRoute({
      destination: {
        chainId: 8453,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: withTokenSwap,
        getDstSwap: async () => null,
      },
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.steps.map((step) => step.type)).not.toContain('sweep');
  });

  it('omits bridge steps when no bridge is required', () => {
    const route = makeRoute({
      source: { swaps: [makeQuoteResponse(8453)], creationTime: Date.now(), srcBuffer: new Decimal(0) },
      destination: {
        chainId: 8453,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: withTokenSwap,
        getDstSwap: async () => null,
      },
      sourceExecutionPaths: new Map([[8453, 'safe']]),
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.hasBridge).toBe(false);
    expect(plan.steps.map((step) => step.type)).toEqual(['source_swap', 'destination_swap']);
  });
});
