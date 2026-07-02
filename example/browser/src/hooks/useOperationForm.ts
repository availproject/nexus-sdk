import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserActionError, type NexusClient } from "@avail-project/nexus-core";
import type { TabConfig, HashRecord, SwapResultData, BridgeResultData } from "../lib/types";
import {
  flattenBalances,
  getErrorMessage,
  logError,
  type BridgeAndExecuteIntentViewModel,
  type BridgeIntentViewModel,
  type SwapAndExecuteIntentViewModel,
  type SwapIntentViewModel,
} from "../lib/nexus";
import { getChainLogoUrl, getTokenLogoUrl } from "../lib/logos";
import { useExecutionProgress } from "./useExecutionProgress";
import type { ProgressResult } from "../lib/types";
import { D, sum, toFixed } from "../lib/math";
import { formatAmount } from "../lib/format";

function friendlyUserActionReason(code?: string): string | undefined {
  switch (code) {
    case "USER_INTENT_SIGNATURE_DENIED":
      return "signature declined";
    case "USER_SIWE_SIGNATURE_DENIED":
      return "SIWE signature declined";
    case "USER_ALLOWANCE_APPROVAL_DENIED":
      return "allowance declined";
    case "USER_TX_SEND_DENIED":
      return "transaction declined";
    default:
      return undefined;
  }
}

function extractProgressResult(
  intentType: TabConfig["intentType"],
  swap: SwapIntentViewModel | null,
  bridge: BridgeIntentViewModel | null,
  swapExec: SwapAndExecuteIntentViewModel | null,
  bridgeExec: BridgeAndExecuteIntentViewModel | null,
): ProgressResult | null {
  const mapSwapSources = (vm: SwapIntentViewModel): ProgressResult => ({
    sources: vm.sources.map((s) => ({
      chainId: s.chainId,
      chainName: s.chainName,
      chainLogo: s.chainLogo,
      tokenSymbol: s.tokenSymbol,
      tokenLogo: getTokenLogoUrl(s.tokenSymbol, undefined, s.chainId),
      amount: s.amount,
      value: s.value,
    })),
    sourcesTotal: vm.sourcesTotal,
    feesTotal: toFixed(sum([vm.buffer, vm.bridgeFees?.total]), 2),
  });
  const mapBridgeSources = (vm: BridgeIntentViewModel): ProgressResult => ({
    sources: vm.sources.map((s) => ({
      chainId: s.chainId,
      chainName: s.chainName,
      chainLogo: s.chainLogo,
      tokenSymbol: s.tokenSymbol,
      tokenLogo: getTokenLogoUrl(s.tokenSymbol, undefined, s.chainId),
      amount: s.amount,
    })),
    sourcesTotal: vm.sourcesTotal,
    feesTotal: vm.fees.total,
  });

  if (intentType === "swap" && swap) return mapSwapSources(swap);
  if (intentType === "bridge" && bridge) return mapBridgeSources(bridge);
  if (intentType === "swapAndExecute" && swapExec?.swap) return mapSwapSources(swapExec.swap);
  if (intentType === "bridgeAndExecute" && bridgeExec?.bridge) return mapBridgeSources(bridgeExec.bridge);
  return null;
}

type UseOperationFormParams = {
  config: TabConfig;
  client: NexusClient | null;
  ready: boolean;
  address?: `0x${string}`;
  onSwapIntent: (data: any) => void;
  onBridgeIntent: (data: any) => void;
  onSwapExecIntent: (data: any) => void;
  onBridgeExecIntent: (data: any) => void;
  swapIntentPending: boolean;
  swapIntentApproved: boolean;
  clearSwapIntent: () => void;
  bridgeIntentPending: boolean;
  bridgeIntentApproved: boolean;
  clearBridgeIntent: () => void;
  swapExecIntentPending: boolean;
  swapExecIntentApproved: boolean;
  clearSwapExecIntent: () => void;
  bridgeExecIntentPending: boolean;
  bridgeExecIntentApproved: boolean;
  clearBridgeExecIntent: () => void;
  /** Currently-active view-model for the matching intent type — used to
   *  thread source/fee details into the progress modal on approval. */
  swapIntent?: SwapIntentViewModel | null;
  bridgeIntent?: BridgeIntentViewModel | null;
  swapExecIntent?: SwapAndExecuteIntentViewModel | null;
  bridgeExecIntent?: BridgeAndExecuteIntentViewModel | null;
};

