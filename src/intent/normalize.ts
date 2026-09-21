import type { Abi, Hex } from 'viem';
import { z } from 'zod';
import { Errors } from '../domain/errors';
import type {
  ExecutableIntentQuote,
  IntentBalancesResult,
  IntentChain,
  IntentHistoryResult,
  IntentLegStatus,
  IntentPlanStep,
  IntentProvider,
  IntentRequiredSignature,
  IntentSourceVerdict,
  IntentStatus,
  IntentSubmitResponse,
} from './types';
import { INTENT_PROVIDERS } from './types';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const amount = z.string().regex(/^\d+$/);
const usdAmount = z.string().regex(/^\d+(?:\.\d+)?$/);
const provider = z.enum(INTENT_PROVIDERS);
const providerSupport = z.object({
  id: provider,
  currencyId: z.union([z.number().int(), z.string()]).optional(),
});
const sourceVerdict = z.object({
  chainId: z.string(),
  tokenAddress: address,
  tokenSymbol: z.string(),
  state: z.enum(['selected', 'unused', 'unroutable']),
  reason: z
    .enum([
      'BELOW_DEPOSIT_FEE',
      'INSUFFICIENT_APPROVAL_GAS',
      'ABOVE_PROVIDER_CEILING',
      'CURRENCY_MISMATCH',
      'NOT_IN_PROVIDER_CATALOG',
      'PROVIDER_REFUSED',
    ])
    .optional(),
  detail: z.string().optional(),
});
const nativeCurrency = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  logo: z.string().optional(),
  coingeckoId: z.string().optional(),
});
const chainToken = z.object({
  universe: z.literal('EVM'),
  chainId: z.string().regex(/^EVM_[1-9]\d*$/),
  address,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  isNative: z.boolean(),
  logo: z.string().optional(),
  coingeckoId: z.string().optional(),
  providers: z.array(providerSupport).optional(),
  asSource: z.array(providerSupport).optional(),
  asDestination: z.array(providerSupport).optional(),
  permit: z
    .object({
      variant: z.enum(['eip2612', 'emt']),
      version: z.string().optional(),
    })
    .optional(),
  sponsoredApproval: z.boolean(),
});
const tokenPage = z.object({
  tokens: z.array(chainToken),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(1000),
  total: z.number().int().nonnegative(),
});
const chain = z
  .object({
    chainId: z.string(),
    name: z.string(),
    logo: z.string().optional(),
    explorerUrl: z.url().optional(),
    rpcUrl: z.url().optional(),
    vaultAddress: address.optional(),
    multicallAddress: address.optional(),
    sponsored: z.boolean().optional(),
    eip7702Enabled: z.boolean().optional(),
    swapSupported: z.boolean().optional(),
    nativeCurrency,
    providers: z.array(provider).optional(),
    asSource: z.array(provider).optional(),
    asDestination: z.array(provider).optional(),
  })
  .passthrough();
