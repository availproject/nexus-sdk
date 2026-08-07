import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createNexusClient,
  NexusError,
  UserActionError,
  type IntentBalance,
  type IntentHookData,
  type IntentQuote,
  type NexusClient,
  type SpanProperties,
} from "@avail-project/nexus-core";
import { formatUnits } from "viem";
import { toast } from "sonner";
import { useConnection } from "wagmi";
import type { NetworkMode, SourceOption, TokenBalance } from "./types";
import { D, sum, toFixed } from "./math";

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
    gas?: { tokenSymbol: string; amount: string; value: string };
  };
  buffer: string;
  bridgeFees: {
    caGas: string;
    protocol: string;
    solver: string;
    total: string;
  } | null;
};

export type BridgeIntentViewModel = {
  sources: Array<{
    chainId: number;
    chainName: string;
    chainLogo: string;
    tokenSymbol: string;
    amount: string;
  }>;
  sourcesTotal: string;
  destination: {
    chainName: string;
    chainLogo: string | undefined;
    amount: string;
    nativeAmount: string;
    nativeAmountValue: string;
    nativeAmountInToken: string;
    nativeToken: { symbol: string; logo: string };
  };
  token: { symbol: string; name: string; logo: string | undefined };
  fees: { caGas: string; protocol: string; solver: string; total: string };
};

export type ExecuteRequirementViewModel = {
  chainName: string;
  chainLogo?: string;
  contractAddress: string;
  token: { symbol: string; amount: string; value: string };
  gas: { symbol: string; amount: string; value: string; priceTier: string };
  nativeValue?: { amount: string; value: string };
  tokenApproval?: { symbol: string; amount: string };
};

export type AvailableViewModel = {
  token: { amount: string; value: string };
  gas: { amount: string; value: string };
};

export type ShortfallViewModel = {
  token: { amount: string; value: string };
  gas: { amount: string; value: string };
};

export type SwapAndExecuteIntentViewModel = {
  kind: "swapAndExecute";
  executeRequirement: ExecuteRequirementViewModel;
  available: AvailableViewModel;
  swapRequired: boolean;
  shortfall?: ShortfallViewModel;
  swap?: SwapIntentViewModel;
};

export type BridgeAndExecuteIntentViewModel = {
  kind: "bridgeAndExecute";
  executeRequirement: ExecuteRequirementViewModel;
  available: AvailableViewModel;
  bridgeRequired: boolean;
  shortfall?: ShortfallViewModel;
  bridge?: BridgeIntentViewModel;
};

export type CompositeIntentContext = {
  contractAddress: `0x${string}`;
  tokenSymbol: string;
  amount: string;
  tokenApproval?: { symbol: string; amount: string };
};

/* ── API model → existing UI model adapters ─────────────────────── */

function findChain(client: NexusClient, chainId: number) {
  return client.getSupportedChains().find((chain) => chain.id === chainId);
}

function findToken(client: NexusClient, chainId: number, address: `0x${string}`) {
  return findChain(client, chainId)?.tokens.find(
    (token) => token.address.toLowerCase() === address.toLowerCase(),
  );
}

function displayAmount(
  client: NexusClient,
  chainId: number,
  address: `0x${string}`,
  amountRaw: bigint,
): string {
  return formatUnits(amountRaw, findToken(client, chainId, address)?.decimals ?? 18);
}

function estimatedUsd(symbol: string, amount: string): string {
  return /^(USDC|USDT|USDS|DAI|USDE)$/i.test(symbol) ? amount : "0";
}

function quoteFees(client: NexusClient, quote: IntentQuote) {
  const decimals = findToken(
    client,
    quote.output.chainId,
    quote.output.tokenAddress,
  )?.decimals ?? 18;
  const formatFee = (value: bigint) => formatUnits(value, decimals);
  return {
    caGas: formatFee(quote.fees.caGasRaw),
    protocol: formatFee(quote.fees.protocolRaw),
    solver: formatFee(quote.fees.solverRaw),
    total: formatFee(quote.fees.depositRaw + quote.fees.fulfillmentRaw),
  };
}