export function useOperationForm({
  config,
  client,
  ready,
  address,
  onSwapIntent,
  onBridgeIntent,
  onSwapExecIntent,
  onBridgeExecIntent,
  swapIntentPending,
  swapIntentApproved,
  clearSwapIntent,
  bridgeIntentPending,
  bridgeIntentApproved,
  clearBridgeIntent,
  swapExecIntentPending,
  swapExecIntentApproved,
  clearSwapExecIntent,
  bridgeExecIntentPending,
  bridgeExecIntentApproved,
  clearBridgeExecIntent,
  swapIntent,
  bridgeIntent,
  swapExecIntent,
  bridgeExecIntent,
}: UseOperationFormParams) {
  const progress = useExecutionProgress(config.intentType);
  const chainOptions = useMemo(() => config.getChainOptions(client), [config, client]);
  const [chainId, setChainId] = useState<number>(config.defaultChainId);
  const [tokenSymbol, setTokenSymbol] = useState<string>("USDC");
  const [amount, setAmount] = useState("");
  const [nativeAmount, setNativeAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [sourceAmounts, setSourceAmounts] = useState<Record<string, string>>({});
  const isPerSource = config.amountMode === "per-source";

  const setSourceAmount = useCallback((id: string, value: string) => {
    setSourceAmounts((prev) => ({ ...prev, [id]: value }));
  }, []);

  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [started, setStarted] = useState(false);
  const [resultHashes, setResultHashes] = useState<HashRecord[]>([]);
  const [richResult, setRichResult] = useState<SwapResultData | BridgeResultData | null>(null);
  const [marketUrl, setMarketUrl] = useState<string | undefined>();
  const [statusMessage, setStatusMessage] = useState("");

  const tokenOptions = useMemo(
    () => config.getTokenOptions(client, chainId),
    [config, client, chainId],
  );

  useEffect(() => {
    const found = tokenOptions.find((t) => t.symbol === tokenSymbol);
    if (!found && tokenOptions.length > 0) {
      setTokenSymbol(tokenOptions[0]!.symbol);
    }
  }, [tokenOptions, tokenSymbol]);

  const balancesQuery = useQuery({
    queryKey: [config.balanceQueryKey],
    queryFn: async () => {
      if (!client) throw new Error("no client");
      try {
        const result = await config.fetchBalances(client);
        console.log(`[balances] ${config.id}:`, result);
        return result;
      } catch (error) {
        logError(`balances:${config.id}`, error);
        throw error;
      }
    },
    enabled: Boolean(address) && ready && Boolean(client),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const allSourceOptions = useMemo(
    () => flattenBalances(balancesQuery.data ?? []),
    [balancesQuery.data],
  );

  const sourceOptions = useMemo(
    () =>
      config.filterSources
        ? config.filterSources(allSourceOptions, chainId, tokenSymbol)
        : allSourceOptions,
    [config, allSourceOptions, chainId, tokenSymbol],
  );

  const prevSourceIdsRef = useRef<string>("");
  useEffect(() => {
    if (!config.filterSources) return;
    const currentIds = sourceOptions.map((s) => s.id).join(",");
    if (prevSourceIdsRef.current && prevSourceIdsRef.current !== currentIds) {
      setSelectedSources([]);
    }
    prevSourceIdsRef.current = currentIds;
  }, [sourceOptions, config.filterSources]);

  const selectedSourceOptions =
    selectedSources.length > 0
      ? sourceOptions.filter((s) => selectedSources.includes(s.id))
      : [];

  const fromSources =
    selectedSources.length > 0
      ? selectedSourceOptions.map((s) => ({
          chainId: s.chainId,
          tokenAddress: s.tokenAddress,
        }))
      : undefined;

  const sourceChainIds =
    selectedSources.length > 0
      ? [...new Set(selectedSourceOptions.map((s) => s.chainId))]
      : [];

  const currentTokenOption = tokenOptions.find((t) => t.symbol === tokenSymbol);

  // Per-source (exact-in): each selected source carries its own input amount.
  // Amounts are scoped to the explicitly-selected ids, so a removed source's
  // lingering entry never counts toward the total / validation / execution.
  const selectedSet = useMemo(() => new Set(selectedSources), [selectedSources]);
  const sourcesTotalFiat = useMemo(() => {
    if (!isPerSource) return 0;
    return sourceOptions
      .filter((s) => selectedSet.has(s.id))
      .reduce((acc, s) => {
        const amt = sourceAmounts[s.id];
        if (!amt || !(Number(amt) > 0)) return acc;
        const bal = D(s.balance);
        const price = bal.gt(0) ? D(s.value).div(bal) : D(0);
        return acc.plus(D(amt).times(price));
      }, D(0))
      .toNumber();
  }, [isPerSource, sourceOptions, selectedSet, sourceAmounts]);

  const amountValid = isPerSource
    ? sourceOptions.some(
        (s) => selectedSet.has(s.id) && Number(sourceAmounts[s.id] ?? "0") > 0,
      )
    : Number(amount) > 0;

  const maxQuery = useQuery({
    queryKey: ["max", config.id, chainId, tokenSymbol, selectedSources],
    queryFn: async () => {
      try {
        const result = await config.calculateMax(
          client!,
          chainId,
          tokenSymbol,
          currentTokenOption?.tokenAddress,
          sourceChainIds,
          fromSources,
        );
        console.log(`[max-calc] ${config.id}:`, { chainId, tokenSymbol, sourceChainIds, result });
        return result;
      } catch (error) {
        logError(`max-calc:${config.id}`, error);
        console.error(`[max-calc] context:`, { chainId, tokenSymbol, sourceChainIds });
        throw error;
      }
    },
    enabled: false,
    staleTime: 30_000,
    retry: false,
  });

  const fetchMax = useCallback(() => {
    if (ready && client && currentTokenOption) {
      maxQuery.refetch();
    }
  }, [ready, client, currentTokenOption, maxQuery]);

  // Reset progress when form fields change
  const mutationRef = useRef<{ isPending: boolean }>({ isPending: false });
  useEffect(() => {
    if (started && !mutationRef.current.isPending) {
      setStarted(false);
      setCompletedSteps(new Set());
      setResultHashes([]);
      setRichResult(null);
      setMarketUrl(undefined);
      setStatusMessage("");
    }
  }, [chainId, tokenSymbol, amount, selectedSources, sourceAmounts]);

  // Intent approval tracking — route to the correct state based on intent type
  const intentPending =
    config.intentType === "swap" ? swapIntentPending
    : config.intentType === "swapAndExecute" ? swapExecIntentPending
    : config.intentType === "bridge" ? bridgeIntentPending
    : bridgeExecIntentPending;
  const intentApproved =
    config.intentType === "swap" ? swapIntentApproved
    : config.intentType === "swapAndExecute" ? swapExecIntentApproved
    : config.intentType === "bridge" ? bridgeIntentApproved
    : bridgeExecIntentApproved;
  const clearIntent =
    config.intentType === "swap" ? clearSwapIntent
    : config.intentType === "swapAndExecute" ? clearSwapExecIntent
    : config.intentType === "bridge" ? clearBridgeIntent
    : clearBridgeExecIntent;

  const intentWasPendingRef = useRef(false);
  useEffect(() => {
    if (intentPending) {
      intentWasPendingRef.current = true;
    } else if (intentWasPendingRef.current && started && intentApproved) {
      intentWasPendingRef.current = false;
      setCompletedSteps((prev) => {
        const next = new Set(prev);
        next.add("INTENT_APPROVED");
        return next;
      });

      // Snapshot the approved intent into the progress state so the success
      // screen can show the source breakdown + total fees.
      const snapshot = extractProgressResult(
        config.intentType,
        swapIntent ?? null,
        bridgeIntent ?? null,
        swapExecIntent ?? null,
        bridgeExecIntent ?? null,
      );
      if (snapshot) progress.attachResult(snapshot);
    } else if (intentWasPendingRef.current && !intentPending) {
      intentWasPendingRef.current = false;
    }
  }, [intentPending, started, intentApproved]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("SDK not ready");
      if (!address) throw new Error("Connect wallet first");
      if (isPerSource) {
        if (!amountValid) throw new Error("Enter an amount for at least one asset");
      } else if (!amount.trim()) {
        throw new Error("Enter an amount");
      }

      setCompletedSteps(new Set());
      setStarted(true);
      setResultHashes([]);
      setRichResult(null);
      setMarketUrl(undefined);
      setStatusMessage("Preparing...");

      const destChainName =
        chainOptions.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
      const activeSources = isPerSource
        ? sourceOptions.filter(
            (s) => selectedSet.has(s.id) && Number(sourceAmounts[s.id] ?? "0") > 0,
          )
        : selectedSourceOptions;
      const sourceSymbols =
        activeSources.length > 0
          ? [...new Set(activeSources.map((s) => s.symbol))].join(", ")
          : tokenSymbol;
      progress.openModal({
        sourceSymbols,
        amount: isPerSource ? `$${formatAmount(sourcesTotalFiat, 2)}` : amount,
        destTokenSymbol: tokenSymbol,
        destTokenLogo: getTokenLogoUrl(tokenSymbol, currentTokenOption?.tokenAddress, chainId),
        destChainName,
        destChainLogo: getChainLogoUrl(chainId),
      });

      const ctx = {
        client,
        address,
        chainId,
        tokenSymbol,
        tokenAddress: currentTokenOption?.tokenAddress,
        amount,
        nativeAmount,
        recipient,
        sourceOptions,
        selectedSources,
        sourceAmounts,
        setCompletedSteps,
        setStatusMessage,
        handleProgressEvent: progress.handleEvent,
        _onSwapIntent: onSwapIntent,
        _onBridgeIntent: onBridgeIntent,
        _onSwapExecIntent: onSwapExecIntent,
        _onBridgeExecIntent: onBridgeExecIntent,
      };

      console.log(`[execute] ${config.id} starting:`, { chainId, tokenSymbol, amount, selectedSources });
      const result = await config.execute(ctx);
      console.log(`[execute] ${config.id} result:`, result);

      setResultHashes(result.hashes);
      if (result.richResult) setRichResult(result.richResult);
      if (result.marketUrl) setMarketUrl(result.marketUrl);
      return result;
    },
    onSuccess: () => {
      toast.success(`${config.hero.title} completed`);
      balancesQuery.refetch();
      // Card becomes editable after 3s; progress/badge stay until field edit
      setTimeout(() => {
        setStatusMessage("");
      }, 3000);
    },
    onError: (error) => {
      logError(`execute:${config.id}`, error);
      // Intent-hook denial happens BEFORE the progress modal is visible
      // (execution hasn't started yet) — close it cleanly so the user lands
      // back on the form. Other user-action errors (allowance, signature,
      // tx-send) happen mid-execution → render the "cancelled" variant of the
      // failure UI. Any non-user error renders the "failed" variant.
      const code = (error as { code?: string }).code;
      if (error instanceof UserActionError) {
        if (code === "USER_INTENT_HOOK_DENIED") {
          progress.closeModal();
        } else {
          progress.handleError(error, {
            kind: "cancelled",
            reason: friendlyUserActionReason(code) ?? "Cancelled in wallet",
          });
        }
      } else {
        progress.handleError(error, { kind: "failed" });
      }
      toast.error(getErrorMessage(error), { duration: 10000 });
      clearIntent();
      setStarted(false);
      setCompletedSteps(new Set());
      setResultHashes([]);
      setRichResult(null);
      setMarketUrl(undefined);
      setStatusMessage("");
    },
  });

  mutationRef.current = mutation;

  const resetForm = useCallback(() => {
    setAmount("");
    setNativeAmount("");
    setRecipient("");
    setSelectedSources([]);
    setSourceAmounts({});
    setCompletedSteps(new Set());
    setStarted(false);
    setResultHashes([]);
    setRichResult(null);
    setMarketUrl(undefined);
    setStatusMessage("");
  }, []);

  return {
    chainOptions,
    chainId,
    setChainId,
    tokenOptions,
    tokenSymbol,
    setTokenSymbol,
    amount,
    setAmount,
    nativeAmount,
    setNativeAmount,
    recipient,
    setRecipient,
    sourceOptions,
    selectedSources,
    setSelectedSources,
    sourceAmounts,
    setSourceAmount,
    sourcesTotalFiat,
    amountValid,
    maxQuery,
    fetchMax,
    completedSteps,
    started,
    resultHashes,
    richResult,
    marketUrl,
    statusMessage,
    mutation,
    balancesQuery,
    intentPending,
    resetForm,
    progressState: progress.state,
    closeProgressModal: progress.closeModal,
  };
}