const balance = z.object({
  universe: z.literal('EVM'),
  chainId: z.string(),
  address,
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  isNative: z.boolean(),
  logo: z.string().optional(),
  coingeckoId: z.string().optional(),
  providers: z.array(providerSupport),
  balance: amount,
  valueUsd: z.number().nullable(),
  priceSource: z.enum(['oracle', 'indexer', 'coingecko', 'relay']).nullable(),
  usable: z.boolean(),
});
const balances = z.object({ balances: z.array(balance), errored: z.boolean() });
const requiredSignature = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('intent'),
    universe: z.literal('EVM'),
    signingScheme: z.literal('personal_sign'),
    data: z.object({ messagePrefix: z.string(), message: bytes, hash }),
  }),
  z.object({
    kind: z.literal('sourceApproval'),
    universe: z.literal('EVM'),
    chainId: z.number().int().positive(),
    tokenAddress: address,
    signingScheme: z.literal('eip712'),
    data: z.object({
      domain: z.object({
        name: z.string(),
        version: z.string(),
        chainId: z.number().int().positive().optional(),
        verifyingContract: address,
        salt: hash.optional(),
      }),
      types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
      primaryType: z.enum(['Permit', 'MetaTransaction']),
      message: z.record(z.string(), z.string()),
    }),
  }),
]);
const quote = z.object({
  quoteId: hash,
  provider,
  tradeType: z.enum(['exactInput', 'exactOutput']),
  input: z.array(
    z.object({
      chainId: z.string(),
      tokenAddress: address,
      tokenSymbol: z.string(),
      amount,
      amountUsd: usdAmount,
      depositFee: amount,
      depositFeeUsd: usdAmount,
      totalRequired: amount,
      totalRequiredUsd: usdAmount,
    })
  ),
  output: z.object({ chainId: z.string(), tokenAddress: address, amount, amountUsd: usdAmount }),
  minAmountOut: amount,
  minAmountOutUsd: usdAmount,
  fees: z.object({
    deposit: amount,
    depositUsd: usdAmount,
    fulfillment: amount,
    fulfillmentUsd: usdAmount,
    protocol: amount,
    protocolUsd: usdAmount,
    solver: amount,
    solverUsd: usdAmount,
  }),
  expiry: amount,
  rff: z.record(z.string(), z.unknown()),
  rffHash: hash,
  allowances: z.array(
    z.object({
      chainId: z.number().int().positive(),
      tokenAddress: address,
      spender: address,
      owner: address,
      current: amount,
      required: amount,
      deficit: amount,
      authorizationType: z.enum(['approve', 'permit']).optional(),
      approval: z
        .object({
          type: z.literal('erc20_approve'),
          to: address,
          data: bytes,
          value: z.literal('0'),
        })
        .optional(),
    })
  ),
  nativeTransactions: z.array(
    z
      .object({
        chainId: z.number().int().positive(),
        sourceIndex: z.number().int().nonnegative(),
        kind: z.literal('native_source_deposit'),
        to: address,
        value: amount,
        functionName: z.enum(['deposit', 'depositRouter']),
        abi: z.array(z.unknown()),
        vaultRequest: z.record(z.string(), z.unknown()),
        payload: bytes.optional(),
      })
      .passthrough()
  ),
  submitRequirements: z.object({
    requiredSignatures: z.array(requiredSignature),
    requiresApprovals: z.boolean(),
    requiresNativeTxReceipts: z.boolean(),
  }),
  sourceVerdicts: z.array(sourceVerdict).default([]),
});
const lifecycleStatus = z.enum(['created', 'deposited', 'fulfilled', 'expired']);
const submitResponse = z.object({ quoteId: hash, status: lifecycleStatus });
const statusResponse = z.object({
  quoteId: hash,
  provider,
  status: lifecycleStatus,
  substatus: z.string(),
  rff: z.record(z.string(), z.unknown()),
});
const intentDetailResponse = z.object({
  legs: z.array(
    z
      .object({
        sourceIndex: z.number().int().nonnegative(),
        status: lifecycleStatus,
        txHash: hash.nullish(),
        explorerLink: z.string().nullish(),
        protocolExplorerLink: z.string().nullish(),
        error: z.string().nullish(),
      })
      .passthrough()
  ),
});
const historyResponse = z.object({
  rffs: z.array(
    z
      .object({
        request_hash: hash,
        provider: provider.optional(),
        status: lifecycleStatus,
        created_at: z.number().optional(),
        updated_at: z.number().optional(),
      })
      .passthrough()
  ),
  total: z.number().int().nonnegative(),
});

const parse = <T>(schema: z.ZodType<T>, input: unknown, label: string): T => {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw Errors.backend(`Invalid ${label}: ${z.prettifyError(result.error)}`, {
    service: 'middleware',
  });
};

export const parseIntentChainRef = (value: string): number => {
  const match = /^EVM_([1-9]\d*)$/.exec(value);
  if (!match) throw new Error(`Invalid Better Intent chain reference: ${value}`);
  return Number(match[1]);
};

