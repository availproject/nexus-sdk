import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Route, Routes, useLocation } from "react-router-dom";
import { useConnection } from "wagmi";
import { Toaster } from "sonner";
import type { TokenBalance } from "@avail-project/nexus-core";
import type { ExecutionProgressState } from "./lib/types";
import type { NetworkMode } from "./lib/types";
import { getTabsForNetwork } from "./lib/tabs";
import { useNexusSdk } from "./lib/nexus";
import { AppShell } from "./components/AppShell";
import { FlowModal } from "./components/FlowModal";
import Home from "./pages/Home";
import StressTest from "./pages/StressTest";
import "./App.css";

const THEMES = ["charm", "ocean", "ember"] as const;
type ThemeName = (typeof THEMES)[number];

function useThemeAndMode() {
  const [theme, setTheme] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return "charm";
    const saved = window.localStorage.getItem("nexus-theme");
    return THEMES.includes(saved as ThemeName) ? (saved as ThemeName) : "charm";
  });

  const [mode, setMode] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage.getItem("nexus-mode");
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.palette = theme;
    document.documentElement.dataset.theme = mode === "light" ? "light" : "";
    window.localStorage.setItem("nexus-theme", theme);
    window.localStorage.setItem("nexus-mode", mode);
  }, [theme, mode]);

  return {
    theme,
    mode,
    cycleTheme: () =>
      setTheme((current) => {
        const idx = THEMES.indexOf(current);
        return THEMES[(idx + 1) % THEMES.length] ?? "charm";
      }),
    toggleMode: () => setMode((current) => (current === "dark" ? "light" : "dark")),
  };
}

const NETWORK_MODES: readonly NetworkMode[] = ["mainnet", "canary", "testnet"];

function useNetwork() {
  const [network, setNetwork] = useState<NetworkMode>(() => {
    if (typeof window === "undefined") return "mainnet";
    const saved = window.localStorage.getItem("nexus-network");
    return NETWORK_MODES.includes(saved as NetworkMode)
      ? (saved as NetworkMode)
      : "mainnet";
  });

  useEffect(() => {
    window.localStorage.setItem("nexus-network", network);
  }, [network]);

  return { network, selectNetwork: setNetwork };
}

function useForceMayan() {
  const [forceMayan, setForceMayan] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("nexus-force-mayan") === "1";
  });

  useEffect(() => {
    window.localStorage.setItem("nexus-force-mayan", forceMayan ? "1" : "0");
  }, [forceMayan]);

  return { forceMayan, toggleForceMayan: () => setForceMayan((value) => !value) };
}

const MOCK_COMPLETED_STATE: ExecutionProgressState = {
  phase: "completed",
  operationType: "bridge",
  resultLinks: [
    { label: "View intent", href: "#" },
    { label: "Deposit tx", href: "#" },
  ],
  steps: [
    { id: "1", type: "allowance_approval", label: "Approve USDC on Ethereum", state: "done", chain: { id: 1, name: "Ethereum", logo: "" }, token: { symbol: "USDC", amount: "100.00" } },
    { id: "2", type: "request_signing", label: "Sign request", state: "done" },
    { id: "3", type: "vault_deposit", label: "Deposit on Ethereum", state: "done", chain: { id: 1, name: "Ethereum", logo: "" }, token: { symbol: "USDC", amount: "100.00" } },
    { id: "4", type: "request_submission", label: "Submit RFF", state: "done" },
    { id: "5", type: "bridge_fill", label: "Bridge to Arbitrum", state: "done", chain: { id: 42161, name: "Arbitrum", logo: "" } },
  ],
};

const MOCK_FAILED_STATE: ExecutionProgressState = {
  phase: "failed",
  operationType: "bridge",
  resultLinks: [],
  steps: [
    { id: "1", type: "allowance_approval", label: "Approve USDC on Ethereum", state: "done", chain: { id: 1, name: "Ethereum", logo: "" }, token: { symbol: "USDC", amount: "100.00" } },
    { id: "2", type: "request_signing", label: "Sign request", state: "done" },
    { id: "3", type: "vault_deposit", label: "Deposit on Ethereum", state: "failed", chain: { id: 1, name: "Ethereum", logo: "" }, token: { symbol: "USDC", amount: "100.00" }, error: "Transaction reverted: insufficient gas" },
    { id: "4", type: "request_submission", label: "Submit RFF", state: "pending" },
    { id: "5", type: "bridge_fill", label: "Bridge to Arbitrum", state: "pending", chain: { id: 42161, name: "Arbitrum", logo: "" } },
  ],
};

