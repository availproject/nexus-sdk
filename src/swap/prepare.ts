import type { Hex, PublicClient, WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { ChainListType } from '../domain';
import { getLogger } from '../domain';
import { isNativeAddress } from '../services/addresses';
import { mulDecimals } from '../services/math';
import { parseQuote } from '../services/quote-parser';
import type { QuoteResponse } from './aggregators/types';
import { SWEEPER_ADDRESS } from './constants';
import { predictSafeAccountAddress } from './safe/predict';
import type {
  PreparedEoaToEphemeralTransfer,
  PreparedSwapExecution,
  PublicClientList,
  SwapRoute,
} from './types';
import type { SwapCache } from './wallet/cache';
import { chainSupports7702 } from './wallet/capabilities';
import { buildPreparedTransfer } from './wallet/prepared-transfer';

const logger = getLogger();

type PrepareSwapExecutionInput = {
  chainList: ChainListType;
  route: SwapRoute;
  source: SwapRoute['source'];
  destination: SwapRoute['destination'];
  eoaAddress: Hex;
  eoaWallet: WalletClient;
  ephemeralWallet: PrivateKeyAccount;
  publicClientList: PublicClientList;
  cache: SwapCache;
};

const getPublicClientMap = (
  chainIds: Set<number>,
  publicClientList: PublicClientList
): Record<number, Pick<PublicClient, 'multicall' | 'getCode' | 'readContract'>> => {
  return Object.fromEntries(
    [...chainIds].map((chainId) => [chainId, publicClientList.get(chainId)])
  );
};

const queueParsedQuoteQueries = (
  cache: SwapCache,
  quotes: QuoteResponse[],
  ownerForChain: (chainId: number) => Hex,
  ephemeralAddress: Hex,
  requiredChainIds: Set<number>
) => {
  for (const quote of quotes) {
    requiredChainIds.add(quote.chainID);
    const isNativeInput = isNativeAddress(quote.quote.input.contractAddress);

    if (!isNativeInput) {
      cache.addAllowanceQuery(
        quote.quote.input.contractAddress,
        ownerForChain(quote.chainID),
        quote.quote.txData.approvalAddress,
        quote.chainID
      );
    }

    cache.addSetCodeQuery(ephemeralAddress, quote.chainID);
  }
};

const queueDeterministicTransferQueries = (
  cache: SwapCache,
  transfers: Array<{ chainId: number; tokenAddress: Hex; amount: bigint; spender: Hex }>,
  eoaAddress: Hex,
  requiredChainIds: Set<number>
) => {
  for (const transfer of transfers) {
    requiredChainIds.add(transfer.chainId);
    if (isNativeAddress(transfer.tokenAddress)) {
      continue;
    }
    cache.addPermitQuery(transfer.tokenAddress, transfer.chainId);
    cache.addAllowanceQuery(transfer.tokenAddress, eoaAddress, transfer.spender, transfer.chainId);
    // A delegated (EIP-7702) funding EOA can't sign a usable EIP-2612 permit — ERC-1271 rejects
    // the raw digest — so fetch its code and let buildTransferAuthorization fall back to approve.
    cache.addSetCodeQuery(eoaAddress, transfer.chainId);
  }
};

const queueNativeSweepQueries = (
  cache: SwapCache,
  chainId: number,
  ephemeralAddress: Hex,
  requiredChainIds: Set<number>
) => {
  requiredChainIds.add(chainId);
  cache.addNativeAllowanceQuery(ephemeralAddress, SWEEPER_ADDRESS as Hex, chainId);
};

const getDestinationFundingTokenDecimals = (
  input: PrepareSwapExecutionInput,
  destinationQuotes: QuoteResponse[],
  eoaToEphemeralContractAddress: Hex
) =>
  destinationQuotes[0]?.quote.input.decimals ??
  input.chainList.getTokenByAddress(input.destination.chainId, eoaToEphemeralContractAddress)
    .decimals;

export const prepareSwapExecution = async (
  input: PrepareSwapExecutionInput
): Promise<PreparedSwapExecution> => {
  logger.debug('prepareSwapExecution:start', {
    sourceSwaps: input.source.swaps.length,
    hasBridge: input.route.bridge !== null,
    destinationChainId: input.destination.chainId,
  });

  const requiredChainIds = new Set<number>();
  const directDestinationExtras =
    input.route.directDestination === true ? input.route.extras.directDestination : undefined;
  const directDestinationExactOut = directDestinationExtras !== undefined;
  // Source-swap executor address. 'ephemeral' on 7702 chains, 'safe' on non-7702 — both run as
  // smart-account wrappers. Other path values aren't expected; we still default to the
  // ephemeral as a safe fallback so cache queries are valid.
  const ownerForSourceChain = (chainId: number) => {
    const path = input.route.sourceExecutionPaths.get(chainId);
    if (path === 'safe') {
      return predictSafeAccountAddress(input.ephemeralWallet.address).address;
    }
    return input.ephemeralWallet.address;
  };
  // Destination quote owner / funding target is the destination wrapper: the predicted Safe on
  // non-7702 chains, the ephemeral on 7702 chains. (The EOA only enters the route as the bridge
  // fill receiver in the COT-destination case, which doesn't need quote prep.)
  const destinationOwner = chainSupports7702(
    input.chainList.getChainByID(input.destination.chainId)
  )
    ? input.ephemeralWallet.address
    : predictSafeAccountAddress(input.ephemeralWallet.address).address;
  // Bridge deposit executor (= permit spender + transferFrom recipient): the predicted Safe on
  // non-7702 chains (the Safe runs the deposit batch and pulls the COT from itself), the ephemeral
  // on 7702 chains. Mirrors the deposit dispatch in execution/bridge.ts.
  const ownerForBridgeChain = (chainId: number) =>
    chainSupports7702(input.chainList.getChainByID(chainId))
      ? input.ephemeralWallet.address
      : predictSafeAccountAddress(input.ephemeralWallet.address).address;

  queueParsedQuoteQueries(
    input.cache,
    input.source.swaps,
    ownerForSourceChain,
    input.ephemeralWallet.address,
    requiredChainIds
  );

  const destinationQuotes = [
    input.destination.swap.tokenSwap,
    input.destination.swap.gasSwap,
  ].filter((quote): quote is QuoteResponse => quote !== null);
  queueParsedQuoteQueries(
    input.cache,
    destinationQuotes,
    () => destinationOwner,
    input.ephemeralWallet.address,
    requiredChainIds
  );

  queueDeterministicTransferQueries(
    input.cache,
    directDestinationExtras
      ? directDestinationExtras.dstHoldings
          .filter((holding) => !isNativeAddress(holding.tokenAddress))
          .map((holding) => ({
            chainId: holding.chainID,
            tokenAddress: holding.tokenAddress,
            amount: holding.amountRaw,
            spender: ownerForSourceChain(holding.chainID),
          }))
      : input.source.swaps
          .filter((swap) => {
            const path = input.route.sourceExecutionPaths.get(swap.chainID);
            return (
              (path === 'ephemeral' || path === 'safe') &&
              !isNativeAddress(swap.quote.input.contractAddress)
            );
          })
          .map((swap) => ({
            chainId: swap.chainID,
            tokenAddress: swap.quote.input.contractAddress,
            amount: swap.quote.input.amountRaw,
            spender: ownerForSourceChain(swap.chainID),
          })),
    input.eoaAddress,
    requiredChainIds
  );

  if (input.destination.eoaToEphemeral) {
    queueDeterministicTransferQueries(
      input.cache,
      [
        {
          chainId: input.destination.chainId,
          tokenAddress: input.destination.eoaToEphemeral.contractAddress,
          amount: input.destination.eoaToEphemeral.amount,
          spender: destinationOwner,
        },
      ],
      input.eoaAddress,
      requiredChainIds
    );
  }

  // Direct-COT bridge holdings always come from the EOA and need to be moved to the executor
  // before the deposit batch runs.
  if (input.route.bridge) {
    queueDeterministicTransferQueries(
      input.cache,
      input.route.bridge.assets
        .filter((asset) => !asset.eoaBalance.isZero() && !isNativeAddress(asset.contractAddress))
        .map((asset) => ({
          chainId: asset.chainID,
          tokenAddress: asset.contractAddress,
          amount: mulDecimals(asset.eoaBalance, asset.decimals),
          // Spender = the deposit executor: Safe on non-7702, ephemeral on 7702. Must match the
          // buildPreparedTransfer target below so the cached permit/allowance check is keyed right.
          spender: ownerForBridgeChain(asset.chainID),
        })),
      input.eoaAddress,
      requiredChainIds
    );
  }

  if (destinationQuotes.length > 0) {
    queueNativeSweepQueries(
      input.cache,
      input.destination.chainId,
      input.ephemeralWallet.address,
      requiredChainIds
    );
  }

  await input.cache.process(getPublicClientMap(requiredChainIds, input.publicClientList));

  const parsedQuotes = [
    ...input.source.swaps.map((quoteResponse) => ({
      ...parseQuote(quoteResponse.quote),
      chainId: quoteResponse.chainID,
      quote: quoteResponse.quote,
    })),
    ...destinationQuotes.map((quoteResponse) => ({
      ...parseQuote(quoteResponse.quote),
      chainId: quoteResponse.chainID,
      quote: quoteResponse.quote,
    })),
  ];

  const eoaToEphemeralTransfers: PreparedEoaToEphemeralTransfer[] = [];

  if (!directDestinationExactOut) {
    for (const swap of input.source.swaps) {
      const path = input.route.sourceExecutionPaths.get(swap.chainID);
      if (
        (path !== 'ephemeral' && path !== 'safe') ||
        isNativeAddress(swap.quote.input.contractAddress)
      ) {
        continue;
      }
      eoaToEphemeralTransfers.push(
        await buildPreparedTransfer({
          reason: 'source',
          chainId: swap.chainID,
          tokenAddress: swap.quote.input.contractAddress,
          tokenDecimals: swap.quote.input.decimals,
          amount: swap.quote.input.amountRaw,
          eagerPermit: false,
          targetAddress: ownerForSourceChain(swap.chainID),
          ...input,
        })
      );
    }
  }

  if (input.destination.eoaToEphemeral) {
    eoaToEphemeralTransfers.push(
      await buildPreparedTransfer({
        reason: 'destination',
        chainId: input.destination.chainId,
        tokenAddress: input.destination.eoaToEphemeral.contractAddress,
        tokenDecimals: getDestinationFundingTokenDecimals(
          input,
          destinationQuotes,
          input.destination.eoaToEphemeral.contractAddress
        ),
        amount: input.destination.eoaToEphemeral.amount,
        eagerPermit: true,
        targetAddress: destinationOwner,
        ...input,
      })
    );
  }

  if (input.route.bridge) {
    for (const asset of input.route.bridge.assets) {
      // Native bridge sources are EOA-submitted payable deposits — no EOA->ephemeral transfer.
      if (asset.eoaBalance.isZero() || isNativeAddress(asset.contractAddress)) continue;
      eoaToEphemeralTransfers.push(
        await buildPreparedTransfer({
          reason: 'bridge',
          chainId: asset.chainID,
          tokenAddress: asset.contractAddress,
          tokenDecimals: asset.decimals,
          amount: mulDecimals(asset.eoaBalance, asset.decimals),
          eagerPermit: false,
          targetAddress: ownerForBridgeChain(asset.chainID),
          ...input,
        })
      );
    }
  }

  logger.debug('prepareSwapExecution:complete', {
    parsedQuotes: parsedQuotes.length,
    transfers: eoaToEphemeralTransfers.length,
    queriedChains: [...requiredChainIds],
  });

  return {
    parsedQuotes,
    eoaToEphemeralTransfers,
  };
};
