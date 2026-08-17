import { formatUnits } from 'viem';
import type {
  BridgeFillStep,
  Chain,
  ChainListType,
  PlanTokenAmount,
  PlanTokenMetadata,
  SwapBridgeDepositStep,
  SwapBridgeIntentSubmissionStep,
  SwapDestinationSwapStep,
  SwapEoaToEphemeralTransferStep,
  SwapPlan,
  SwapPlanStep,
  SwapSourceSwapStep,
} from '../domain';
import { mulDecimals } from '../services/math';
import {
  createBridgeDepositStepId,
  createBridgeFillStepId,
  createBridgeIntentSubmissionStepId,
  createDestinationSwapStepId,
  createEoaToEphemeralTransferStepId,
  createSourceSwapStepId,
} from '../services/step-ids';
import type { QuoteResponse } from './aggregators/types';
import { isEoaBridgeRoute, type SwapRoute } from './types';

const toPlanTokenAmount = (
  metadata: PlanTokenMetadata,
  amountRaw: bigint,
  humanAmount?: string
): PlanTokenAmount => ({
  ...metadata,
  amount: humanAmount ?? formatUnits(amountRaw, metadata.decimals),
  amountRaw: amountRaw,
});

const toChainDisplay = (chain: Chain) => {
  const {
    id,
    name,
    custom: { icon: logo },
  } = chain;
  return {
    id,
    name,
    logo,
  };
};

const groupSourceSwapsByChain = (route: SwapRoute): Map<number, QuoteResponse[]> => {
  const grouped = new Map<number, QuoteResponse[]>();
  for (const quote of route.source.swaps) {
    const entries = grouped.get(quote.chainID);
    if (entries) {
      entries.push(quote);
    } else {
      grouped.set(quote.chainID, [quote]);
    }
  }
  return new Map([...grouped.entries()].sort(([left], [right]) => left - right));
};

const createSourceSwapStep = (
  chainList: ChainListType,
  chainId: number,
  quotesResponse: QuoteResponse[]
): SwapSourceSwapStep => {
  const swapSourceSwapStep: SwapSourceSwapStep = {
    type: 'source_swap',
    id: createSourceSwapStepId(chainId),
    chain: toChainDisplay(chainList.getChainByID(chainId)),
    walletPath: 'safe',
    swaps: [],
  };

  for (const response of quotesResponse) {
    swapSourceSwapStep.swaps.push({
      input: response.quote.input,
      output: response.quote.output,
    });
  }

  return swapSourceSwapStep;
};

const createBridgeTransferStep = (
  chainList: ChainListType,
  asset: NonNullable<SwapRoute['bridge']>['assets'][number]
): SwapEoaToEphemeralTransferStep => {
  const amountRaw = mulDecimals(asset.eoaBalance, asset.decimals);
  const { chain, token } = chainList.getChainAndTokenByAddress(
    asset.chainID,
    asset.contractAddress
  );

  return {
    type: 'eoa_to_ephemeral_transfer',
    id: createEoaToEphemeralTransferStepId(asset.chainID),
    chain: toChainDisplay(chain),
    asset: toPlanTokenAmount(token, amountRaw, asset.eoaBalance.toFixed(asset.decimals)),
  };
};

const createBridgeDepositStep = (
  chainList: ChainListType,
  asset: NonNullable<SwapRoute['bridge']>['assets'][number]
): SwapBridgeDepositStep => {
  const amount = asset.eoaBalance.plus(asset.ephemeralBalance);
  const rawAmount = mulDecimals(amount, asset.decimals);

  const { chain, token } = chainList.getChainAndTokenByAddress(
    asset.chainID,
    asset.contractAddress
  );

  return {
    type: 'bridge_deposit',
    id: createBridgeDepositStepId(asset.chainID),
    chain: toChainDisplay(chain),
    asset: toPlanTokenAmount(
      {
        decimals: asset.decimals,
        symbol: token.symbol,
        contractAddress: asset.contractAddress,
      },
      rawAmount,
      amount.toFixed(asset.decimals)
    ),
  };
};

const createBridgeIntentSubmissionStep = (): SwapBridgeIntentSubmissionStep => ({
  type: 'bridge_intent_submission',
  id: createBridgeIntentSubmissionStepId(),
});

const createBridgeFillStep = (
  chainList: ChainListType,
  route: NonNullable<SwapRoute['bridge']>
): BridgeFillStep => {
  const { chain, token } = chainList.getChainAndTokenByAddress(route.chainID, route.tokenAddress);

  return {
    type: 'bridge_fill',
    id: createBridgeFillStepId(route.chainID),
    chain: toChainDisplay(chain),
    asset: toPlanTokenAmount(
      token,
      mulDecimals(route.amount, route.decimals),
      route.amount.toFixed(route.decimals)
    ),
  };
};

