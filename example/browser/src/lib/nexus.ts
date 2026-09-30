import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createNexusClient,
  NexusError,
  UserActionError,
  type IntentBalance,
  type IntentHookData,
  type IntentQuote,
  type SwapAndExecuteIntent,
  type NexusClient,
  type SpanProperties,
} from "@avail-project/nexus-core";
import { formatUnits } from "viem";
import { toast } from "sonner";
import { useConnection } from "wagmi";
import type { NetworkMode, SourceOption, TokenBalance } from "./types";
import { D, sum } from "./math";

/* ── View models for the existing intent modals ─────────────────── */

export type SwapIntentViewModel = {
  sources: Array<{
    chainId: number;
    chainName: string;
    chainLogo: string;
    tokenSymbol: string;
    amount: string;
    value: string;
  }>;
  sourcesTotal: string;
  destination: {
    chainId: number;
    chainName: string;
    chainLogo: string;
    tokenSymbol: string;
    amount: string;
    value: string;
    minAmount: string;
    minValue: string;
    gas?: { tokenSymbol: string; amount: string; value: string };
  };
  fees: {
    deposit: string;
    fulfillment: string;
    protocol: string;
    solver: string;
    total: string;
    fulfillmentIncludesProviderFees: boolean;
  };
};

export type ExecuteRequirementViewModel = {
  chainName: string;
  chainLogo?: string;
  contractAddress: string;
  token: { symbol: string; amount: string; value?: string };
  gas: { symbol: string; amount: string; value?: string; priceTier: string };
  nativeValue?: { amount: string; value?: string };
  tokenApproval?: { symbol: string; amount: string };
};

export type AvailableViewModel = {
  token: { amount: string; value?: string };
  gas: { amount: string; value?: string };
};

export type ShortfallViewModel = {
  token: { amount: string; value?: string };
  gas: { amount: string; value?: string };
};

export type SwapAndExecuteIntentViewModel = {
  kind: "swapAndExecute";
  executeRequirement: ExecuteRequirementViewModel;
  available: AvailableViewModel;
  swapRequired: boolean;
  shortfall?: ShortfallViewModel;
  swap?: SwapIntentViewModel;
};

/* ── API model → existing UI model adapters ─────────────────────── */

function findChain(client: NexusClient, chainId: number) {
  return client.getSupportedChains().find((chain) => chain.id === chainId);
}

function quoteFees(quote: IntentQuote) {
  // Mayan/Relay fulfillment includes protocol and solver costs. Nexus's protocol fee is separate.
  const fulfillmentIncludesProviderFees = quote.provider !== "nexus-v2";
  return {
    deposit: quote.fees.depositUsd,
    fulfillment: quote.fees.fulfillmentUsd,
    protocol: quote.fees.protocolUsd,
    solver: quote.fees.solverUsd,
    total: sum([
      quote.fees.depositUsd,
      quote.fees.fulfillmentUsd,
      ...(fulfillmentIncludesProviderFees ? [] : [quote.fees.protocolUsd, quote.fees.solverUsd]),
    ]).toFixed(),
    fulfillmentIncludesProviderFees,
  };
}

export async function mapSwapQuote(client: NexusClient, quote: IntentQuote): Promise<SwapIntentViewModel> {
  const [destinationToken, ...sourceTokens] = await Promise.all([quote.output, ...quote.input].map(
    (token) => client.getToken({ chainId: token.chainId, tokenAddress: token.tokenAddress }),
  ));
  const sources = quote.input.map((source, index) => {
    const chain = findChain(client, source.chainId);
    const amount = formatUnits(source.totalRequiredRaw, sourceTokens[index]!.decimals);
    return {
      chainId: source.chainId,
      chainName: chain?.name ?? `Chain ${source.chainId}`,
      chainLogo: chain?.logo ?? "",
      tokenSymbol: source.tokenSymbol,
      amount,
      value: source.totalRequiredUsd,
    };
  });
  const destinationChain = findChain(client, quote.output.chainId);
  const destinationAmount = formatUnits(quote.output.amountRaw, destinationToken!.decimals);

  return {
    sources,
    sourcesTotal: sum(sources.map((source) => source.value)).toFixed(),
    destination: {
      chainId: quote.output.chainId,
      chainName: destinationChain?.name ?? `Chain ${quote.output.chainId}`,
      chainLogo: destinationChain?.logo ?? "",
      tokenSymbol: destinationToken?.symbol ?? "Token",
      amount: destinationAmount,
      value: quote.output.amountUsd,
      minAmount: formatUnits(quote.output.minAmountRaw, destinationToken!.decimals),
      minValue: quote.output.minAmountUsd,
    },
    fees: quoteFees(quote),
  };
}

