// Swap-domain characterization: keeps buildSwapPreflight, determineSwapRoute, and
// calculateMaxForSwap real (only middleware/RPC mocked) so max-amount behavior stays
// consistent with exact-in route construction, quote-winner selection, haircut math, and
// returned source attribution under the smart-account-only model (WalletPath = ephemeral |
// safe). See ./README.md.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { formatUnits, parseUnits, type Hex } from 'viem';
import { buildSwapPreflight } from '../../../src/swap/preflight';
import { mulDecimals } from '../../../src/services/math';
import { determineSwapRoute } from '../../../src/swap/route';
import { calculateMaxForSwap } from '../../../src/swap/max';
import { MAX_SWAP_HAIRCUT_MIN_USDC, MAX_SWAP_HAIRCUT_PCT } from '../../../src/swap/constants';
import { SwapMode, type FlatBalance, type SwapParams } from '../../../src/swap/types';
import type { ChainListType } from '../../../src/domain';
import { makeSwapMiddlewareClient } from '../../helpers/middleware-client';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  USDC_ARB,
  USDC_BASE,
  USDC_OP,
  WETH,
  makeSwapChainList,
} from '../../helpers/swap';

const hoisted = vi.hoisted(() => {
  const readContract = vi.fn();
  const multicall = vi.fn();
  const getCode = vi.fn();
  const getTransactionCount = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const simulateContract = vi.fn();
  const watchContractEvent = vi.fn();

  const createPublicClient = vi.fn(() => ({
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    simulateContract,
    watchContractEvent,
  }));

  return {
    createPublicClient,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    simulateContract,
    watchContractEvent,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: hoisted.createPublicClient,
    http: vi.fn().mockReturnValue({}),
    fallback: vi.fn().mockReturnValue({}),
  };
});

const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
type MaxOptions = Parameters<typeof calculateMaxForSwap>[1];
const SOURCE_DAI = '0x0000000000000000000000000000000000000da1' as Hex;
const UNLISTED_ARB = '0x9999000000000000000000000000000000000001' as Hex;
const ARB_BEBOP_ROUTER = '0x1111111111111111111111111111111111112222' as Hex;

const tokenInfoByAddress = (tokenAddress: Hex) => {
  const normalized = tokenAddress.toLowerCase();
  if (normalized === SOURCE_DAI.toLowerCase()) return { symbol: 'DAI', decimals: 18 };
  if (normalized === UNLISTED_ARB.toLowerCase()) return { symbol: 'UNLISTED', decimals: 18 };
  if (normalized === USDC_ARB.toLowerCase()) return { symbol: 'USDC', decimals: 6 };
  if (normalized === USDC_OP.toLowerCase()) return { symbol: 'USDC', decimals: 6 };
  if (normalized === USDC_BASE.toLowerCase()) return { symbol: 'USDC', decimals: 6 };
  if (normalized === WETH.toLowerCase()) return { symbol: 'WETH', decimals: 18 };
  throw new Error(`Unknown token ${tokenAddress}`);
};

const RATE_BY_AGGREGATOR: Record<string, Record<string, Decimal>> = {
  lifi: {
    [`${BASE_CHAIN}:${USDC_BASE.toLowerCase()}:${WETH.toLowerCase()}`]: new Decimal(
      '0.000666666666666666'
    ),
    [`${ARB_CHAIN}:${UNLISTED_ARB.toLowerCase()}:${USDC_ARB.toLowerCase()}`]: new Decimal('0.72'),
    [`${ARB_CHAIN}:${SOURCE_DAI.toLowerCase()}:${USDC_ARB.toLowerCase()}`]: new Decimal('0.72'),
    [`${OP_CHAIN}:${SOURCE_DAI.toLowerCase()}:${USDC_OP.toLowerCase()}`]: new Decimal('0.95'),
  },
  bebop: {
    [`${BASE_CHAIN}:${USDC_BASE.toLowerCase()}:${WETH.toLowerCase()}`]: new Decimal(
      '0.000689655172413793'
    ),
    [`${ARB_CHAIN}:${UNLISTED_ARB.toLowerCase()}:${USDC_ARB.toLowerCase()}`]: new Decimal('0.8'),
    [`${ARB_CHAIN}:${SOURCE_DAI.toLowerCase()}:${USDC_ARB.toLowerCase()}`]: new Decimal('0.8'),
    [`${OP_CHAIN}:${SOURCE_DAI.toLowerCase()}:${USDC_OP.toLowerCase()}`]: new Decimal('0.85'),
  },
};

