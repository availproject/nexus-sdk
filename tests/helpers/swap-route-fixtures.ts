import {
  type Aggregator,
  CurrencyID,
  Environment,
  type Quote,
  type QuoteRequestExactInput,
  type QuoteRequestExactOutput,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import Long from 'long';
import { type Hex, type PublicClient, toHex } from 'viem';
import { vi } from 'vitest';

import {
  type ChainListType,
  type CosmosQueryClient,
  type OraclePriceResponse,
  SUPPORTED_CHAINS,
  type SwapData,
  SwapMode,
  type SwapParams,
  type VSCClient,
} from '../../src/commons';
import { ChainList } from '../../src/core/chains';
import { equalFold } from '../../src/core/utils';
import type { FlatBalance } from '../../src/swap/data';
import { determineSwapRoute, type SwapRoute } from '../../src/swap/route';
import { SAFE_PROXY_FACTORY } from '../../src/swap/safe.constants';
import { predictSafeAccountAddress } from '../../src/swap/safetx';
import { PublicClientList } from '../../src/swap/utils';

export const TEST_EOA: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const TEST_EPHEMERAL: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// VSC mock: the SDK now derives the Safe address locally via CREATE2 and asserts the
// server-returned address matches before the route is returned. The mock must therefore
// echo back the same locally-computed address; returning anything else would trip the
// verification check.
export const TEST_SAFE_FACTORY: Hex = SAFE_PROXY_FACTORY;

export const mainnetChainList = (): ChainListType => new ChainList(Environment.JADE);

type AnyQuoteRequest = QuoteRequestExactInput | QuoteRequestExactOutput;

export type RecordingAggregator = {
  aggregator: Aggregator;
  calls: AnyQuoteRequest[];
};

const makeQuote = (req: AnyQuoteRequest): Quote => {
  const inputAmount = req.type === 0 /* EXACT_IN */ ? req.inputAmount : req.outputAmount;
  const inputAmountStr = new Decimal(inputAmount.toString()).div(Decimal.pow(10, 6)).toFixed(6);

  // Aggregator returns the same amount in/out — the math collapses to identity for tests.
  return {
    expiry: Math.floor(Date.now() / 1000) + 600,
    input: {
      contractAddress: '0x0000000000000000000000000000000000000001' as Hex,
      amount: inputAmountStr,
      amountRaw: inputAmount,
      decimals: 6,
      value: Number(inputAmountStr),
      symbol: 'TST',
    },
    output: {
      contractAddress: '0x0000000000000000000000000000000000000002' as Hex,
      amount: inputAmountStr,
      amountRaw: inputAmount,
      decimals: 6,
      value: Number(inputAmountStr),
      symbol: 'TST',
    },
    txData: {
      approvalAddress: '0x0000000000000000000000000000000000000003' as Hex,
      tx: {
        to: '0x0000000000000000000000000000000000000004' as Hex,
        data: '0x' as Hex,
        value: '0x0' as Hex,
      },
    },
  };
};

export const makeRecordingAggregator = (): RecordingAggregator => {
  const calls: AnyQuoteRequest[] = [];
  const aggregator: Aggregator = {
    getQuotes: async (requests) => {
      for (const r of requests) calls.push(r);
      return requests.map((r) => makeQuote(r));
    },
  };
  return { aggregator, calls };
};

export const makeMockCosmosQueryClient = (
  oraclePrices: OraclePriceResponse = []
): CosmosQueryClient => ({
  fetchMyIntents: vi.fn().mockResolvedValue([]),
  fetchProtocolFees: vi.fn().mockRejectedValue(new Error('mock: protocol fees not provided')),
  fetchSolverData: vi.fn().mockRejectedValue(new Error('mock: solver data not provided')),
  fetchPriceOracle: vi.fn().mockResolvedValue(oraclePrices),
  checkIntentFilled: vi.fn().mockResolvedValue('mock'),
  getAccount: vi.fn().mockResolvedValue(undefined),
  waitForCosmosFillEvent: vi.fn().mockResolvedValue('mock'),
});

export const makeMockVscClient = (): VSCClient =>
  ({
    getEVMBalancesForAddress: vi.fn().mockResolvedValue([]),
    vscCreateFeeGrant: vi.fn().mockResolvedValue({}),
    vscPublishRFF: vi.fn().mockResolvedValue({ id: Long.fromNumber(0) }),
    vscCreateSponsoredApprovals: vi.fn().mockResolvedValue({ approvals: [], failedChainIds: [] }),
    vscCreateRFF: vi.fn().mockResolvedValue(undefined),
    vscGetSafeAccountAddress: vi.fn(async (_chainId: number, owner: Hex) => ({
      address: predictSafeAccountAddress(owner),
      factoryAddress: TEST_SAFE_FACTORY,
      exists: true,
    })),
    vscEnsureSafeAccount: vi.fn(async ({ owner }) => ({
      address: predictSafeAccountAddress(owner),
      deployTxHash: null,
      exists: true,
    })),
    vscCreateSafeExecuteTx: vi.fn(async (input) => [
      BigInt(input.chainId ?? 0),
      `0x${'11'.repeat(32)}` as Hex,
    ]),
    vscSBCTx: vi.fn(async (inputs: Array<{ chainID: number }>) =>
      inputs.map(
        (i, idx) => [BigInt(i.chainID), `0x${`${idx + 1}`.repeat(64)}` as Hex] as [bigint, Hex]
      )
    ),
  }) as unknown as VSCClient;

// Returns a PublicClient whose readContract returns canned ERC20 metadata. decimals=6, symbol='TST'.
const makeFakePublicClient = (): PublicClient =>
  ({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'symbol') return 'TST';
      throw new Error(`mock readContract: ${functionName} not implemented`);
    }),
  }) as unknown as PublicClient;

