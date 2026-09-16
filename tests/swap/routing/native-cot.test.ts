import Decimal from 'decimal.js';
import { parseUnits } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { EADDRESS, ZERO_ADDRESS } from '../../../src/domain/constants/addresses';
import { validateSwapExactIn, validateSwapExactOut } from '../../../src/flows/swap-params';
import { createChainList } from '../../../src/services/chain-list';
import { determineDestinationSwaps } from '../../../src/swap/algorithms/destination';
import { liquidateInputHoldings } from '../../../src/swap/algorithms/liquidate';
import { CurrencyID } from '../../../src/swap/cot';
import { buildSwapPreflight } from '../../../src/swap/preflight';
import { determineSwapRoute, type RouteOptions } from '../../../src/swap/route';
import { selectStableSettlement } from '../../../src/swap/routing/settlement';
import { type SwapData, SwapMode } from '../../../src/swap/types';
import { testDeployment } from '../../fixtures/deployment';
import { makeOraclePrice } from '../../helpers/balances';
import { BASE_CHAIN } from '../../helpers/chains';
import { makeMiddlewareClient } from '../../helpers/middleware-client';
import { makePublicClientList } from '../../helpers/public-client';

vi.mock('viem', async (importOriginal) => ({
  ...await importOriginal<typeof import('viem')>(),
  createPublicClient: vi.fn(() => ({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === 'decimals' ? 6 : 'USDC'
    ),
  })),
}));

