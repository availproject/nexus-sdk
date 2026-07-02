import type { Hex } from 'viem';
import type {
  AllowanceHookSource,
  BridgeAllowanceApprovalStep,
  BridgeFillStep,
  BridgeIntentDraft,
  BridgePlan,
  BridgePlanStep,
  BridgeRequestSigningStep,
  BridgeRequestSubmissionStep,
  BridgeVaultDepositStep,
  Chain,
  ChainListType,
  PlanTokenAmount,
  TokenInfo,
} from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { convertAddressByUniverse } from '../services/addresses';
import { mulDecimals } from '../services/math';
import {
  createAllowanceApprovalStepId,
  createBridgeFillStepId,
  createRequestSigningStepId,
  createRequestSubmissionStepId,
  createVaultDepositStepId,
} from '../services/step-ids';
import { equalFold } from '../services/strings';

const normalizeBridgeTokenAddress = (tokenAddress: Hex): Hex =>
  convertAddressByUniverse(tokenAddress, Universe.ETHEREUM) as Hex;

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

const toTokenAmount = (token: TokenInfo, amount: string): PlanTokenAmount => ({
  ...token,
  amount,
  amountRaw: mulDecimals(amount, token.decimals),
});

const createAllowanceApprovalStep = (
  chainList: ChainListType,
  source: AllowanceHookSource
): BridgeAllowanceApprovalStep => ({
  type: 'allowance_approval',
  id: createAllowanceApprovalStepId(source.chain.id, source.token.contractAddress),
  chain: toChainDisplay(chainList.getChainByID(source.chain.id)),
  token: source.token,
  spender: chainList.getVaultContractAddress(source.chain.id),
  requiredAmount: source.allowance.minimum,
  requiredAmountRaw: source.allowance.minimumRaw.toString(),
});

const createVaultDepositStep = (
  chainList: ChainListType,
  source: BridgeIntentDraft['selectedSources'][number]
): BridgeVaultDepositStep => {
  const isNativeToken = equalFold(
    source.token.contractAddress,
    chainList.getNativeToken(source.chain.id).contractAddress
  );
  return {
    type: 'vault_deposit',
    id: createVaultDepositStepId(source.chain.id, source.token.contractAddress),
    chain: source.chain,
    asset: toTokenAmount(source.token, source.amount.toFixed(source.token.decimals)),
    assetType: isNativeToken ? 'native' : 'erc20',
    submissionMode: isNativeToken ? 'local_wallet' : 'middleware',
  };
};

const createBridgeFillStep = (intent: BridgeIntentDraft): BridgeFillStep => {
  return {
    type: 'bridge_fill',
    id: createBridgeFillStepId(intent.destination.chain.id),
    chain: intent.destination.chain,
    asset: toTokenAmount(
      intent.destination.token,
      intent.destination.amount.toFixed(intent.destination.token.decimals)
    ),
  };
};

export const createBridgePlan = (
  intent: BridgeIntentDraft,
  chainList: ChainListType,
  unallowedSources?: AllowanceHookSource[]
): BridgePlan => {
  const steps: BridgePlanStep[] = [];

  for (const source of unallowedSources ?? []) {
    steps.push(createAllowanceApprovalStep(chainList, source));
  }

  steps.push(
    {
      type: 'request_signing',
      id: createRequestSigningStepId(),
    } satisfies BridgeRequestSigningStep,
    {
      type: 'request_submission',
      id: createRequestSubmissionStepId(),
    } satisfies BridgeRequestSubmissionStep
  );

  for (const source of intent.selectedSources.filter(
    (entry) => entry.chain.id !== intent.destination.chain.id
  )) {
    steps.push(createVaultDepositStep(chainList, source));
  }

  steps.push(createBridgeFillStep(intent));

  return { steps };
};

export const getBridgeRequestSigningStep = (plan: BridgePlan): BridgeRequestSigningStep => {
  const step = plan.steps.find(
    (entry): entry is BridgeRequestSigningStep => entry.type === 'request_signing'
  );
  if (!step) {
    throw new Error('Bridge plan is missing request_signing step');
  }
  return step;
};

export const getBridgeRequestSubmissionStep = (plan: BridgePlan): BridgeRequestSubmissionStep => {
  const step = plan.steps.find(
    (entry): entry is BridgeRequestSubmissionStep => entry.type === 'request_submission'
  );
  if (!step) {
    throw new Error('Bridge plan is missing request_submission step');
  }
  return step;
};

export const getBridgeFillStep = (plan: BridgePlan): BridgeFillStep => {
  const step = plan.steps.find((entry): entry is BridgeFillStep => entry.type === 'bridge_fill');
  if (!step) {
    throw new Error('Bridge plan is missing bridge_fill step');
  }
  return step;
};

export const getBridgeAllowanceApprovalStep = (
  plan: BridgePlan,
  input: { chainId: number; tokenAddress: Hex }
): BridgeAllowanceApprovalStep => {
  const normalizedTokenAddress = normalizeBridgeTokenAddress(input.tokenAddress);
  const step = plan.steps.find(
    (entry): entry is BridgeAllowanceApprovalStep =>
      entry.type === 'allowance_approval' &&
      entry.chain.id === input.chainId &&
      equalFold(normalizeBridgeTokenAddress(entry.token.contractAddress), normalizedTokenAddress)
  );
  if (!step) {
    throw new Error(
      `Bridge plan is missing allowance_approval step for chain ${input.chainId}:${normalizedTokenAddress}`
    );
  }
  return step;
};

export const getBridgeVaultDepositStep = (
  plan: BridgePlan,
  input: { chainId: number; tokenAddress: Hex }
): BridgeVaultDepositStep => {
  const normalizedTokenAddress = normalizeBridgeTokenAddress(input.tokenAddress);
  const step = plan.steps.find(
    (entry): entry is BridgeVaultDepositStep =>
      entry.type === 'vault_deposit' &&
      entry.chain.id === input.chainId &&
      equalFold(normalizeBridgeTokenAddress(entry.asset.contractAddress), normalizedTokenAddress)
  );
  if (!step) {
    throw new Error(
      `Bridge plan is missing vault_deposit step for chain ${input.chainId}:${normalizedTokenAddress}`
    );
  }
  return step;
};