function mapSwapQuote(client: NexusClient, quote: IntentQuote): SwapIntentViewModel {
  const sources = quote.input.map((source) => {
    const chain = findChain(client, source.chainId);
    const amount = displayAmount(
      client,
      source.chainId,
      source.tokenAddress,
      source.totalRequiredRaw,
    );
    return {
      chainId: source.chainId,
      chainName: chain?.name ?? `Chain ${source.chainId}`,
      chainLogo: chain?.logo ?? "",
      tokenSymbol: source.tokenSymbol,
      amount,
      value: estimatedUsd(source.tokenSymbol, amount),
    };
  });
  const destinationChain = findChain(client, quote.output.chainId);
  const destinationToken = findToken(
    client,
    quote.output.chainId,
    quote.output.tokenAddress,
  );
  const destinationAmount = displayAmount(
    client,
    quote.output.chainId,
    quote.output.tokenAddress,
    quote.output.amountRaw,
  );

  return {
    sources,
    sourcesTotal: toFixed(sum(sources.map((source) => source.value)), 2),
    destination: {
      chainId: quote.output.chainId,
      chainName: destinationChain?.name ?? `Chain ${quote.output.chainId}`,
      chainLogo: destinationChain?.logo ?? "",
      tokenSymbol: destinationToken?.symbol ?? "Token",
      amount: destinationAmount,
      value: estimatedUsd(destinationToken?.symbol ?? "", destinationAmount),
    },
    buffer: "0",
    bridgeFees: quoteFees(client, quote),
  };
}

function mapBridgeQuote(client: NexusClient, quote: IntentQuote): BridgeIntentViewModel {
  const swap = mapSwapQuote(client, quote);
  const chain = findChain(client, quote.output.chainId);
  const token = findToken(client, quote.output.chainId, quote.output.tokenAddress);
  const native = chain?.nativeCurrency;
  const fees = quoteFees(client, quote);

  return {
    sources: swap.sources.map(({ value: _value, ...source }) => source),
    sourcesTotal: swap.sourcesTotal,
    destination: {
      chainName: swap.destination.chainName,
      chainLogo: swap.destination.chainLogo || undefined,
      amount: swap.destination.amount,
      nativeAmount: "0",
      nativeAmountValue: "0",
      nativeAmountInToken: "0",
      nativeToken: { symbol: native?.symbol ?? "Native", logo: native?.logo ?? "" },
    },
    token: {
      symbol: token?.symbol ?? "Token",
      name: token?.name ?? token?.symbol ?? "Token",
      logo: token?.logo,
    },
    fees,
  };
}

function mapCompositeQuote(
  client: NexusClient,
  quote: IntentQuote,
  kind: "swapAndExecute" | "bridgeAndExecute",
  context?: CompositeIntentContext,
): SwapAndExecuteIntentViewModel | BridgeAndExecuteIntentViewModel {
  const chain = findChain(client, quote.output.chainId);
  const token = findToken(client, quote.output.chainId, quote.output.tokenAddress);
  const amount = context?.amount ?? displayAmount(
    client,
    quote.output.chainId,
    quote.output.tokenAddress,
    quote.output.amountRaw,
  );
  const symbol = context?.tokenSymbol ?? token?.symbol ?? "Token";
  const value = estimatedUsd(symbol, amount);
  const executeRequirement: ExecuteRequirementViewModel = {
    chainName: chain?.name ?? `Chain ${quote.output.chainId}`,
    chainLogo: chain?.logo,
    contractAddress: context?.contractAddress ?? quote.output.tokenAddress,
    token: { symbol, amount, value },
    gas: {
      symbol: chain?.nativeCurrency.symbol ?? "Native",
      amount: "0",
      value: "0",
      priceTier: "medium",
    },
    tokenApproval: context?.tokenApproval,
  };
  const available = {
    token: { amount: "0", value: "0" },
    gas: { amount: "0", value: "0" },
  };
  const shortfall = {
    token: { amount, value },
    gas: { amount: "0", value: "0" },
  };

  return kind === "swapAndExecute"
    ? {
        kind,
        executeRequirement,
        available,
        swapRequired: true,
        shortfall,
        swap: mapSwapQuote(client, quote),
      }
    : {
        kind,
        executeRequirement,
        available,
        bridgeRequired: true,
        shortfall,
        bridge: mapBridgeQuote(client, quote),
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

export async function fetchUiBalances(
  client: NexusClient,
  kind: "swap" | "bridge",
): Promise<TokenBalance[]> {
  const balances = kind === "swap"
    ? await client.getBalancesForSwap()
    : await client.getBalancesForBridge();
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

function useIntentApproval<T, C = undefined>(
  clientRef: React.RefObject<NexusClient | null>,
  mapQuote: (client: NexusClient, quote: IntentQuote, context?: C) => T,
) {
  const dataRef = useRef<IntentHookData | null>(null);
  const contextRef = useRef<C | undefined>(undefined);
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
    contextRef.current = undefined;
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
        const quote = await current.refresh();
        if (dataRef.current === current) {
          setIntent(mapQuote(client, quote, contextRef.current));
          scheduleRefresh();
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
        clear();
      } finally {
        setRefreshing(false);
      }
    }, 20_000);
  }, [clear, clientRef, mapQuote, stopRefresh]);

  const onIntent = useCallback((data: IntentHookData, context?: C) => {
    const client = clientRef.current;
    if (!client) return;
    dataRef.current = data;
    contextRef.current = context;
    setIntent(mapQuote(client, data.quote, context));
    setPending(true);
    setRefreshing(false);
    setApproved(false);
    scheduleRefresh();
  }, [clientRef, mapQuote, scheduleRefresh]);

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