const ARC_CHAIN = 5042;
const arcErc20Usdc = '0x3600000000000000000000000000000000000000' as const;
const base = { ...testDeployment.chains[0], chainId: BASE_CHAIN, name: 'Base' };
const arc = {
  ...base,
  chainId: ARC_CHAIN,
  name: 'Arc',
  nativeCurrency: { ...base.nativeCurrency, name: 'USD Coin', symbol: 'USDC', currencyId: 1 },
  tokens: [],
};
const chainList = createChainList({ ...testDeployment, chains: [base, arc] });
const baseUsdc = base.tokens[0].address;
const eoaAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('native USDC settlement', () => {
  describe.each([SwapMode.EXACT_IN, SwapMode.EXACT_OUT])('%s', (mode) => {
    it.each([
      { source: ARC_CHAIN, sourceToken: EADDRESS, destination: BASE_CHAIN, token: baseUsdc },
      { source: ARC_CHAIN, sourceToken: ZERO_ADDRESS, destination: BASE_CHAIN, token: baseUsdc },
      { source: BASE_CHAIN, sourceToken: baseUsdc, destination: ARC_CHAIN, token: ZERO_ADDRESS },
      { source: BASE_CHAIN, sourceToken: baseUsdc, destination: ARC_CHAIN, token: EADDRESS },
      { source: BASE_CHAIN, sourceToken: baseUsdc, destination: ARC_CHAIN, token: arcErc20Usdc },
    ])('bridges $source → $destination with native address $token / $sourceToken', async ({
      source,
      sourceToken,
      destination,
      token,
    }) => {
      const getQuotes = vi.fn(async (requests: unknown[]) => requests.map(() => null));
      const sourceDecimals = source === ARC_CHAIN ? 18 : 6;
      const destinationDecimals = destination === ARC_CHAIN ? 18 : 6;
      const options: RouteOptions = {
        chainList,
        cotCurrencyId: CurrencyID.USDC,
        aggregators: [{ supportsChain: () => true, getQuotes }],
        middlewareClient: makeMiddlewareClient(),
        publicClientList: makePublicClientList(),
        eoaAddress,
        ephemeralAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        safeAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        forceMayan: false,
        // Exercise Exact Out's general COT selection as well as Exact In's normal path.
        skipFastPaths: mode === SwapMode.EXACT_OUT,
        walletPathHints: new Map([
          [source, 'safe'],
          [destination, 'safe'],
        ]),
        dstTokenInfo: { contractAddress: token, decimals: destinationDecimals, symbol: 'USDC' },
        balances: [
          {
            chainID: source,
            tokenAddress: sourceToken,
            amount: '10',
            decimals: sourceDecimals,
            symbol: 'USDC',
            name: 'USD Coin',
            logo: '',
            value: 10,
          },
        ],
        oraclePrices: [
          makeOraclePrice({
            chainId: destination,
            tokenAddress: token,
            symbol: 'USDC',
            decimals: destinationDecimals,
            priceUsd: 1,
          }),
        ],
        bridgeQuoteResponse: {
          fulfillmentBps: 0,
          sources: [
            {
              chainId: source,
              tokenAddress: source === ARC_CHAIN ? ZERO_ADDRESS : baseUsdc,
              depositFeeUsd: '0',
              depositFeeToken: '0',
              depositMayanFeeUsd: '0',
              depositMayanFeeToken: '0',
            },
          ],
          destination: {
            chainId: destination,
            tokenAddress: destination === ARC_CHAIN ? ZERO_ADDRESS : baseUsdc,
            fulfillmentFeeUsd: '0',
            fulfillmentFeeToken: '0',
          },
        },
      };
      const data = { toChainId: destination, toTokenAddress: token };
      const input: SwapData =
        mode === SwapMode.EXACT_IN
          ? { mode, data: validateSwapExactIn(data) }
          : {
              mode,
              data: validateSwapExactOut({
                ...data,
                toAmountRaw: parseUnits('10', token === arcErc20Usdc ? 6 : destinationDecimals),
              }),
            };
      if (token === arcErc20Usdc) {
        const preflight = await buildSwapPreflight(input, {
          chainList,
          cotCurrencyId: CurrencyID.USDC,
          eoaAddress,
          middlewareClient: makeMiddlewareClient({ getOraclePrices: async () => options.oraclePrices }),
          preloadedBalances: options.balances,
        });
        expect(preflight.dstTokenInfo).toEqual({
          contractAddress: ZERO_ADDRESS,
          decimals: 18,
          symbol: 'USDC',
        });
        options.dstTokenInfo = preflight.dstTokenInfo;
      }
      const route = await determineSwapRoute(input, options);

      expect(route.bridge?.amount.toFixed()).toBe('10');
      expect(route.bridge?.assets).toMatchObject([
        {
          chainID: source,
          contractAddress: source === ARC_CHAIN ? ZERO_ADDRESS : baseUsdc,
          decimals: sourceDecimals,
          eoaBalance: new Decimal(10),
        },
      ]);
      expect(route.destination.inputAmount.max.toFixed()).toBe('10');
      expect(route.source.swaps).toEqual([]);
      expect(route.destination.swap).toEqual({ tokenSwap: null, gasSwap: null });
      expect(getQuotes).not.toHaveBeenCalled();
    });
  });

  it('skips liquidation when a native holding already is the COT', async () => {
    const getQuotes = vi.fn(async (requests: unknown[]) => requests.map(() => null));
    const result = await liquidateInputHoldings({
      holdings: [
        {
          chainID: ARC_CHAIN,
          tokenAddress: EADDRESS,
          amountRaw: parseUnits('10', 18),
          decimals: 18,
          symbol: 'USDC',
        },
      ],
      aggregators: [{ supportsChain: () => true, getQuotes }],
      chainList,
      cotCurrencyId: CurrencyID.USDC,
      userAddressByChain: new Map([[ARC_CHAIN, eoaAddress]]),
      recipientAddressByChain: new Map([[ARC_CHAIN, eoaAddress]]),
    });

    expect(result).toEqual([]);
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it('skips destination quotes when native output already is the COT', async () => {
    const getQuotes = vi.fn(async (requests: unknown[]) => requests.map(() => null));
    const result = await determineDestinationSwaps({
      dst: {
        chainId: ARC_CHAIN,
        token: { contractAddress: EADDRESS, amountRaw: parseUnits('10', 18) },
      },
      options: {
        chainList,
        aggregators: [{ supportsChain: () => true, getQuotes }],
        userAddress: eoaAddress,
        recipientAddress: eoaAddress,
      },
    });

    expect(result).toBeNull();
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it('counts native COT holdings as zero swap legs when choosing USDC or USDT', () => {
    const withUsdt = createChainList({
      ...testDeployment,
      chains: [base, { ...arc, tokens: [base.tokens[1]] }],
    });
    expect(
      selectStableSettlement({
        chainList: withUsdt,
        currentCurrencyId: CurrencyID.USDC,
        destinationChainId: BASE_CHAIN,
        destinationTokenAddress: '0x0000000000000000000000000000000000000099',
        scoreHoldings: [
          { chainID: ARC_CHAIN, tokenAddress: EADDRESS },
          { chainID: BASE_CHAIN, tokenAddress: base.tokens[1].address },
        ],
      })
    ).toBe(CurrencyID.USDC);
  });
});