const normalizedAddress = (value: string): Hex => value.toLowerCase() as Hex;
const uniqueProviders = <T extends { id: IntentProvider }>(items: T[]): T[] => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];

export const normalizeIntentSourceVerdicts = (input: unknown): IntentSourceVerdict[] =>
  parse(z.array(sourceVerdict), input, 'Better Intent source verdicts').map((entry) => ({
    ...entry,
    chainId: parseIntentChainRef(entry.chainId),
    tokenAddress: normalizedAddress(entry.tokenAddress),
  }));

export const normalizeIntentChains = (input: unknown): Omit<IntentChain, 'tokens'>[] =>
  parse(z.array(chain), input, 'Better Intent chains response').map((entry) => {
    let id: number;
    try {
      id = parseIntentChainRef(entry.chainId);
    } catch (error) {
      throw Errors.backend(`Invalid Better Intent chains response: ${String(error)}`, {
        service: 'middleware',
      });
    }
    return {
      id,
      name: entry.name,
      logo: entry.logo,
      explorerUrl: entry.explorerUrl,
      rpcUrl: entry.rpcUrl,
      vaultAddress: entry.vaultAddress ? normalizedAddress(entry.vaultAddress) : undefined,
      multicallAddress: entry.multicallAddress
        ? normalizedAddress(entry.multicallAddress)
        : undefined,
      sponsored: entry.sponsored,
      eip7702Enabled: entry.eip7702Enabled,
      swapSupported: entry.swapSupported,
      nativeCurrency: entry.nativeCurrency,
      providers: [
        ...new Set([
          ...(entry.asSource ?? []),
          ...(entry.asDestination ?? []),
          ...(entry.providers ?? []),
        ]),
      ],
      asSource: entry.asSource ?? entry.providers ?? [],
      asDestination: entry.asDestination ?? entry.providers ?? [],
      capabilities: { intent: true, execute: !!entry.rpcUrl && !!entry.multicallAddress },
    };
  });

export const normalizeIntentTokens = (input: unknown) => {
  const parsed = parse(tokenPage, input, 'Better Intent tokens response');
  return {
    ...parsed,
    tokens: parsed.tokens.map(({ universe: _universe, ...token }) => ({
      ...token,
      chainId: parseIntentChainRef(token.chainId),
      address: normalizedAddress(token.address),
      providers: uniqueProviders([
        ...(token.asSource ?? []),
        ...(token.asDestination ?? []),
        ...(token.providers ?? []),
      ]),
      asSource: token.asSource ?? token.providers ?? [],
      asDestination: token.asDestination ?? token.providers ?? [],
    })),
  };
};

export const normalizeIntentBalances = (input: unknown): IntentBalancesResult => {
  const parsed = parse(balances, input, 'Better Intent balances response');
  return {
    errored: parsed.errored,
    balances: parsed.balances.map((entry) => ({
      chainId: parseIntentChainRef(entry.chainId),
      tokenAddress: normalizedAddress(entry.address),
      name: entry.name,
      symbol: entry.symbol,
      decimals: entry.decimals,
      isNative: entry.isNative,
      logo: entry.logo,
      coingeckoId: entry.coingeckoId,
      providers: entry.providers,
      balanceRaw: BigInt(entry.balance),
      valueUsd: entry.valueUsd,
      priceSource: entry.priceSource,
      usable: entry.usable,
    })),
  };
};