const rateKey = (chainId: number, inputToken: Hex, outputToken: Hex) =>
  `${chainId}:${inputToken.toLowerCase()}:${outputToken.toLowerCase()}`;

const getRate = (
  aggregator: 'lifi' | 'bebop',
  chainId: number,
  inputToken: Hex,
  outputToken: Hex
) => {
  const rate = RATE_BY_AGGREGATOR[aggregator][rateKey(chainId, inputToken, outputToken)];
  if (!rate) {
    throw new Error(`Missing ${aggregator} rate for ${chainId}:${inputToken}:${outputToken}`);
  }
  return rate;
};

const fromRawAmount = (amountRaw: bigint, decimals: number) =>
  new Decimal(formatUnits(amountRaw, decimals));

const toRawAmount = (amount: Decimal, decimals: number) =>
  parseUnits(amount.toFixed(decimals), decimals);

const makeLiFiResponse = (params: Record<string, string>, exactOut = false) => {
  const chainId = Number(params.fromChain);
  const inputToken = params.fromToken as Hex;
  const outputToken = params.toToken as Hex;
  const inputMeta = tokenInfoByAddress(inputToken);
  const outputMeta = tokenInfoByAddress(outputToken);
  const rate = getRate('lifi', chainId, inputToken, outputToken);

  const outputAmountHuman = exactOut
    ? fromRawAmount(BigInt(params.toAmount), outputMeta.decimals)
    : fromRawAmount(BigInt(params.fromAmount), inputMeta.decimals).mul(rate);
  const inputAmountHuman = exactOut
    ? outputAmountHuman.div(rate)
    : fromRawAmount(BigInt(params.fromAmount), inputMeta.decimals);

  const inputAmountRaw = toRawAmount(inputAmountHuman, inputMeta.decimals);
  const outputAmountRaw = toRawAmount(outputAmountHuman, outputMeta.decimals);

  return {
    estimate: {
      fromAmount: inputAmountRaw.toString(),
      fromAmountUSD: inputAmountHuman.toFixed(2),
      toAmount: outputAmountRaw.toString(),
      toAmountMin: outputAmountRaw.toString(),
      toAmountUSD: outputAmountHuman.toFixed(2),
      approvalAddress: '0x2222222222222222222222222222222222221111',
      feeCosts: [],
      gasCosts: [],
    },
    action: {
      fromToken: {
        address: inputToken,
        symbol: inputMeta.symbol,
        decimals: inputMeta.decimals,
        priceUSD: '1',
      },
      toToken: {
        address: outputToken,
        symbol: outputMeta.symbol,
        decimals: outputMeta.decimals,
        priceUSD: '1',
      },
    },
    transactionRequest: {
      to: '0x2222222222222222222222222222222222222222',
      data: '0xabcdef',
      value: '0x0',
    },
  };
};

const makeBebopResponse = (params: Record<string, string>) => {
  const CHAIN_ID_BY_NAME: Record<string, number> = {
    arbitrum: ARB_CHAIN,
    optimism: OP_CHAIN,
    base: BASE_CHAIN,
  };
  const chainId = CHAIN_ID_BY_NAME[params.chain];
  const inputToken = params.sell_tokens as Hex;
  const outputToken = params.buy_tokens as Hex;
  const inputMeta = tokenInfoByAddress(inputToken);
  const outputMeta = tokenInfoByAddress(outputToken);
  const rate = getRate('bebop', chainId, inputToken, outputToken);

  const outputAmountHuman = fromRawAmount(BigInt(params.sell_amounts), inputMeta.decimals).mul(rate);
  const inputAmountHuman = fromRawAmount(BigInt(params.sell_amounts), inputMeta.decimals);

  const inputAmountRaw = toRawAmount(inputAmountHuman, inputMeta.decimals);
  const outputAmountRaw = toRawAmount(outputAmountHuman, outputMeta.decimals);
  const router = chainId === ARB_CHAIN ? ARB_BEBOP_ROUTER : '0x3333333333333333333333333333333333333332';
  const approvalAddress =
    chainId === ARB_CHAIN ? '0x1111111111111111111111111111111111111111' : '0x3333333333333333333333333333333333333331';

  return {
    routes: [
      {
        quote: {
          buyTokens: {
            [outputToken]: {
              minimumAmount: outputAmountRaw.toString(),
              priceUsd: outputMeta.symbol === 'USDC' ? 1 : 1500,
              symbol: outputMeta.symbol,
              decimals: outputMeta.decimals,
            },
          },
          sellTokens: {
            [inputToken]: {
              amount: inputAmountRaw.toString(),
              priceUsd: inputMeta.symbol === 'USDC' ? 1 : 1500,
              symbol: inputMeta.symbol,
              decimals: inputMeta.decimals,
            },
          },
          approvalTarget: approvalAddress,
          tx: {
            to: router,
            data: '0xfedcba',
            value: '0x0',
          },
          expiry: Math.floor(Date.now() / 1000) + 60,
        },
      },
    ],
  };
};