export default function App() {
  const { address, isConnected } = useConnection();
  const { network, selectNetwork } = useNetwork();
  const { forceMayan, toggleForceMayan } = useForceMayan();
  const { mode, toggleMode } = useThemeAndMode();
  const queryClient = useQueryClient();
  const location = useLocation();

  // Debug: Cmd/Ctrl+Shift+K to preview success celebration
  const [debugModal, setDebugModal] = useState<ExecutionProgressState | null>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.code === "KeyK") {
        e.preventDefault();
        setDebugModal(MOCK_COMPLETED_STATE);
      }
      if (e.code === "KeyJ") {
        e.preventDefault();
        setDebugModal(MOCK_FAILED_STATE);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sdk = useNexusSdk(network, forceMayan);

  const tabs = useMemo(() => getTabsForNetwork(network), [network]);

  const isBridgeTab = location.pathname.startsWith("/bridge");
  const activeBalanceKey = isBridgeTab ? "bridge-balances" : "swap-balances";

  // Read balance data from cache without creating a skipToken observer
  const [cachedAssets, setCachedAssets] = useState<TokenBalance[]>([]);
  const [balancesFetching, setBalancesFetching] = useState(false);
  useEffect(() => {
    let prev: TokenBalance[] | undefined;
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const data = queryClient.getQueryData<TokenBalance[]>([activeBalanceKey]);
      if (data !== prev) {
        prev = data;
        setCachedAssets(data ?? []);
      }
      const fetching = queryClient.isFetching({ queryKey: [activeBalanceKey] }) > 0;
      setBalancesFetching(fetching);
    });
    // Sync initial
    const initial = queryClient.getQueryData<TokenBalance[]>([activeBalanceKey]);
    prev = initial;
    setCachedAssets(initial ?? []);
    return unsubscribe;
  }, [queryClient, activeBalanceKey]);

  const refreshBalances = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [activeBalanceKey] });
  }, [queryClient, activeBalanceKey]);

  return (
    <>
      <AppShell
        network={network}
        onSelectNetwork={selectNetwork}
        forceMayan={forceMayan}
        onToggleForceMayan={toggleForceMayan}
        mode={mode}
        onToggleMode={toggleMode}
        tabs={tabs}
        assets={cachedAssets}
        balancesLoading={balancesFetching}
        onRefreshBalances={refreshBalances}
      >
        <Routes>
          <Route
            path="/stress-test"
            element={<StressTest isConnected={isConnected} />}
          />
          <Route
            path="/*"
            element={
              <Home
                network={network}
                tabs={tabs}
                client={sdk.client}
                ready={sdk.ready}
                address={address}
                isConnected={isConnected}
                onSwapIntent={sdk.onSwapIntent}
                onBridgeIntent={sdk.onBridgeIntent}
                onSwapExecIntent={sdk.onSwapExecIntent}
                onBridgeExecIntent={sdk.onBridgeExecIntent}
                swapIntent={sdk.swapIntent}
                swapIntentPending={sdk.swapIntentPending}
                swapIntentRefreshing={sdk.swapIntentRefreshing}
                swapIntentApproved={sdk.swapIntentApproved}
                approveSwapIntent={sdk.approveSwapIntent}
                denySwapIntent={sdk.denySwapIntent}
                clearSwapIntent={sdk.clearSwapIntent}
                bridgeIntent={sdk.bridgeIntent}
                bridgeIntentPending={sdk.bridgeIntentPending}
                bridgeIntentRefreshing={sdk.bridgeIntentRefreshing}
                bridgeIntentApproved={sdk.bridgeIntentApproved}
                approveBridgeIntent={sdk.approveBridgeIntent}
                denyBridgeIntent={sdk.denyBridgeIntent}
                clearBridgeIntent={sdk.clearBridgeIntent}
                swapExecIntent={sdk.swapExecIntent}
                swapExecIntentPending={sdk.swapExecIntentPending}
                swapExecIntentRefreshing={sdk.swapExecIntentRefreshing}
                swapExecIntentApproved={sdk.swapExecIntentApproved}
                approveSwapExecIntent={sdk.approveSwapExecIntent}
                denySwapExecIntent={sdk.denySwapExecIntent}
                clearSwapExecIntent={sdk.clearSwapExecIntent}
                bridgeExecIntent={sdk.bridgeExecIntent}
                bridgeExecIntentPending={sdk.bridgeExecIntentPending}
                bridgeExecIntentRefreshing={sdk.bridgeExecIntentRefreshing}
                bridgeExecIntentApproved={sdk.bridgeExecIntentApproved}
                approveBridgeExecIntent={sdk.approveBridgeExecIntent}
                denyBridgeExecIntent={sdk.denyBridgeExecIntent}
                clearBridgeExecIntent={sdk.clearBridgeExecIntent}
              />
            }
          />
        </Routes>
      </AppShell>


      {debugModal && (
        <FlowModal
          intentType={debugModal.operationType}
          intent={null}
          intentPending={false}
          intentRefreshing={false}
          intentApproved={false}
          onApprove={() => {}}
          onDeny={() => {}}
          progressState={debugModal}
          onDismissProgress={() => setDebugModal(null)}
        />
      )}

      <Toaster
        position="top-right"
        theme={mode}
        toastOptions={{
          classNames: {
            success: "toast-success",
            error: "toast-error",
          },
        }}
      />
    </>
  );
}
