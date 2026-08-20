import type { Abi, Hex } from 'viem';
import { z } from 'zod';
import { Errors } from '../domain/errors';
import type {
  ExecutableIntentQuote,
  IntentBalancesResult,
  IntentChain,
  IntentHistoryResult,
  IntentPlanStep,
  IntentProvider,
  IntentSourceVerdict,
  IntentStatus,
  IntentSubmitResponse,
  IntentTokenCatalogEntry,
} from './types';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const amount = z.string().regex(/^\d+$/);
const provider = z.enum(['nexus-v2', 'mayan']);
const providerSupport = z.object({ id: provider, currencyId: z.number().int().optional() });
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
});
const chain = z
  .object({
    chainId: z.string(),
    name: z.string(),
    logo: z.string().optional(),
    explorerUrl: z.string().optional(),
    rpcUrl: z.string().optional(),
    nativeCurrency,
    providers: z.array(provider).optional(),
    asSource: z.array(provider).optional(),
    asDestination: z.array(provider).optional(),
    tokens: z.array(chainToken),
  })
  .passthrough();
const tokenDeployment = z.object({
  universe: z.literal('EVM'),
  chainId: z.string(),
  address,
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  isNative: z.boolean(),
  providers: z.array(providerSupport),
  asSource: z.array(providerSupport).optional().default([]),
  asDestination: z.array(providerSupport).optional().default([]),
});
const tokenCatalogEntry = z.object({
  assetId: z.string(),
  symbol: z.string(),
  name: z.string(),
  logo: z.string().optional(),
  coingeckoId: z.string().optional(),
  chains: z.array(tokenDeployment),
});
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
  priceSource: z.enum(['oracle', 'indexer']).nullable(),
  usable: z.boolean(),
});
const balances = z.object({ balances: z.array(balance), errored: z.boolean() });
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
      depositFee: amount,
      totalRequired: amount,
    })
  ),
  output: z.object({ chainId: z.string(), tokenAddress: address, amount }),
  minAmountOut: amount,
  fees: z.object({
    deposit: amount,
    fulfillment: amount,
    protocol: amount,
    solver: amount,
    caGas: amount,
  }),
  expiry: amount,
  rff: z.record(z.string(), z.unknown()),
  rffHash: hash,
  signing: z.object({
    type: z.literal('personal_sign'),
    messagePrefix: z.string(),
    message: bytes,
    hash,
  }),
  allowances: z.array(
    z.object({
      chainId: z.number().int().positive(),
      tokenAddress: address,
      spender: address,
      owner: address,
      current: amount,
      required: amount,
      deficit: amount,
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
    requiresIntentSignature: z.boolean(),
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
const historyResponse = z.object({
  rffs: z.array(
    z
      .object({
        request_hash: hash,
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

export const normalizeIntentChains = (input: unknown): IntentChain[] =>
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
      tokens: entry.tokens.map((token) => ({
        ...token,
        chainId: id,
        address: normalizedAddress(token.address),
        providers: uniqueProviders([
          ...(token.asSource ?? []),
          ...(token.asDestination ?? []),
          ...(token.providers ?? []),
        ]),
        asSource: token.asSource ?? token.providers ?? [],
        asDestination: token.asDestination ?? token.providers ?? [],
      })),
      capabilities: { intent: true, execute: false },
    };
  });

export const normalizeIntentTokens = (input: unknown): IntentTokenCatalogEntry[] =>
  parse(z.array(tokenCatalogEntry), input, 'Better Intent tokens response').map((entry) => ({
    ...entry,
    chains: entry.chains.map((deployment) => ({
      ...deployment,
      chainId: parseIntentChainRef(deployment.chainId),
      address: normalizedAddress(deployment.address),
    })),
  }));

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
  const allowances = parsed.allowances.map((entry) => ({
    chainId: entry.chainId,
    tokenAddress: normalizedAddress(entry.tokenAddress),
    spender: normalizedAddress(entry.spender),
    owner: normalizedAddress(entry.owner),
    currentRaw: BigInt(entry.current),
    requiredRaw: BigInt(entry.required),
    deficitRaw: BigInt(entry.deficit),
    approval: entry.approval
      ? {
          ...entry.approval,
          to: normalizedAddress(entry.approval.to),
          data: entry.approval.data as Hex,
        }
      : undefined,
  }));
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
          type: 'erc20_approval',
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
        depositFeeRaw: BigInt(entry.depositFee),
        totalRequiredRaw: BigInt(entry.totalRequired),
      })),
      output: {
        chainId: parseIntentChainRef(parsed.output.chainId),
        tokenAddress: normalizedAddress(parsed.output.tokenAddress),
        amountRaw: BigInt(parsed.output.amount),
        minAmountRaw: BigInt(parsed.minAmountOut),
      },
      fees: {
        depositRaw: BigInt(parsed.fees.deposit),
        fulfillmentRaw: BigInt(parsed.fees.fulfillment),
        protocolRaw: BigInt(parsed.fees.protocol),
        solverRaw: BigInt(parsed.fees.solver),
        caGasRaw: BigInt(parsed.fees.caGas),
      },
      expiresAt: Number(parsed.expiry),
      allowances: allowances.map(({ approval: _approval, ...entry }) => entry),
      plan: { steps },
      sourceVerdicts: normalizeIntentSourceVerdicts(parsed.sourceVerdicts),
    },
    execution: {
      provider: parsed.provider,
      rff: parsed.rff,
      signing: {
        type: parsed.signing.type,
        message: parsed.signing.message as Hex,
        hash: parsed.signing.hash as Hex,
      },
      allowances,
      nativeTransactions,
    },
  };
};

export const normalizeIntentSubmitResponse = (input: unknown): IntentSubmitResponse => {
  const parsed = parse(submitResponse, input, 'Better Intent submit response');
  return { quoteId: parsed.quoteId as Hex, status: parsed.status };
};

export const normalizeIntentStatus = (input: unknown): IntentStatus => {
  const parsed = parse(statusResponse, input, 'Better Intent status response');
  return {
    id: parsed.quoteId as Hex,
    provider: parsed.provider,
    status: parsed.status,
    substatus: parsed.substatus,
  };
};

export const normalizeIntentHistory = (
  input: unknown,
  providerId: IntentProvider
): IntentHistoryResult => {
  const parsed = parse(historyResponse, input, 'Better Intent history response');
  return {
    total: parsed.total,
    intents: parsed.rffs.map((entry) => ({
      id: entry.request_hash as Hex,
      provider: providerId,
      status: entry.status,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    })),
  };
};