export const normalizeIntentQuote = (input: unknown): ExecutableIntentQuote => {
  const parsed = parse(quote, input, 'Better Intent quote response');
  const requiredSignatures: IntentRequiredSignature[] =
    parsed.submitRequirements.requiredSignatures.map((signature) =>
      signature.kind === 'intent'
        ? {
            ...signature,
            data: {
              ...signature.data,
              message: signature.data.message as Hex,
              hash: signature.data.hash as Hex,
            },
          }
        : {
            ...signature,
            tokenAddress: normalizedAddress(signature.tokenAddress),
            data: {
              ...signature.data,
              domain: {
                ...signature.data.domain,
                verifyingContract: normalizedAddress(signature.data.domain.verifyingContract),
                salt: signature.data.domain.salt as Hex | undefined,
              },
            },
          }
    );
  const allowances = parsed.allowances.map((entry) => ({
    chainId: entry.chainId,
    tokenAddress: normalizedAddress(entry.tokenAddress),
    spender: normalizedAddress(entry.spender),
    owner: normalizedAddress(entry.owner),
    currentRaw: BigInt(entry.current),
    requiredRaw: BigInt(entry.required),
    deficitRaw: BigInt(entry.deficit),
    authorizationType: entry.authorizationType,
    approval: entry.approval
      ? {
          ...entry.approval,
          to: normalizedAddress(entry.approval.to),
          data: entry.approval.data as Hex,
        }
      : undefined,
  }));
  const intentSignatures = requiredSignatures.filter((entry) => entry.kind === 'intent');
  const approvalSignatures = requiredSignatures.filter((entry) => entry.kind === 'sourceApproval');
  if (intentSignatures.length !== 1 || intentSignatures[0]?.data.hash !== parsed.rffHash) {
    throw Errors.backend('Invalid Better Intent intent signature requirements', {
      service: 'middleware',
    });
  }
  for (const signature of approvalSignatures) {
    const allowance = allowances.find(
      (entry) =>
        entry.chainId === signature.chainId && entry.tokenAddress === signature.tokenAddress
    );
    if (
      !allowance ||
      allowance.authorizationType !== 'permit' ||
      allowance.deficitRaw <= 0n ||
      signature.data.domain.verifyingContract !== signature.tokenAddress ||
      (signature.data.domain.chainId !== undefined &&
        signature.data.domain.chainId !== signature.chainId)
    ) {
      throw Errors.backend('Invalid Better Intent source approval signature requirements', {
        service: 'middleware',
      });
    }
  }
  for (const allowance of allowances.filter(
    (entry) => entry.deficitRaw > 0n && entry.authorizationType === 'permit'
  )) {
    if (
      approvalSignatures.filter(
        (entry) =>
          entry.chainId === allowance.chainId && entry.tokenAddress === allowance.tokenAddress
      ).length !== 1
    ) {
      throw Errors.backend('Invalid Better Intent source approval signature count', {
        service: 'middleware',
      });
    }
  }
  const nativeTransactions = parsed.nativeTransactions.map((entry) => ({
    chainId: entry.chainId,
    sourceIndex: entry.sourceIndex,
    kind: entry.kind,
    to: normalizedAddress(entry.to),
    valueRaw: BigInt(entry.value),
    functionName: entry.functionName,
    abi: entry.abi as Abi,
    vaultRequest: entry.vaultRequest,
    payload: entry.payload as Hex | undefined,
  }));
  const steps: IntentPlanStep[] = [
    ...allowances
      .filter((entry) => entry.deficitRaw > 0n)
      .map(
        (entry): IntentPlanStep => ({
          id: `approval:${entry.chainId}:${entry.tokenAddress}`,
          type:
            entry.authorizationType === 'permit' ? 'source_approval_signature' : 'erc20_approval',
          chainId: entry.chainId,
          tokenAddress: entry.tokenAddress,
          spender: entry.spender,
          amountRaw: entry.requiredRaw,
        })
      ),
    { id: 'intent-signature', type: 'intent_signature' },
    ...nativeTransactions.map(
      (entry): IntentPlanStep => ({
        id: `native:${entry.chainId}:${entry.sourceIndex}`,
        type: 'native_transaction',
        chainId: entry.chainId,
        sourceIndex: entry.sourceIndex,
        to: entry.to,
        valueRaw: entry.valueRaw,
      })
    ),
    { id: 'intent-submission', type: 'intent_submission' },
    { id: 'intent-fulfillment', type: 'intent_fulfillment' },
  ];

  return {
    quote: {
      id: parsed.quoteId as Hex,
      provider: parsed.provider,
      tradeType: parsed.tradeType,
      input: parsed.input.map((entry) => ({
        chainId: parseIntentChainRef(entry.chainId),
        tokenAddress: normalizedAddress(entry.tokenAddress),
        tokenSymbol: entry.tokenSymbol,
        amountRaw: BigInt(entry.amount),
        amountUsd: entry.amountUsd,
        depositFeeRaw: BigInt(entry.depositFee),
        depositFeeUsd: entry.depositFeeUsd,
        totalRequiredRaw: BigInt(entry.totalRequired),
        totalRequiredUsd: entry.totalRequiredUsd,
      })),
      output: {
        chainId: parseIntentChainRef(parsed.output.chainId),
        tokenAddress: normalizedAddress(parsed.output.tokenAddress),
        amountRaw: BigInt(parsed.output.amount),
        amountUsd: parsed.output.amountUsd,
        minAmountRaw: BigInt(parsed.minAmountOut),
        minAmountUsd: parsed.minAmountOutUsd,
      },
      fees: {
        depositRaw: BigInt(parsed.fees.deposit),
        depositUsd: parsed.fees.depositUsd,
        fulfillmentRaw: BigInt(parsed.fees.fulfillment),
        fulfillmentUsd: parsed.fees.fulfillmentUsd,
        protocolRaw: BigInt(parsed.fees.protocol),
        protocolUsd: parsed.fees.protocolUsd,
        solverRaw: BigInt(parsed.fees.solver),
        solverUsd: parsed.fees.solverUsd,
      },
      expiresAt: Number(parsed.expiry),
      allowances: allowances.map(({ approval: _approval, ...entry }) => entry),
      plan: { steps },
      sourceVerdicts: normalizeIntentSourceVerdicts(parsed.sourceVerdicts),
    },
    execution: {
      provider: parsed.provider,
      rff: parsed.rff,
      requiredSignatures,
      allowances,
      nativeTransactions,
    },
  };
};

