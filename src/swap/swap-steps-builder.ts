import { formatUnits, type Hex } from 'viem';
import type {
  BridgeFillStep,
  Chain,
  ChainListType,
  PlanTokenAmount,
  PlanTokenMetadata,
  SwapAllowanceStep,
  SwapBridgeDepositStep,
  SwapBridgeIntentSubmissionStep,
  SwapDestinationSwapStep,
  SwapEoaToEphemeralTransferStep,
  SwapPlan,
  SwapPlanStep,
  SwapSourceSwapStep,
} from '../domain';
import { isNativeAddress } from '../services/addresses';
import { mulDecimals } from '../services/math';
import {
  createBridgeDepositStepId,
  createBridgeFillStepId,
  createBridgeIntentSubmissionStepId,
  createDestinationSwapStepId,
  createEoaToEphemeralTransferStepId,
  createSourceSwapStepId,
  createSwapAllowanceStepId,
} from '../services/step-ids';
import type { QuoteResponse } from './aggregators/types';
import { groupSourceSwapsByChain, isNativeSourceSwap } from './source-order';
import { isEoaBridgeRoute, type SwapRoute } from './types';
import type { SwapCache } from './wallet/cache';
import { getTransferAuthorizationKind } from './wallet/transfer-authorization';

type SwapPlanAuthorizationContext = {
  cache: Pick<SwapCache, 'getAllowance' | 'getPermit'>;
  eoaAddress: Hex;
  safeAddress: Hex;
};

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
    submissionMode: quotesResponse.some(isNativeSourceSwap) ? 'eoa' : 'sponsored',
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

const createAllowanceStep = (
  chainList: ChainListType,
  context: SwapPlanAuthorizationContext,
  input: {
    reason: 'source' | 'destination' | 'bridge';
    chainId: number;
    tokenAddress: Hex;
    amountRaw: bigint;
    spender: Hex;
    permitAllowed?: boolean;
    token?: PlanTokenMetadata;
  }
): SwapAllowanceStep | null => {
  const kind = getTransferAuthorizationKind({
    cache: context.cache,
    tokenAddress: input.tokenAddress,
    ownerAddress: context.eoaAddress,
    spenderAddress: input.spender,
    chainId: input.chainId,
    amount: input.amountRaw,
    permitAllowed: input.permitAllowed,
  });
  if (!kind) return null;

  const token = input.token ?? chainList.getTokenByAddress(input.chainId, input.tokenAddress);
  return {
    type: 'allowance',
    id: createSwapAllowanceStepId(input.reason, input.chainId, input.tokenAddress),
    method: kind === 'approve' ? 'approval' : 'permit',
    chain: toChainDisplay(chainList.getChainByID(input.chainId)),
    token,
    spender: input.spender,
    amount: toPlanTokenAmount(token, input.amountRaw),
  };
};