const defaultBalances = (): FlatBalance[] => [
  {
    amount: '1200',
    chainID: ARB_CHAIN,
    decimals: 18,
    symbol: 'DAI',
    tokenAddress: SOURCE_DAI,
    value: 1200,
    logo: '',
    name: 'DAI',
  },
  {
    amount: '700',
    chainID: OP_CHAIN,
    decimals: 6,
    symbol: 'USDC',
    tokenAddress: USDC_OP,
    value: 700,
    logo: '',
    name: 'USDC',
  },
];

const makeBridgeQuoteResponse = () => ({
  fulfillmentBps: 0,
  sources: [
    {
      chainId: ARB_CHAIN,
      tokenAddress: USDC_ARB,
      depositFeeUsd: '0',
      depositFeeToken: '0',
    },
    {
      chainId: OP_CHAIN,
      tokenAddress: USDC_OP,
      depositFeeUsd: '0',
      depositFeeToken: '0',
    },
  ],
  destination: {
    chainId: BASE_CHAIN,
    tokenAddress: USDC_BASE,
    fulfillmentFeeUsd: '0',
    fulfillmentFeeToken: '0',
  },
});

const makeChainList = (): ChainListType => {
  const chainList = makeSwapChainList() as ChainListType;
  const originalGetTokenByAddress = chainList.getTokenByAddress;

  chainList.getTokenByAddress = vi
    .fn()
    .mockImplementation((chainId: number, tokenAddress: Hex) => {
      if (tokenAddress.toLowerCase() === SOURCE_DAI.toLowerCase()) {
        return {
          contractAddress: SOURCE_DAI,
          decimals: 18,
          logo: '',
          name: 'Dai Stablecoin',
          symbol: 'DAI',
        };
      }

      return originalGetTokenByAddress(chainId, tokenAddress);
    });

  return chainList;
};

const makeOptions = (balances: FlatBalance[]): MaxOptions => {
  const chainList = makeChainList();
  const middlewareClient = makeSwapMiddlewareClient({
    getSwapBalances: vi.fn().mockResolvedValue(balances),
    getOraclePrices: vi.fn().mockResolvedValue([
      {
        universe: 'EVM' as const,
        chainId: BASE_CHAIN,
        tokenAddress: USDC_BASE,
        tokenSymbol: 'USDC',
        tokenDecimals: 6,
        priceUsd: new Decimal(1),
        timestamp: 1,
      },
    ]),
    getLiFiQuote: vi.fn().mockImplementation(async (params: Record<string, string>, exactOut?: boolean) =>
      makeLiFiResponse(params, Boolean(exactOut))
    ),
    getBebopQuote: vi.fn().mockImplementation(async (params: Record<string, string>) =>
      makeBebopResponse(params)
    ),
    getQuote: vi.fn().mockResolvedValue(makeBridgeQuoteResponse()),
    getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'nexus' }),
    getMayanQuotes: vi.fn(),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
    configureTiming: vi.fn(),
    destroy: vi.fn(),
  });

  return {
    chainList,
    eoaAddress: EOA,
    ephemeralAddress: EPH,
    cotCurrencyId: 1 as SwapParams['cotCurrencyId'],
    middlewareClient,
  };
};

const syntheticExactInInput = (toTokenAddress: Hex) => ({
  mode: SwapMode.EXACT_IN as const,
  data: {
    from: [],
    toChainId: BASE_CHAIN,
    toTokenAddress,
  },
});