const mapSwap = (client: NexusClient, quote: IntentQuote) => mapSwapQuote(client, quote);
const mapBridge = (client: NexusClient, quote: IntentQuote) => mapBridgeQuote(client, quote);
const mapSwapExecute = (
  client: NexusClient,
  quote: IntentQuote,
  context?: CompositeIntentContext,
) => mapCompositeQuote(client, quote, "swapAndExecute", context) as SwapAndExecuteIntentViewModel;
const mapBridgeExecute = (
  client: NexusClient,
  quote: IntentQuote,
  context?: CompositeIntentContext,
) => mapCompositeQuote(client, quote, "bridgeAndExecute", context) as BridgeAndExecuteIntentViewModel;

/* ── useNexusSdk hook ───────────────────────────────────────────── */

export function useNexusSdk(network: NetworkMode, forceMayan: boolean) {
  const { connector, address, status } = useConnection();
  const queryClient = useQueryClient();
  const clientRef = useRef<NexusClient | null>(null);
  const [ready, setReady] = useState(false);

  const swap = useIntentApproval(clientRef, mapSwap);
  const bridge = useIntentApproval(clientRef, mapBridge);
  const swapExecute = useIntentApproval(clientRef, mapSwapExecute);
  const bridgeExecute = useIntentApproval(clientRef, mapBridgeExecute);
  const prevKeyRef = useRef("");

  useEffect(() => {
    if (status !== "connected" && status !== "disconnected") return;
    const key = `${network}:${address ?? ""}:${status}:${forceMayan ? "1" : "0"}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    let cancelled = false;

    async function run() {
      clientRef.current?.destroy();
      clientRef.current = null;
      setReady(false);
      swap.clear();
      bridge.clear();
      swapExecute.clear();
      bridgeExecute.clear();
      queryClient.removeQueries({ queryKey: ["swap-balances"] });
      queryClient.removeQueries({ queryKey: ["bridge-balances"] });
      if (status !== "connected" || !connector) return;

      const provider = await connector.getProvider();
      const client = createNexusClient({
        network,
        debug: true,
        forceMayan,
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
  }, [address, bridge.clear, bridgeExecute.clear, connector, forceMayan, network, queryClient, status, swap.clear, swapExecute.clear]);

  return useMemo(() => ({
    client: clientRef.current,
    ready,
    onSwapIntent: swap.onIntent,
    onBridgeIntent: bridge.onIntent,
    onSwapExecIntent: swapExecute.onIntent,
    onBridgeExecIntent: bridgeExecute.onIntent,
    swapIntent: swap.intent,
    swapIntentPending: swap.pending,
    swapIntentRefreshing: swap.refreshing,
    swapIntentApproved: swap.approved,
    approveSwapIntent: swap.approve,
    denySwapIntent: swap.deny,
    clearSwapIntent: swap.clear,
    bridgeIntent: bridge.intent,
    bridgeIntentPending: bridge.pending,
    bridgeIntentRefreshing: bridge.refreshing,
    bridgeIntentApproved: bridge.approved,
    approveBridgeIntent: bridge.approve,
    denyBridgeIntent: bridge.deny,
    clearBridgeIntent: bridge.clear,
    swapExecIntent: swapExecute.intent,
    swapExecIntentPending: swapExecute.pending,
    swapExecIntentRefreshing: swapExecute.refreshing,
    swapExecIntentApproved: swapExecute.approved,
    approveSwapExecIntent: swapExecute.approve,
    denySwapExecIntent: swapExecute.deny,
    clearSwapExecIntent: swapExecute.clear,
    bridgeExecIntent: bridgeExecute.intent,
    bridgeExecIntentPending: bridgeExecute.pending,
    bridgeExecIntentRefreshing: bridgeExecute.refreshing,
    bridgeExecIntentApproved: bridgeExecute.approved,
    approveBridgeExecIntent: bridgeExecute.approve,
    denyBridgeExecIntent: bridgeExecute.deny,
    clearBridgeExecIntent: bridgeExecute.clear,
  }), [
    bridge, bridgeExecute, ready, swap, swapExecute,
  ]);
}