export const normalizeIntentSubmitResponse = (input: unknown): IntentSubmitResponse => {
  const parsed = parse(submitResponse, input, 'Better Intent submit response');
  return { quoteId: parsed.quoteId as Hex, status: parsed.status };
};

export const normalizeIntentLegStatuses = (input: unknown): IntentLegStatus[] => {
  const parsed = parse(intentDetailResponse, input, 'Better Intent detail response');
  return parsed.legs.map((leg) => ({
    sourceIndex: leg.sourceIndex,
    status: leg.status,
    ...(leg.txHash ? { txHash: leg.txHash as Hex } : {}),
    ...(leg.explorerLink ? { txExplorerUrl: leg.explorerLink } : {}),
    ...(leg.protocolExplorerLink ? { protocolExplorerUrl: leg.protocolExplorerLink } : {}),
    ...(leg.error ? { error: leg.error } : {}),
  }));
};

export const normalizeIntentStatus = (input: unknown, detail: unknown): IntentStatus => {
  const parsed = parse(statusResponse, input, 'Better Intent status response');
  return {
    id: parsed.quoteId as Hex,
    provider: parsed.provider,
    status: parsed.status,
    substatus: parsed.substatus,
    legs: normalizeIntentLegStatuses(detail),
  };
};

export const normalizeIntentHistory = (
  input: unknown,
  fallbackProvider?: IntentProvider
): IntentHistoryResult => {
  const parsed = parse(historyResponse, input, 'Better Intent history response');
  return {
    total: parsed.total,
    intents: parsed.rffs.map((entry) => ({
      id: entry.request_hash as Hex,
      ...((entry.provider ?? fallbackProvider)
        ? { provider: entry.provider ?? fallbackProvider }
        : {}),
      status: entry.status,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    })),
  };
};