export async function mapCompositeIntent(
  client: NexusClient,
  intent: SwapAndExecuteIntent,
): Promise<SwapAndExecuteIntentViewModel> {
  const { executeRequirement: requirement, available, shortfall } = intent;
  const amount = (value: { amount: string; valueUsd?: string }) => ({
    amount: value.amount, value: value.valueUsd,
  });
  return {
    kind: "swapAndExecute",
    executeRequirement: {
      chainName: requirement.chain.name,
      chainLogo: requirement.chain.logo,
      contractAddress: requirement.to,
      token: { symbol: requirement.token.symbol, amount: requirement.token.amount, value: requirement.token.valueUsd },
      gas: { symbol: requirement.gas.symbol, ...amount(requirement.gas), priceTier: requirement.gas.priceTier },
      nativeValue: requirement.nativeValue ? amount(requirement.nativeValue) : undefined,
      tokenApproval: requirement.tokenApproval ? {
        symbol: requirement.tokenApproval.token.symbol, amount: requirement.tokenApproval.amount,
      } : undefined,
    },
    available: { token: amount(available.token), gas: amount(available.gas) },
    shortfall: { token: amount(shortfall.token), gas: amount(shortfall.gas) },
    swapRequired: intent.swapRequired,
    swap: intent.swapRequired ? await mapSwapQuote(client, intent.quote) : undefined,
  };
}

export function groupBalances(client: NexusClient, balances: IntentBalance[]): TokenBalance[] {
  const groups = new Map<string, TokenBalance>();

  for (const balance of balances) {
    const chain = findChain(client, balance.chainId);
    const readable = formatUnits(balance.balanceRaw, balance.decimals);
    const value = String(balance.valueUsd ?? 0);
    const key = balance.symbol.toLowerCase();
    const asset = groups.get(key) ?? {
      name: balance.name,
      symbol: balance.symbol,
      logo: balance.logo,
      balance: "0",
      value: "0",
      chainBalances: [],
    };
    asset.balance = D(asset.balance).plus(readable).toString();
    asset.value = D(asset.value).plus(value).toString();
    asset.chainBalances.push({
      balance: readable,
      value,
      decimals: balance.decimals,
      contractAddress: balance.tokenAddress,
      chain: {
        id: balance.chainId,
        name: chain?.name ?? `Chain ${balance.chainId}`,
        logo: chain?.logo ?? "",
      },
    });
    groups.set(key, asset);
  }

  return [...groups.values()];
}

export async function fetchUiBalances(client: NexusClient): Promise<TokenBalance[]> {
  const balances = await client.getBalances();
  return groupBalances(client, balances);
}

export function flattenBalances(assets: TokenBalance[]): SourceOption[] {
  return assets.flatMap((asset) =>
    asset.chainBalances
      .filter((entry) => D(entry.balance).gt(0))
      .map((entry) => ({
        id: `${entry.chain.id}:${entry.contractAddress.toLowerCase()}`,
        symbol: asset.symbol,
        tokenLogo: asset.logo,
        tokenName: asset.name,
        decimals: entry.decimals,
        chainId: entry.chain.id,
        chainName: entry.chain.name,
        chainLogo: entry.chain.logo,
        tokenAddress: entry.contractAddress,
        balance: entry.balance,
        value: entry.value,
      })),
  );
}