// Subclass-like fake: returns canned PublicClient regardless of chain. Avoids real RPC dial.
export class FakePublicClientList extends PublicClientList {
  private fake = makeFakePublicClient();
  override get(_chainID: bigint | number | string): PublicClient {
    return this.fake;
  }
}

export const makeBalance = (
  chainID: number,
  tokenAddress: Hex,
  amount = '100',
  decimals = 6,
  symbol = 'TST'
): FlatBalance => ({
  amount,
  chainID,
  decimals,
  logo: '',
  symbol,
  tokenAddress: toHex(
    Buffer.concat([Buffer.alloc(12, 0), Buffer.from(tokenAddress.slice(2), 'hex')])
  ),
  universe: Universe.ETHEREUM,
  value: Number(amount),
});

export const makeOraclePrice = (
  chainId: number,
  tokenAddress: Hex,
  priceUsd = '1'
): OraclePriceResponse[number] => ({
  chainId,
  priceUsd: new Decimal(priceUsd),
  tokenAddress,
  tokensPerUsd: new Decimal(1).div(priceUsd),
});

type RunScenarioParams = {
  input: SwapData;
  preloadedBalances: FlatBalance[];
  oraclePrices?: OraclePriceResponse;
  aggregator?: RecordingAggregator;
  vscClient?: VSCClient;
};

export type RunScenarioResult = {
  route: SwapRoute;
  aggregator: RecordingAggregator;
  vscClient: VSCClient;
};

export const runDetermineSwapRoute = async (
  params: RunScenarioParams
): Promise<RunScenarioResult> => {
  const aggregator = params.aggregator ?? makeRecordingAggregator();
  const vscClient = params.vscClient ?? makeMockVscClient();
  const cosmosQueryClient = makeMockCosmosQueryClient(params.oraclePrices ?? []);
  const chainList = mainnetChainList();
  const publicClientList = new FakePublicClientList(chainList);

  const options: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  } = {
    address: { cosmos: 'avail1test', eoa: TEST_EOA, ephemeral: TEST_EPHEMERAL },
    chainList,
    cosmosQueryClient,
    intentExplorerUrl: 'https://test.example',
    onSwapIntent: ({ allow }: { allow: () => void }) => allow(),
    preloadedBalances: params.preloadedBalances,
    vscClient,
    wallet: { cosmos: {} as never, eoa: {} as never, ephemeral: {} as never },
    aggregators: [aggregator.aggregator],
    publicClientList,
    cotCurrencyID: CurrencyID.USDC,
  } as never;

  // determineSwapRoute now returns { route, refresh }. The integration fixtures only
  // care about the initial route — refresh is exercised by the dedicated win-5 tests.
  const { route } = await determineSwapRoute(params.input, options);
  return { route, aggregator, vscClient };
};

// Build a SwapData EXACT_IN input.
export const exactInInput = (data: {
  from: { chainId: number; tokenAddress: Hex; amount?: bigint }[];
  toChainId: number;
  toTokenAddress: Hex;
}): SwapData => ({
  mode: SwapMode.EXACT_IN,
  data,
});

// Build a SwapData EXACT_OUT input.
export const exactOutInput = (data: {
  fromSources?: { chainId: number; tokenAddress: Hex }[];
  toChainId: number;
  toTokenAddress: Hex;
  toAmount: bigint;
  toNativeAmount?: bigint;
}): SwapData => ({
  mode: SwapMode.EXACT_OUT,
  data,
});

// Categorize captured aggregator calls into source vs destination calls.
//
// Primary discriminator is chain context: any call on a chain other than `destChainId` is a
// source quote. For calls on the destination chain (cross-chain destination *and* same-chain
// swaps) we further disambiguate by input token:
//
//   - input == COT          → destination buy quote (EXACT_IN dest swap or EXACT_OUT final buy)
//   - input == destToken    → destination preliminary price survey (EXACT_OUT only — emitted
//                              by `determineDestinationSwaps` to size the input amount)
//   - otherwise             → source quote happening on the destination chain (same-chain swap)
//
// We deliberately do NOT classify by `userAddress != receiverAddress` here, even though the
// new wrapper API guarantees that distinction: doing so would partition by the very property
// the tests assert and silently mask regressions if routing inverted the two roles.
export const partitionCalls = (
  calls: AnyQuoteRequest[],
  ctx: { destChainId: number; destToken: Hex; cotPerChain: Record<number, Hex> }
): { sourceCalls: AnyQuoteRequest[]; destinationCalls: AnyQuoteRequest[] } => {
  const sourceCalls: AnyQuoteRequest[] = [];
  const destinationCalls: AnyQuoteRequest[] = [];
  for (const c of calls) {
    const chainId = Number(c.chain.chainID);
    if (chainId !== ctx.destChainId) {
      sourceCalls.push(c);
      continue;
    }
    const inputHex = `0x${Buffer.from(c.inputToken).toString('hex').slice(-40)}` as Hex;
    const cot = ctx.cotPerChain[chainId];
    const inputIsCOT = cot != null && equalFold(inputHex, cot);
    const inputIsDestToken = equalFold(inputHex, ctx.destToken);
    if (inputIsCOT || inputIsDestToken) destinationCalls.push(c);
    else sourceCalls.push(c);
  }
  return { sourceCalls, destinationCalls };
};

// Re-export for assertions
export { SUPPORTED_CHAINS };
