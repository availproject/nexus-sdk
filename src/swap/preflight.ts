import type { Hex } from 'viem';
import { type ChainListType, getLogger, type TokenInfo } from '../domain';
import { isNativeAddress } from '../services/addresses';
import { deductSwapNativeReserveFees } from '../services/balances';
import { fetchErc20TokenMetadata } from '../services/token-metadata';
import type { MiddlewareSwapPreflightClient } from '../transport';
import { createAggregators } from './aggregators';
import { selectSwapSources } from './balance/swap-balances';
import type { CurrencyID } from './cot';
import {
  type FlatBalance,
  type OraclePriceResponse,
  type PublicClientList,
  type SwapData,
  SwapMode,
  type WalletPath,
} from './types';
import { chainSupports7702, resolveWalletPath } from './wallet/capabilities';
import { createPublicClientList } from './wallet/public-client-list';

type RawSwapBalances = Awaited<ReturnType<MiddlewareSwapPreflightClient['getSwapBalances']>>;
const logger = getLogger();

export type SwapPreflight = {
  aggregators: ReturnType<typeof createAggregators>;
  balances: FlatBalance[];
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

  for (const source of input.data.sources ?? []) {
    chainIds.add(source.chainId);
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

export const buildSwapPreflight = async (
  input: SwapData,
  options: BuildSwapPreflightOptions
): Promise<SwapPreflight> => {
  logger.debug('swap.preflight.operation.started', {
    mode: input.mode,
    toChainId: input.data.toChainId,
    toTokenAddress: input.data.toTokenAddress,
    sourceCount: input.data.sources?.length ?? 0,
    hasNativeRequest:
      input.mode === SwapMode.EXACT_OUT &&
      input.data.toNativeAmountRaw !== undefined &&
      input.data.toNativeAmountRaw !== 0n,
    hasPreloadedBalances: options.preloadedBalances !== undefined,
  });

  const aggregators = createAggregators(options.middlewareClient);
  const publicClientList = createPublicClientList(options.chainList);

  const rawBalancesPromise = options.preloadedBalances
    ? Promise.resolve(options.preloadedBalances)
    : options.middlewareClient.getSwapBalances(options.eoaAddress);
  const [oraclePrices, rawBalances, dstTokenInfo] = await Promise.all([
    options.middlewareClient.getOraclePrices(),
    rawBalancesPromise,
    options.preloadedDstTokenInfo ??
      resolveDstTokenInfo(
        options.chainList,
        publicClientList,
        input.data.toChainId,
        input.data.toTokenAddress
      ),
  ]);

  // Reserve a representative gas amount out of native balances before source selection, so the
  // router never sizes a swap against native it needs to execute. Applied here — the single swap
  // source-sizing chokepoint — regardless of whether balances were preloaded (composite flow
  // passes raw, keeping actual values for its own destination-gas shortfall) or freshly fetched.
  const reserved = await deductSwapNativeReserveFees(options.chainList, rawBalances);
  const balances = selectSwapSources(reserved, input.data.toChainId, input.data.toTokenAddress);

  const candidateChainIds = getCandidateChainIds(input, balances);
  const walletPathHints = new Map<number, WalletPath>(
    candidateChainIds.map((chainId) => {
      const chain = options.chainList.getChainByID(chainId);
      return [chainId, resolveWalletPath(chainSupports7702(chain))];
    })
  );

  logger.debug('swap.preflight.operation.completed', {
    toChainId: input.data.toChainId,
    balanceCount: balances.length,
    candidateChainIds,
    walletPathHints: Array.from(walletPathHints.entries()),
  });

  return {
    aggregators,
    balances,
    dstTokenInfo,
    oraclePrices,
    publicClientList,
    walletPathHints,
  };
};