const pushAllowanceStep = (
  steps: SwapPlanStep[],
  seenIds: Set<string>,
  step: SwapAllowanceStep | null
) => {
  if (!step || seenIds.has(step.id)) return;
  seenIds.add(step.id);
  steps.push(step);
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
  const amount = route.destinationGas ? route.amounts.tokenAmount : route.amount;

  return {
    type: 'bridge_fill',
    id: createBridgeFillStepId(route.chainID),
    chain: toChainDisplay(chain),
    asset: toPlanTokenAmount(
      token,
      mulDecimals(amount, route.decimals),
      amount.toFixed(route.decimals)
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

export const createSwapPlan = (
  route: SwapRoute,
  chainList: ChainListType,
  authorization?: SwapPlanAuthorizationContext
): SwapPlan => {
  const steps: SwapPlanStep[] = [];
  const allowanceIds = new Set<string>();

  for (const [chainId, quotes] of groupSourceSwapsByChain(route.source.swaps)) {
    if (authorization) {
      for (const quote of quotes) {
        if (isNativeSourceSwap(quote)) continue;
        pushAllowanceStep(
          steps,
          allowanceIds,
          createAllowanceStep(chainList, authorization, {
            reason: 'source',
            chainId,
            tokenAddress: quote.quote.input.contractAddress,
            amountRaw: quote.quote.input.amountRaw,
            spender: authorization.safeAddress,
            token: quote.quote.input,
          })
        );
      }
    }
    steps.push(createSourceSwapStep(chainList, chainId, quotes));
  }

  if (route.bridge) {
    const sortedAssets = [...route.bridge.assets].sort(
      (left, right) => left.chainID - right.chainID
    );
    const directEoaBridge = isEoaBridgeRoute(route);
    const bridgeAllowance = (asset: (typeof sortedAssets)[number]) => {
      if (!authorization || asset.eoaBalance.lte(0) || isNativeAddress(asset.contractAddress)) {
        return null;
      }
      const balance = route.extras.balances.find(
        (entry) =>
          entry.chainID === asset.chainID &&
          entry.tokenAddress.toLowerCase() === asset.contractAddress.toLowerCase()
      );
      return createAllowanceStep(chainList, authorization, {
        reason: 'bridge',
        chainId: asset.chainID,
        tokenAddress: asset.contractAddress,
        amountRaw: mulDecimals(asset.eoaBalance, asset.decimals),
        spender: directEoaBridge
          ? chainList.getVaultContractAddress(asset.chainID)
          : authorization.safeAddress,
        permitAllowed: !directEoaBridge || asset.chainID !== 1,
        token: balance
          ? {
              contractAddress: asset.contractAddress,
              decimals: balance.decimals,
              logo: balance.logo,
              symbol: balance.symbol,
            }
          : undefined,
      });
    };
    const appendBridgeAssetSteps = (assets: typeof sortedAssets, includeAllowance: boolean) => {
      for (const asset of assets) {
        if (includeAllowance) {
          pushAllowanceStep(steps, allowanceIds, bridgeAllowance(asset));
        }
        // Non-direct routes stage EOA bridge holdings on the ephemeral wallet. Direct routes
        // deposit from the EOA, while native value stays at the EOA until its payable deposit.
        if (!directEoaBridge && asset.eoaBalance.gt(0) && !isNativeAddress(asset.contractAddress)) {
          steps.push(createBridgeTransferStep(chainList, asset));
        }
        steps.push(createBridgeDepositStep(chainList, asset));
      }
    };

    if (route.bridge.provider === 'mayan' && !directEoaBridge) {
      appendBridgeAssetSteps(
        sortedAssets.filter((asset) => !isNativeAddress(asset.contractAddress)),
        true
      );
      steps.push(createBridgeIntentSubmissionStep());
      appendBridgeAssetSteps(
        sortedAssets.filter((asset) => isNativeAddress(asset.contractAddress)),
        false
      );
    } else {
      if (directEoaBridge) {
        for (const asset of sortedAssets) {
          pushAllowanceStep(steps, allowanceIds, bridgeAllowance(asset));
        }
      }
      steps.push(createBridgeIntentSubmissionStep());
      appendBridgeAssetSteps(sortedAssets, !directEoaBridge);
    }
    steps.push(createBridgeFillStep(chainList, route.bridge));
  }

  const destinationSwapStep = createDestinationSwapStep(chainList, route);
  if (destinationSwapStep) {
    const destinationTransfer = route.destination.eoaToEphemeral;
    if (authorization && destinationTransfer) {
      const destinationInput =
        route.destination.swap.tokenSwap?.quote.input ??
        route.destination.swap.gasSwap?.quote.input;
      pushAllowanceStep(
        steps,
        allowanceIds,
        createAllowanceStep(chainList, authorization, {
          reason: 'destination',
          chainId: route.destination.chainId,
          tokenAddress: destinationTransfer.contractAddress,
          amountRaw: destinationTransfer.amount,
          spender: authorization.safeAddress,
          token: destinationInput,
        })
      );
    }
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

export const getSwapAllowanceStep = (plan: SwapPlan, stepId: string): SwapAllowanceStep =>
  findStep(
    plan,
    (step): step is SwapAllowanceStep => step.type === 'allowance' && step.id === stepId,
    `Swap plan is missing allowance step ${stepId}`
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
