import type { Hex } from 'viem';
import { buildQuoteRequest } from '../bridge/intent/quote-request';
import { type ChainListType, getLogger, type TokenInfo } from '../domain';
import { isNativeAddress } from '../services/addresses';
import { fetchErc20TokenMetadata } from '../services/token-metadata';
import type { MiddlewareSwapPreflightClient } from '../transport';
import { createAggregators } from './aggregators';
import { getBalancesForSwap } from './balance/swap-balances';
import { type CurrencyID, resolveSwapSettlement } from './cot';
import type {
  BridgeQuoteResponse,
  FlatBalance,
  OraclePriceResponse,
  PublicClientList,
  SwapData,
  WalletPath,
} from './types';
import { chainSupports7702, resolveWalletPath } from './wallet/capabilities';
import { createPublicClientList } from './wallet/public-client-list';

type RawSwapBalances = Awaited<ReturnType<MiddlewareSwapPreflightClient['getSwapBalances']>>;
const logger = getLogger();

export type SwapPreflight = {
  aggregators: ReturnType<typeof createAggregators>;
  balances: FlatBalance[];
  bridgeQuoteResponse: BridgeQuoteResponse | null;
  dstTokenInfo: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
  oraclePrices: OraclePriceResponse;
  publicClientList: PublicClientList;
  walletPathHints: Map<number, WalletPath>;
};

type BuildSwapPreflightOptions = {
  chainList: ChainListType;
  cotCurrencyId: CurrencyID;
  eoaAddress: Hex;
  middlewareClient: MiddlewareSwapPreflightClient;
  preloadedBalances?: RawSwapBalances;
  // Caller-resolved destination token metadata — reused instead of re-reading it (the composite
  // swapAndExecute flow already resolves it via chainlist → balances → on-chain).
  preloadedDstTokenInfo?: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
};

const getCandidateChainIds = (input: SwapData, balances: FlatBalance[]): number[] => {
  const chainIds = new Set<number>([input.data.toChainId]);

  for (const balance of balances) {
    chainIds.add(balance.chainID);
  }

  if (input.mode === 'EXACT_IN') {
    for (const source of input.data.sources ?? []) {
      chainIds.add(source.chainId);
    }
  } else {
    for (const source of input.data.sources ?? []) {
      chainIds.add(source.chainId);
    }
  }

  return [...chainIds];
};

const resolveDstTokenInfo = async (
  chainList: ChainListType,
  publicClientList: PublicClientList,
  toChainId: number,
  toTokenAddress: Hex
): Promise<{ decimals: number; contractAddress: Hex; symbol: string }> => {
  if (isNativeAddress(toTokenAddress)) {
    const chain = chainList.getChainByID(toChainId);
    return {
      contractAddress: toTokenAddress,
      decimals: chain.nativeCurrency.decimals,
      symbol: chain.nativeCurrency.symbol,
    };
  }
  return fetchErc20TokenMetadata(toTokenAddress, publicClientList.get(toChainId));
};

// The bridge-fee quote must be denominated in the token the router actually bridges, because the
// fee value and the decimals it's later scaled by (in computeBridgeFees) have to refer to the same
// token — a mismatch inflates/deflates the fee by the decimal gap (e.g. ETH 18 vs USDC 6). The
// settlement decision (same-token bridge vs COT round-trip) is shared with the route via
// `resolveSwapSettlement` so the two can't drift. A native COT has no bridge-quote path → undefined.
// (For EXACT_IN without explicit sources the families aren't known yet, so `resolveSwapSettlement`
// reports `sameTokenBridge: false` and we quote the COT — the same documented edge as before.)
export const resolveBridgeQuoteToken = (
  chainList: ChainListType,
  input: SwapData,
  cotCurrencyId: CurrencyID
): TokenInfo | undefined => {
  const { toChainId, toTokenAddress } = input.data;
  const { sameTokenBridge } = resolveSwapSettlement(
    chainList,
    input.mode,
    input.data.sources ?? [],
    toChainId,
    toTokenAddress,
    cotCurrencyId
  );

  if (sameTokenBridge) {
    return isNativeAddress(toTokenAddress)
      ? chainList.getNativeToken(toChainId)
      : chainList.getTokenByAddress(toChainId, toTokenAddress);
  }
  const cot = chainList.getTokenByCurrencyId(toChainId, cotCurrencyId);
  return isNativeAddress(cot.contractAddress) ? undefined : cot;
};

export const buildSwapPreflight = async (
  input: SwapData,
  options: BuildSwapPreflightOptions
): Promise<SwapPreflight> => {
  logger.debug('buildSwapPreflight:start', {
    mode: input.mode,
    toChainId: input.data.toChainId,
    rawInputData: input,
    hasPreloadedBalances: options.preloadedBalances !== undefined,
  });

  const aggregators = createAggregators(options.middlewareClient);
  const publicClientList = createPublicClientList(options.chainList);

  const rawBalancesPromise = options.preloadedBalances
    ? Promise.resolve(options.preloadedBalances)
    : options.middlewareClient.getSwapBalances(options.eoaAddress);
  const quotePromise: Promise<BridgeQuoteResponse | null> = (() => {
    try {
      const quoteToken = resolveBridgeQuoteToken(options.chainList, input, options.cotCurrencyId);
      if (!quoteToken) {
        return Promise.resolve(null);
      }
      const quoteRequest = buildQuoteRequest(options.chainList, quoteToken, input.data.toChainId);
      return options.middlewareClient.getQuote(quoteRequest).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  })();

  const [oraclePrices, rawBalances, dstTokenInfo, bridgeQuoteResponse] = await Promise.all([
    options.middlewareClient.getOraclePrices(),
    rawBalancesPromise,
    options.preloadedDstTokenInfo ??
      resolveDstTokenInfo(
        options.chainList,
        publicClientList,
        input.data.toChainId,
        input.data.toTokenAddress
      ),
    quotePromise,
  ]);

  const balances = await getBalancesForSwap({
    balances: rawBalances,
    dstChainId: input.data.toChainId,
    dstTokenAddress: input.data.toTokenAddress,
  });

  const candidateChainIds = getCandidateChainIds(input, balances);
  const walletPathHints = new Map<number, WalletPath>(
    candidateChainIds.map((chainId) => {
      const chain = options.chainList.getChainByID(chainId);
      return [chainId, resolveWalletPath(chainSupports7702(chain))];
    })
  );

  logger.debug('buildSwapPreflight:complete', {
    toChainId: input.data.toChainId,
    balanceCount: balances.length,
    candidateChainIds,
    walletPathHints: Array.from(walletPathHints.entries()),
  });

  return {
    aggregators,
    balances,
    bridgeQuoteResponse,
    dstTokenInfo,
    oraclePrices,
    publicClientList,
    walletPathHints,
  };
};