function trimErrorMessage(message: string): string {
  const firstParagraph = message.split(/\n\s*\n/)[0] ?? message;
  const firstLine = firstParagraph.split("\n")[0] ?? firstParagraph;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

export function logError(label: string, error: unknown) {
  console.error(`[${label}]`, error);
  if (error instanceof NexusError) {
    console.error(`[${label}] code:`, error.code);
    console.error(`[${label}] category:`, error.category);
    console.error(`[${label}] service:`, error.context.service);
    console.error(`[${label}] message:`, error.message);
    console.error(`[${label}] context:`, error.context);
    console.error(`[${label}] details:`, error.details);
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof UserActionError) return "Transaction cancelled in wallet.";
  if (error instanceof NexusError) return trimErrorMessage(error.message);
  if (error instanceof Error) {
    if (
      error.name === "UserRejectedRequestError" ||
      (error as { code?: number }).code === 4001 ||
      /user (rejected|denied)/i.test(error.message)
    ) {
      return "Transaction cancelled in wallet.";
    }
    return trimErrorMessage(error.message);
  }
  return "Unexpected error";
}

/* ── Intent approval state shared by all four UI flows ───────────── */

type ApprovalData<P> = {
  intent: P;
  allow: () => void;
  deny: () => void;
  refresh: () => Promise<P>;
};

function useIntentApproval<T, P>(
  clientRef: React.RefObject<NexusClient | null>,
  mapIntent: (client: NexusClient, intent: P) => Promise<T>,
) {
  const dataRef = useRef<ApprovalData<P> | null>(null);
  const timerRef = useRef<number | null>(null);
  const [intent, setIntent] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [approved, setApproved] = useState(false);

  const stopRefresh = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const clear = useCallback(() => {
    stopRefresh();
    dataRef.current = null;
    setIntent(null);
    setPending(false);
    setRefreshing(false);
  }, [stopRefresh]);

  const scheduleRefresh = useCallback(() => {
    stopRefresh();
    timerRef.current = window.setTimeout(async () => {
      const current = dataRef.current;
      const client = clientRef.current;
      if (!current || !client) return;
      try {
        setRefreshing(true);
        const refreshed = await current.refresh();
        const mapped = await mapIntent(client, refreshed);
        if (dataRef.current === current) {
          setIntent(mapped);
          scheduleRefresh();
        }
      } catch (error) {
        if (dataRef.current === current) {
          current.deny();
          toast.error(getErrorMessage(error));
          clear();
        }
      } finally {
        setRefreshing(false);
      }
    }, 20_000);
  }, [clear, clientRef, mapIntent, stopRefresh]);

  const onIntent = useCallback(async (data: ApprovalData<P>) => {
    const client = clientRef.current;
    if (!client) { data.deny(); return; }
    dataRef.current = data;
    try {
      const mapped = await mapIntent(client, data.intent);
      if (dataRef.current !== data) return;
      setIntent(mapped);
    } catch (error) {
      data.deny();
      if (dataRef.current === data) clear();
      toast.error(getErrorMessage(error));
      return;
    }
    setPending(true);
    setRefreshing(false);
    setApproved(false);
    scheduleRefresh();
  }, [clear, clientRef, mapIntent, scheduleRefresh]);

  const approve = useCallback(() => {
    const current = dataRef.current;
    if (!current) return;
    clear();
    setApproved(true);
    current.allow();
  }, [clear]);

  const deny = useCallback(() => {
    const current = dataRef.current;
    if (!current) return;
    clear();
    setApproved(false);
    current.deny();
  }, [clear]);

  useEffect(() => stopRefresh, [stopRefresh]);

  return { intent, pending, refreshing, approved, onIntent, approve, deny, clear };
}

/* ── useNexusSdk hook ───────────────────────────────────────────── */

export function useNexusSdk(network: NetworkMode) {
  const { connector, address, status } = useConnection();
  const queryClient = useQueryClient();
  const clientRef = useRef<NexusClient | null>(null);
  const [ready, setReady] = useState(false);

  const swap = useIntentApproval(clientRef, mapSwapQuote);
  const swapExecute = useIntentApproval(clientRef, mapCompositeIntent);
  const onSwapIntent = useCallback((data: IntentHookData) =>
    swap.onIntent({ ...data, intent: data.quote }), [swap.onIntent]);
  const prevKeyRef = useRef("");

  useEffect(() => {
    if (status !== "connected" && status !== "disconnected") return;
    const key = `${network}:${address ?? ""}:${status}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    let cancelled = false;

    async function run() {
      clientRef.current?.destroy();
      clientRef.current = null;
      setReady(false);
      swap.clear();
      swapExecute.clear();
      queryClient.removeQueries({ queryKey: ["swap-balances"] });
      if (status !== "connected" || !connector) return;

      const provider = await connector.getProvider();
      const client = createNexusClient({
        clientId: "nexus-sdk-browser-example",
        network,
        debug: true,
        devTiming: {
          enabled: true,
          emitAnalytics: false,
          emitLogs: false,
          captureNetworkTiming: true,
          onSpanComplete: (span: SpanProperties) => {
            if (span.operation !== "swap" && span.operation !== "swap_and_execute") return;
            console.log(`[swap timing] ${span.operation}`, {
              durationMs: Number(span.duration.toFixed(2)),
              success: span.success,
              tags: span.tags,
            });
          },
        },
      });

      await client.initialize();
      await client.setEVMProvider(provider as never);
      if (!cancelled) {
        clientRef.current = client;
        setReady(true);
      } else {
        client.destroy();
      }
    }

    run().catch((error) => {
      if (!cancelled) {
        setReady(false);
        toast.error(getErrorMessage(error));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [address, connector, network, queryClient, status, swap.clear, swapExecute.clear]);

  return useMemo(() => ({
    client: clientRef.current,
    ready,
    onSwapIntent,
    onSwapExecIntent: swapExecute.onIntent,
    swapIntent: swap.intent,
    swapIntentPending: swap.pending,
    swapIntentRefreshing: swap.refreshing,
    swapIntentApproved: swap.approved,
    approveSwapIntent: swap.approve,
    denySwapIntent: swap.deny,
    clearSwapIntent: swap.clear,
    swapExecIntent: swapExecute.intent,
    swapExecIntentPending: swapExecute.pending,
    swapExecIntentRefreshing: swapExecute.refreshing,
    swapExecIntentApproved: swapExecute.approved,
    approveSwapExecIntent: swapExecute.approve,
    denySwapExecIntent: swapExecute.deny,
    clearSwapExecIntent: swapExecute.clear,
  }), [
    ready, onSwapIntent, swap, swapExecute,
  ]);
}
