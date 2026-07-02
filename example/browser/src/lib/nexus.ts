import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createNexusClient,
  NexusError,
  UserActionError,
  type NexusClient,
  type TokenBalance,
  type SwapIntent,
  type BridgeIntent,
  type OnSwapIntentHookData as SdkSwapIntentHookData,
  type SwapAndExecuteIntent,
  type SwapAndExecuteOnIntentHookData,
  type BridgeAndExecuteIntent,
  type BridgeAndExecuteOnIntentHookData,
} from "@avail-project/nexus-core";
import { toast } from "sonner";
import { useConnection } from "wagmi";
import type { NetworkMode, SourceOption } from "./types";
import { ceilDp, D, sum, toFixed } from "./math";

/* ── View models for intent modals ────────────────────────────────── */

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
    gas?: {
      tokenSymbol: string;
      amount: string;
      value: string;
    };
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
  token: {
    symbol: string;
    name: string;
    logo: string | undefined;
  };
  fees: {
    caGas: string;
    protocol: string;
    solver: string;
    total: string;
  };
};

/* ── Composite intent view models (swap-and-execute / bridge-and-execute) ── */

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

/* ── Helpers ──────────────────────────────────────────────────────── */

export function flattenBalances(assets: TokenBalance[]): SourceOption[] {
  return assets.flatMap((asset) =>
    asset.chainBalances
      .filter((entry) => D(entry.balance).gt(0))
      .map((entry) => ({
        id: `${entry.chain.id}:${entry.contractAddress.toLowerCase()}`,
        symbol: asset.symbol,
        tokenLogo: asset.logo,
        tokenName: (asset as { name?: string }).name,
        decimals: (entry as { decimals?: number }).decimals,
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
    // NexusError is flat — no cause chain. The underlying error's text (viem revert,
    // HTTP failure, …) is inlined into `error.message`; `context` / `details` carry the
    // queryable metadata.
    console.error(`[${label}] code:`, error.code);
    console.error(`[${label}] category:`, error.category);
    console.error(`[${label}] service:`, error.context.service);
    console.error(`[${label}] message:`, error.message);
    console.error(`[${label}] context:`, error.context);
    console.error(`[${label}] details:`, error.details);
  }
}

export function getErrorMessage(error: unknown): string {
  // Every user-denial path lands as UserActionError (intent hook denial,
  // intent/SIWE signature denial in wallet, ERC20 approve denial).
  if (error instanceof UserActionError) {
    return "Transaction cancelled in wallet.";
  }
  if (error instanceof NexusError) {
    return trimErrorMessage(error.message);
  }

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

function ceil4(v: string | number): string {
  return ceilDp(v, 4);
}

function mapSwapIntent(intent: SwapIntent): SwapIntentViewModel {
  console.log("[actual-intent-hook] bridgeAndExecute", intent);
  const sources = intent.sources.map((source) => ({
    chainId: source.chain.id,
    chainName: source.chain.name,
    chainLogo: source.chain.logo,
    tokenSymbol: source.token.symbol,
    amount: source.amount,
    value: (source as { value?: string }).value ?? "0",
  }));
  const sourcesTotal = toFixed(sum(sources.map((s) => s.value)), 2);

  const gas = intent.destination.gas;
  return {
    sources,
    sourcesTotal,
    destination: {
      chainId: intent.destination.chain.id,
      chainName: intent.destination.chain.name,
      chainLogo: intent.destination.chain.logo,
      tokenSymbol: intent.destination.token.symbol,
      amount: intent.destination.amount,
      value: (intent.destination as { value?: string }).value ?? "0",
      gas:
        gas?.amount && D(gas.amount).gt(0)
          ? {
              tokenSymbol: gas.token.symbol,
              amount: gas.amount,
              value: (gas as { value?: string }).value ?? "0",
            }
          : undefined,
    },
    buffer: ceil4(intent.feesAndBuffer.buffer),
    bridgeFees: intent.feesAndBuffer.bridge
      ? {
          caGas: ceil4(intent.feesAndBuffer.bridge.caGas),
          protocol: ceil4(intent.feesAndBuffer.bridge.protocol),
          solver: ceil4(intent.feesAndBuffer.bridge.solver),
          total: ceil4(intent.feesAndBuffer.bridge.total),
        }
      : null,
  };
}

function mapBridgeIntent(intent: BridgeIntent): BridgeIntentViewModel {
  return {
    sources: intent.selectedSources.map((s) => ({
      chainId: s.chain.id,
      chainName: s.chain.name,
      chainLogo: s.chain.logo,
      tokenSymbol: s.token.symbol,
      amount: s.amount,
    })),
    sourcesTotal: intent.sourcesTotal,
    destination: {
      chainName: intent.destination.chain.name,
      chainLogo: intent.destination.chain.logo ?? undefined,
      amount: intent.destination.amount,
      nativeAmount: intent.destination.nativeAmount,
      nativeAmountValue: intent.destination.nativeAmountValue,
      nativeAmountInToken: intent.destination.nativeAmountInToken,
      nativeToken: {
        symbol: intent.destination.nativeToken.symbol,
        logo: intent.destination.nativeToken.logo,
      },
    },
    token: {
      symbol: intent.destination.token.symbol,
      name: intent.destination.token.symbol,
      logo: intent.destination.token.logo ?? undefined,
    },
    fees: {
      caGas: ceil4(intent.fees.caGas),
      protocol: ceil4(intent.fees.protocol),
      solver: ceil4(intent.fees.solver),
      total: ceil4(intent.fees.total),
    },
  };
}

function mapExecuteRequirement(req: SwapAndExecuteIntent["executeRequirement"]): ExecuteRequirementViewModel {
  return {
    chainName: req.chain.name,
    chainLogo: req.chain.logo,
    contractAddress: req.to,
    token: { symbol: req.token.symbol, amount: req.token.amount, value: req.token.value },
    gas: { symbol: req.gas.symbol, amount: req.gas.amount, value: req.gas.value, priceTier: req.gas.priceTier },
    nativeValue: req.nativeValue ? { amount: req.nativeValue.amount, value: req.nativeValue.value } : undefined,
    tokenApproval: req.tokenApproval ? { symbol: req.tokenApproval.token.symbol, amount: req.tokenApproval.amount } : undefined,
  };
}

function mapAvailable(avail: SwapAndExecuteIntent["available"]): AvailableViewModel {
  return {
    token: { amount: avail.token.amount, value: avail.token.value },
    gas: { amount: avail.gas.amount, value: avail.gas.value },
  };
}

function mapShortfall(sf: { token: { amount: string; value: string }; gas: { amount: string; value: string } }): ShortfallViewModel {
  return {
    token: { amount: sf.token.amount, value: sf.token.value },
    gas: { amount: sf.gas.amount, value: sf.gas.value },
  };
}

function mapSwapAndExecuteIntent(intent: SwapAndExecuteIntent): SwapAndExecuteIntentViewModel {
  const base = {
    kind: "swapAndExecute" as const,
    executeRequirement: mapExecuteRequirement(intent.executeRequirement),
    available: mapAvailable(intent.available),
    swapRequired: intent.swapRequired,
  };
  if (intent.swapRequired) {
    return {
      ...base,
      swapRequired: true,
      shortfall: mapShortfall(intent.shortfall),
      swap: mapSwapIntent(intent.swap),
    };
  }
  return base;
}

function mapBridgeAndExecuteIntent(intent: BridgeAndExecuteIntent): BridgeAndExecuteIntentViewModel {
  const base = {
    kind: "bridgeAndExecute" as const,
    executeRequirement: mapExecuteRequirement(intent.executeRequirement),
    available: mapAvailable(intent.available),
    bridgeRequired: intent.bridgeRequired,
  };
  if (intent.bridgeRequired) {
    return {
      ...base,
      bridgeRequired: true,
      shortfall: mapShortfall(intent.shortfall),
      bridge: mapBridgeIntent(intent.bridge),
    };
  }
  return base;
}

/* ── Async interval for intent refresh ────────────────────────────── */

const asyncIntervals: boolean[] = [];

function runAsyncInterval(
  cb: () => Promise<void>,
  interval: number,
  intervalIndex: number,
) {
  if (!asyncIntervals[intervalIndex]) return;
  cb().finally(() => {
    if (asyncIntervals[intervalIndex]) {
      setTimeout(() => runAsyncInterval(cb, interval, intervalIndex), interval);
    }
  });
}

function setAsyncInterval(cb: () => Promise<void>, interval: number): number {
  const intervalIndex = asyncIntervals.length;
  asyncIntervals.push(true);
  setTimeout(() => runAsyncInterval(cb, interval, intervalIndex), interval);
  return intervalIndex;
}

function clearAsyncInterval(intervalIndex: number) {
  if (intervalIndex >= 0 && intervalIndex < asyncIntervals.length) {
    asyncIntervals[intervalIndex] = false;
  }
}

/* ── useNexusSdk hook ─────────────────────────────────────────────── */

export function useNexusSdk(network: NetworkMode, forceMayan: boolean) {
  const { connector, address, status } = useConnection();
  const queryClient = useQueryClient();
  const clientRef = useRef<NexusClient | null>(null);

  // Swap intent state (plain swap)
  const swapIntentRef = useRef<SdkSwapIntentHookData | null>(null);
  const swapRefreshRef = useRef(-1);
  const [ready, setReady] = useState(false);
  const [swapIntent, setSwapIntent] = useState<SwapIntentViewModel | null>(null);
  const [swapIntentPending, setSwapIntentPending] = useState(false);
  const [swapIntentRefreshing, setSwapIntentRefreshing] = useState(false);
  const [swapIntentApproved, setSwapIntentApproved] = useState(false);

  // Swap-and-execute composite intent state
  const swapExecIntentRef = useRef<SwapAndExecuteOnIntentHookData | null>(null);
  const swapExecRefreshRef = useRef(-1);
  const [swapExecIntent, setSwapExecIntent] = useState<SwapAndExecuteIntentViewModel | null>(null);
  const [swapExecIntentPending, setSwapExecIntentPending] = useState(false);
  const [swapExecIntentRefreshing, setSwapExecIntentRefreshing] = useState(false);
  const [swapExecIntentApproved, setSwapExecIntentApproved] = useState(false);

  // Bridge intent state (plain bridge)
  type BridgeIntentHookData = {
    allow: () => void;
    deny: () => void;
    intent: BridgeIntent;
    refresh: (selectedSources?: number[]) => Promise<BridgeIntent>;
  };
  const bridgeIntentRef = useRef<BridgeIntentHookData | null>(null);
  const bridgeRefreshRef = useRef(-1);
  const [bridgeIntent, setBridgeIntent] = useState<BridgeIntentViewModel | null>(null);
  const [bridgeIntentPending, setBridgeIntentPending] = useState(false);
  const [bridgeIntentRefreshing, setBridgeIntentRefreshing] = useState(false);
  const [bridgeIntentApproved, setBridgeIntentApproved] = useState(false);

  // Bridge-and-execute composite intent state
  const bridgeExecIntentRef = useRef<BridgeAndExecuteOnIntentHookData | null>(null);
  const bridgeExecRefreshRef = useRef(-1);
  const [bridgeExecIntent, setBridgeExecIntent] = useState<BridgeAndExecuteIntentViewModel | null>(null);
  const [bridgeExecIntentPending, setBridgeExecIntentPending] = useState(false);
  const [bridgeExecIntentRefreshing, setBridgeExecIntentRefreshing] = useState(false);
  const [bridgeExecIntentApproved, setBridgeExecIntentApproved] = useState(false);

  function stopSwapRefresh() {
    if (swapRefreshRef.current >= 0) {
      clearAsyncInterval(swapRefreshRef.current);
      swapRefreshRef.current = -1;
    }
  }

  function resetSwapIntent() {
    stopSwapRefresh();
    swapIntentRef.current = null;
    setSwapIntent(null);
    setSwapIntentPending(false);
    setSwapIntentRefreshing(false);
  }

  function stopSwapExecRefresh() {
    if (swapExecRefreshRef.current >= 0) {
      clearAsyncInterval(swapExecRefreshRef.current);
      swapExecRefreshRef.current = -1;
    }
  }

  function resetSwapExecIntent() {
    stopSwapExecRefresh();
    swapExecIntentRef.current = null;
    setSwapExecIntent(null);
    setSwapExecIntentPending(false);
    setSwapExecIntentRefreshing(false);
  }

  function stopBridgeRefresh() {
    if (bridgeRefreshRef.current >= 0) {
      clearAsyncInterval(bridgeRefreshRef.current);
      bridgeRefreshRef.current = -1;
    }
  }

  function resetBridgeIntent() {
    stopBridgeRefresh();
    bridgeIntentRef.current = null;
    setBridgeIntent(null);
    setBridgeIntentPending(false);
    setBridgeIntentRefreshing(false);
  }

  function stopBridgeExecRefresh() {
    if (bridgeExecRefreshRef.current >= 0) {
      clearAsyncInterval(bridgeExecRefreshRef.current);
      bridgeExecRefreshRef.current = -1;
    }
  }

  function resetBridgeExecIntent() {
    stopBridgeExecRefresh();
    bridgeExecIntentRef.current = null;
    setBridgeExecIntent(null);
    setBridgeExecIntentPending(false);
    setBridgeExecIntentRefreshing(false);
  }

  // Store intent hook handlers that tabs can call
  const handleSwapIntentRef = useRef<((data: SdkSwapIntentHookData) => void) | undefined>(undefined);
  const handleBridgeIntentRef = useRef<((data: BridgeIntentHookData) => void) | undefined>(undefined);
  const handleSwapExecIntentRef = useRef<((data: SwapAndExecuteOnIntentHookData) => void) | undefined>(undefined);
  const handleBridgeExecIntentRef = useRef<((data: BridgeAndExecuteOnIntentHookData) => void) | undefined>(undefined);

  handleSwapIntentRef.current = (data) => {
    console.log("[intent-hook] swap", data.intent);
    stopSwapRefresh();
    swapIntentRef.current = data;
    setSwapIntent(mapSwapIntent(data.intent));
    setSwapIntentPending(true);
    setSwapIntentRefreshing(false);
    setSwapIntentApproved(false);

    swapRefreshRef.current = setAsyncInterval(async () => {
      if (!swapIntentRef.current) return;
      try {
        setSwapIntentRefreshing(true);
        const refreshed = await swapIntentRef.current.refresh();
        if (swapIntentRef.current) {
          setSwapIntent(mapSwapIntent(refreshed));
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
        resetSwapIntent();
      } finally {
        setSwapIntentRefreshing(false);
      }
    }, 20_000);
  };

  handleBridgeIntentRef.current = (data) => {
    console.log("[intent-hook] bridge", data.intent);
    stopBridgeRefresh();
    bridgeIntentRef.current = data;
    setBridgeIntent(mapBridgeIntent(data.intent));
    setBridgeIntentPending(true);
    setBridgeIntentRefreshing(false);
    setBridgeIntentApproved(false);

    bridgeRefreshRef.current = setAsyncInterval(async () => {
      if (!bridgeIntentRef.current) return;
      try {
        setBridgeIntentRefreshing(true);
        const refreshed = await bridgeIntentRef.current.refresh();
        if (bridgeIntentRef.current) {
          setBridgeIntent(mapBridgeIntent(refreshed));
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
        resetBridgeIntent();
      } finally {
        setBridgeIntentRefreshing(false);
      }
    }, 20_000);
  };

  handleSwapExecIntentRef.current = (data) => {
    console.log("[intent-hook] swapAndExecute", data.intent);
    stopSwapExecRefresh();
    swapExecIntentRef.current = data;
    setSwapExecIntent(mapSwapAndExecuteIntent(data.intent));
    setSwapExecIntentPending(true);
    setSwapExecIntentRefreshing(false);
    setSwapExecIntentApproved(false);

    swapExecRefreshRef.current = setAsyncInterval(async () => {
      if (!swapExecIntentRef.current) return;
      try {
        setSwapExecIntentRefreshing(true);
        const refreshed = await swapExecIntentRef.current.refresh();
        if (swapExecIntentRef.current) {
          setSwapExecIntent(mapSwapAndExecuteIntent(refreshed));
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
        resetSwapExecIntent();
      } finally {
        setSwapExecIntentRefreshing(false);
      }
    }, 20_000);
  };

  handleBridgeExecIntentRef.current = (data) => {
    console.log("[intent-hook] bridgeAndExecute", data.intent);
    stopBridgeExecRefresh();
    bridgeExecIntentRef.current = data;
    setBridgeExecIntent(mapBridgeAndExecuteIntent(data.intent));
    setBridgeExecIntentPending(true);
    setBridgeExecIntentRefreshing(false);
    setBridgeExecIntentApproved(false);

    bridgeExecRefreshRef.current = setAsyncInterval(async () => {
      if (!bridgeExecIntentRef.current) return;
      try {
        setBridgeExecIntentRefreshing(true);
        const refreshed = await bridgeExecIntentRef.current.refresh();
        if (bridgeExecIntentRef.current) {
          setBridgeExecIntent(mapBridgeAndExecuteIntent(refreshed));
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
        resetBridgeExecIntent();
      } finally {
        setBridgeExecIntentRefreshing(false);
      }
    }, 20_000);
  };

  // Track the last address/network combo to avoid redundant recreations
  const prevKeyRef = useRef<string>("");

  // Re-create client on network change, account change, or forceMayan toggle.
  // Gate on wagmi's settled status — during 'reconnecting'/'connecting',
  // `connector` can be undefined even though the account flips connected, which
  // used to leave the dedup key stamped so the SDK never initialized after a
  // page refresh.
  useEffect(() => {
    if (status !== "connected" && status !== "disconnected") return;

    const key = `${network}:${address ?? ""}:${status}:${forceMayan ? "1" : "0"}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    let cancelled = false;

    async function run() {
      // Tear down previous client
      if (clientRef.current) {
        clientRef.current.destroy();
        clientRef.current = null;
      }
      setReady(false);
      resetSwapIntent();
      resetSwapExecIntent();
      resetBridgeIntent();
      resetBridgeExecIntent();
      queryClient.removeQueries({ queryKey: ["swap-balances"] });
      queryClient.removeQueries({ queryKey: ["bridge-balances"] });
      queryClient.removeQueries({ queryKey: ["max"] });

      if (status !== "connected" || !connector) return;

      const provider = await connector.getProvider();
      const client = createNexusClient({
        network,
        debug: true,
        forceMayan,
      });

      console.log(`[nexus] initializing client (${network}, forceMayan=${forceMayan})`);
      await client.initialize();
      await client.setEVMProvider(provider as never);

      if (!cancelled) {
        clientRef.current = client;
        setReady(true);
        console.log(`[nexus] client ready (${network})`);
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
  }, [connector, status, network, address, forceMayan]);

  // Expose intent hook handlers for tabs to use in per-call options
  const onSwapIntent = useMemo(
    () => (data: SdkSwapIntentHookData) => handleSwapIntentRef.current?.(data),
    [],
  );

  const onBridgeIntent = useMemo(
    () => (data: BridgeIntentHookData) => handleBridgeIntentRef.current?.(data),
    [],
  );

  const onSwapExecIntent = useMemo(
    () => (data: SwapAndExecuteOnIntentHookData) => handleSwapExecIntentRef.current?.(data),
    [],
  );

  const onBridgeExecIntent = useMemo(
    () => (data: BridgeAndExecuteOnIntentHookData) => handleBridgeExecIntentRef.current?.(data),
    [],
  );

  return useMemo(
    () => ({
      client: clientRef.current,
      ready,
      // Intent hook handlers for per-call options
      onSwapIntent,
      onBridgeIntent,
      onSwapExecIntent,
      onBridgeExecIntent,
      // Swap intent modal state (plain)
      swapIntent,
      swapIntentPending,
      swapIntentRefreshing,
      swapIntentApproved,
      approveSwapIntent: () => {
        const current = swapIntentRef.current;
        if (!current) return;
        resetSwapIntent();
        setSwapIntentApproved(true);
        current.allow();
      },
      denySwapIntent: () => {
        const current = swapIntentRef.current;
        if (!current) return;
        resetSwapIntent();
        setSwapIntentApproved(false);
        current.deny();
      },
      clearSwapIntent: () => resetSwapIntent(),
      // Swap-and-execute composite intent state
      swapExecIntent,
      swapExecIntentPending,
      swapExecIntentRefreshing,
      swapExecIntentApproved,
      approveSwapExecIntent: () => {
        const current = swapExecIntentRef.current;
        if (!current) return;
        resetSwapExecIntent();
        setSwapExecIntentApproved(true);
        current.allow();
      },
      denySwapExecIntent: () => {
        const current = swapExecIntentRef.current;
        if (!current) return;
        resetSwapExecIntent();
        setSwapExecIntentApproved(false);
        current.deny();
      },
      clearSwapExecIntent: () => resetSwapExecIntent(),
      // Bridge intent modal state (plain)
      bridgeIntent,
      bridgeIntentPending,
      bridgeIntentRefreshing,
      bridgeIntentApproved,
      approveBridgeIntent: () => {
        const current = bridgeIntentRef.current;
        if (!current) return;
        resetBridgeIntent();
        setBridgeIntentApproved(true);
        current.allow();
      },
      denyBridgeIntent: () => {
        const current = bridgeIntentRef.current;
        if (!current) return;
        resetBridgeIntent();
        setBridgeIntentApproved(false);
        current.deny();
      },
      clearBridgeIntent: () => resetBridgeIntent(),
      // Bridge-and-execute composite intent state
      bridgeExecIntent,
      bridgeExecIntentPending,
      bridgeExecIntentRefreshing,
      bridgeExecIntentApproved,
      approveBridgeExecIntent: () => {
        const current = bridgeExecIntentRef.current;
        if (!current) return;
        resetBridgeExecIntent();
        setBridgeExecIntentApproved(true);
        current.allow();
      },
      denyBridgeExecIntent: () => {
        const current = bridgeExecIntentRef.current;
        if (!current) return;
        resetBridgeExecIntent();
        setBridgeExecIntentApproved(false);
        current.deny();
      },
      clearBridgeExecIntent: () => resetBridgeExecIntent(),
    }),
    [
      ready,
      onSwapIntent,
      onBridgeIntent,
      onSwapExecIntent,
      onBridgeExecIntent,
      swapIntent,
      swapIntentPending,
      swapIntentRefreshing,
      swapIntentApproved,
      swapExecIntent,
      swapExecIntentPending,
      swapExecIntentRefreshing,
      swapExecIntentApproved,
      bridgeIntent,
      bridgeIntentPending,
      bridgeIntentRefreshing,
      bridgeIntentApproved,
      bridgeExecIntent,
      bridgeExecIntentPending,
      bridgeExecIntentRefreshing,
      bridgeExecIntentApproved,
    ],
  );
}