const createDestinationSwapStep = (
  chainList: ChainListType,
  route: SwapRoute
): SwapDestinationSwapStep | null => {
  const { tokenSwap, gasSwap } = route.destination.swap;
  if (!tokenSwap && !gasSwap) {
    return null;
  }

  // walletPath here is always a smart-account wrapper because a destination swap step only
  // exists when the destination aggregator runs inside one.
  const destinationChain = chainList.getChainByID(route.destination.chainId);
  const dstSwapStep: SwapDestinationSwapStep = {
    type: 'destination_swap',
    id: createDestinationSwapStepId(route.destination.chainId),
    chain: toChainDisplay(destinationChain),
    walletPath: 'safe',
    swaps: [],
  };

  if (tokenSwap) {
    dstSwapStep.swaps.push({
      input: tokenSwap.quote.input,
      output: tokenSwap.quote.output,
    });
  }
  if (gasSwap) {
    dstSwapStep.swaps.push({
      input: gasSwap.quote.input,
      output: gasSwap.quote.output,
    });
  }

  return dstSwapStep;
};

export const createSwapPlan = (route: SwapRoute, chainList: ChainListType): SwapPlan => {
  const steps: SwapPlanStep[] = [];

  for (const [chainId, quotes] of groupSourceSwapsByChain(route).entries()) {
    steps.push(createSourceSwapStep(chainList, chainId, quotes));
  }

  if (route.bridge) {
    const sortedAssets = [...route.bridge.assets].sort(
      (left, right) => left.chainID - right.chainID
    );
    steps.push(createBridgeIntentSubmissionStep());
    for (const asset of sortedAssets) {
      // Non-direct routes stage EOA bridge holdings on the ephemeral wallet. Direct routes deposit
      // from the EOA and therefore omit the custody-transfer step.
      if (!isEoaBridgeRoute(route) && asset.eoaBalance.gt(0)) {
        steps.push(createBridgeTransferStep(chainList, asset));
      }
      steps.push(createBridgeDepositStep(chainList, asset));
    }
    steps.push(createBridgeFillStep(chainList, route.bridge));
  }

  const destinationSwapStep = createDestinationSwapStep(chainList, route);
  if (destinationSwapStep) {
    steps.push(destinationSwapStep);
  }

  return {
    hasBridge: route.bridge !== null,
    hasDestinationSwap: destinationSwapStep !== null,
    steps,
  };
};

const findStep = <TStep extends SwapPlanStep>(
  plan: SwapPlan,
  predicate: (step: SwapPlanStep) => step is TStep,
  errorMessage: string
): TStep => {
  const step = plan.steps.find(predicate);
  if (!step) {
    throw new Error(errorMessage);
  }
  return step;
};

export const getSwapSourceSwapStep = (plan: SwapPlan, chainId: number): SwapSourceSwapStep =>
  findStep(
    plan,
    (step): step is SwapSourceSwapStep => step.type === 'source_swap' && step.chain.id === chainId,
    `Swap plan is missing source_swap step for chain ${chainId}`
  );

export const getSwapEoaToEphemeralTransferStep = (
  plan: SwapPlan,
  chainId: number
): SwapEoaToEphemeralTransferStep =>
  findStep(
    plan,
    (step): step is SwapEoaToEphemeralTransferStep =>
      step.type === 'eoa_to_ephemeral_transfer' && step.chain.id === chainId,
    `Swap plan is missing eoa_to_ephemeral_transfer step for chain ${chainId}`
  );

export const getSwapBridgeDepositStep = (plan: SwapPlan, chainId: number): SwapBridgeDepositStep =>
  findStep(
    plan,
    (step): step is SwapBridgeDepositStep =>
      step.type === 'bridge_deposit' && step.chain.id === chainId,
    `Swap plan is missing bridge_deposit step for chain ${chainId}`
  );

export const getSwapBridgeIntentSubmissionStep = (plan: SwapPlan): SwapBridgeIntentSubmissionStep =>
  findStep(
    plan,
    (step): step is SwapBridgeIntentSubmissionStep => step.type === 'bridge_intent_submission',
    'Swap plan is missing bridge_intent_submission step'
  );

export const getSwapBridgeFillStep = (plan: SwapPlan): BridgeFillStep =>
  findStep(
    plan,
    (step): step is BridgeFillStep => step.type === 'bridge_fill',
    'Swap plan is missing bridge_fill step'
  );

export const getSwapDestinationSwapStep = (
  plan: SwapPlan,
  chainId: number
): SwapDestinationSwapStep =>
  findStep(
    plan,
    (step): step is SwapDestinationSwapStep =>
      step.type === 'destination_swap' && step.chain.id === chainId,
    `Swap plan is missing destination_swap step for chain ${chainId}`
  );