describe('calculateMaxForSwap characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.readContract.mockImplementation(
      async ({ address, functionName }: { address: Hex; functionName: string }) => {
        if (functionName === 'decimals') {
          return tokenInfoByAddress(address).decimals;
        }
        if (functionName === 'symbol') {
          return tokenInfoByAddress(address).symbol;
        }
        throw new Error(`Unhandled readContract ${functionName} on ${address}`);
      }
    );
    hoisted.multicall.mockImplementation(async ({ contracts }: { contracts: unknown[] }) =>
      contracts.map(() => ({ result: 0n }))
    );
    hoisted.getCode.mockResolvedValue(undefined);
    hoisted.getTransactionCount.mockResolvedValue(0n);
    hoisted.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    hoisted.simulateContract.mockResolvedValue({ request: {} });
    hoisted.watchContractEvent.mockImplementation(() => () => undefined);
  });

  it('keeps max output consistent with the real exact-in route for a non-COT destination', async () => {
    const options = makeOptions(defaultBalances());
    const input = { toChainId: BASE_CHAIN, toTokenAddress: WETH };

    const preflight = await buildSwapPreflight(syntheticExactInInput(WETH), {
      chainList: options.chainList,
      cotCurrencyId: options.cotCurrencyId,
      eoaAddress: options.eoaAddress,
      middlewareClient: options.middlewareClient,
    });
    const route = await determineSwapRoute(syntheticExactInInput(WETH), {
      aggregators: preflight.aggregators,
      bridgeQuoteResponse: preflight.bridgeQuoteResponse,
      chainList: options.chainList,
      middlewareClient: options.middlewareClient,
      publicClientList: preflight.publicClientList,
      oraclePrices: preflight.oraclePrices,
      dstTokenInfo: preflight.dstTokenInfo,
      eoaAddress: options.eoaAddress,
      ephemeralAddress: options.ephemeralAddress,
      balances: preflight.balances,
      walletPathHints: preflight.walletPathHints,
      cotCurrencyId: options.cotCurrencyId,
      forceMayan: false,
    });

    const result = await calculateMaxForSwap(input, options);

    expect(route.type).toBe(SwapMode.EXACT_IN);
    expect(route.source.swaps.map((entry) => entry.chainID)).toEqual([ARB_CHAIN]);
    expect(route.source.swaps[0]?.aggregator.constructor.name).toBe('BebopAggregator');
    expect(route.destination.swap.tokenSwap?.aggregator.constructor.name).toBe('BebopAggregator');
    expect(route.extras.assetsUsed.map((asset) => `${asset.chainID}:${asset.symbol}`)).toEqual([
      `${ARB_CHAIN}:DAI`,
      `${OP_CHAIN}:USDC`,
    ]);
    expect(result.sources).toEqual(
      route.extras.assetsUsed.map((asset) => ({
        chainId: asset.chainID,
        tokenAddress: asset.tokenAddress,
        symbol: asset.symbol,
        decimals: asset.decimals,
        amount: asset.amount,
      }))
    );

    const cotAmount = route.destination.inputAmount.max;
    const haircut = Decimal.max(
      cotAmount.mul(MAX_SWAP_HAIRCUT_PCT),
      new Decimal(MAX_SWAP_HAIRCUT_MIN_USDC)
    );
    const adjusted = cotAmount.minus(haircut);
    const tokenSwap = route.destination.swap.tokenSwap!;
    const expectedOutput = new Decimal(tokenSwap.quote.output.amount)
      .mul(adjusted)
      .div(tokenSwap.quote.input.amount);

    expect(result.symbol).toBe('WETH');
    expect(result.decimals).toBe(18);
    expect(result.maxAmountRaw).toBe(mulDecimals(expectedOutput, 18));
    expect(result.maxAmount).toBe(expectedOutput.toFixed(18));

    // Ground truth — NOT recomputed from the route's own quote object. The destination swap is
    // USDC→WETH and Bebop wins (asserted above), so the true per-COT rate is the known Bebop rate.
    // The max must equal the haircut-adjusted COT valued at that external rate (within rounding),
    // which validates the scaling itself rather than restating the implementation's formula.
    const KNOWN_BEBOP_USDC_TO_WETH = new Decimal('0.000689655172413793');
    const groundTruth = adjusted.mul(KNOWN_BEBOP_USDC_TO_WETH);
    expect(new Decimal(result.maxAmount).sub(groundTruth).abs().div(groundTruth).lt(0.0001)).toBe(
      true
    );
    // raw and human must agree at the reported decimals (would have caught the COT-decimals mismatch).
    expect(result.maxAmountRaw).toBe(parseUnits(result.maxAmount, result.decimals));
  });

  it('uses adjusted COT directly when the destination token is the route COT', async () => {
    const options = makeOptions(defaultBalances());
    const input = { toChainId: BASE_CHAIN, toTokenAddress: USDC_BASE };

    const preflight = await buildSwapPreflight(syntheticExactInInput(USDC_BASE), {
      chainList: options.chainList,
      cotCurrencyId: options.cotCurrencyId,
      eoaAddress: options.eoaAddress,
      middlewareClient: options.middlewareClient,
    });
    const route = await determineSwapRoute(syntheticExactInInput(USDC_BASE), {
      aggregators: preflight.aggregators,
      bridgeQuoteResponse: preflight.bridgeQuoteResponse,
      chainList: options.chainList,
      middlewareClient: options.middlewareClient,
      publicClientList: preflight.publicClientList,
      oraclePrices: preflight.oraclePrices,
      dstTokenInfo: preflight.dstTokenInfo,
      eoaAddress: options.eoaAddress,
      ephemeralAddress: options.ephemeralAddress,
      balances: preflight.balances,
      walletPathHints: preflight.walletPathHints,
      cotCurrencyId: options.cotCurrencyId,
      forceMayan: false,
    });

    const result = await calculateMaxForSwap(input, options);

    expect(route.destination.swap.tokenSwap).toBeNull();
    const cotAmount = route.destination.inputAmount.max;
    const haircut = Decimal.max(
      cotAmount.mul(MAX_SWAP_HAIRCUT_PCT),
      new Decimal(MAX_SWAP_HAIRCUT_MIN_USDC)
    );
    const adjusted = cotAmount.minus(haircut);

    expect(result.symbol).toBe('USDC');
    expect(result.decimals).toBe(6);
    expect(result.maxAmountRaw).toBe(mulDecimals(adjusted, 6));
    expect(result.maxAmount).toBe(adjusted.toFixed(6));
    // raw and human must agree at the reported decimals (the COT-direct branch derives both from the
    // resolved destination token, not the separately-resolved COT decimals).
    expect(result.maxAmountRaw).toBe(parseUnits(result.maxAmount, result.decimals));
  });

  it('keeps max usable when a source token is present in swap balances but not in the deployment token list', async () => {
    const balances: FlatBalance[] = [
      {
        amount: '1200',
        chainID: ARB_CHAIN,
        decimals: 18,
        symbol: 'UNLISTED',
        tokenAddress: UNLISTED_ARB,
        value: 1200,
        logo: '',
        name: 'UNLISTED',
      },
      {
        amount: '700',
        chainID: OP_CHAIN,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC_OP,
        value: 700,
        logo: '',
        name: 'USDC',
      },
    ];
    const options = makeOptions(balances);
    const originalGetTokenByAddress = options.chainList.getTokenByAddress;
    options.chainList.getTokenByAddress = vi
      .fn()
      .mockImplementation((chainId: number, tokenAddress: Hex) => {
        if (chainId === ARB_CHAIN && tokenAddress.toLowerCase() === UNLISTED_ARB.toLowerCase()) {
          throw new Error(`Unsupported deployment token lookup: ${tokenAddress}`);
        }
        return originalGetTokenByAddress(chainId, tokenAddress);
      });
    const input = { toChainId: BASE_CHAIN, toTokenAddress: WETH };

    const result = await calculateMaxForSwap(input, options);

    expect(result.sources).toEqual([
      {
        chainId: OP_CHAIN,
        tokenAddress: USDC_OP,
        symbol: 'USDC',
        decimals: 6,
        amount: '700',
      },
      {
        chainId: ARB_CHAIN,
        tokenAddress: UNLISTED_ARB,
        symbol: 'UNLISTED',
        decimals: 18,
        amount: '1200',
      },
    ]);
    expect(result.maxAmountRaw).toBeGreaterThan(0n);
    expect(options.chainList.getTokenByAddress).not.toHaveBeenCalledWith(ARB_CHAIN, UNLISTED_ARB);
  });
});
