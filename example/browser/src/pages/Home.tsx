import { Navigate, Route, Routes } from "react-router";
import type { NexusClient } from "@avail-project/nexus-core";
import type { ExecuteContext, NetworkMode, TabConfig } from "../lib/types";
import type {
  SwapAndExecuteIntentViewModel,
  SwapIntentViewModel,
} from "../lib/nexus";
import { ConnectGate } from "../components/ConnectGate";
import { OperationPage } from "../components/OperationPage";

type HomeProps = {
  network: NetworkMode;
  tabs: TabConfig[];
  client: NexusClient | null;
  ready: boolean;
  address?: `0x${string}`;
  isConnected: boolean;
  onSwapIntent: ExecuteContext["onSwapIntent"];
  onSwapExecIntent: ExecuteContext["onSwapExecIntent"];
  swapIntent: SwapIntentViewModel | null;
  swapIntentPending: boolean;
  swapIntentRefreshing: boolean;
  swapIntentApproved: boolean;
  approveSwapIntent: () => void;
  denySwapIntent: () => void;
  clearSwapIntent: () => void;
  swapExecIntent: SwapAndExecuteIntentViewModel | null;
  swapExecIntentPending: boolean;
  swapExecIntentRefreshing: boolean;
  swapExecIntentApproved: boolean;
  approveSwapExecIntent: () => void;
  denySwapExecIntent: () => void;
  clearSwapExecIntent: () => void;
};

export default function Home({
  network,
  tabs,
  client,
  ready,
  address,
  isConnected,
  onSwapIntent,
  onSwapExecIntent,
  swapIntent,
  swapIntentPending,
  swapIntentRefreshing,
  swapIntentApproved,
  approveSwapIntent,
  denySwapIntent,
  clearSwapIntent,
  swapExecIntent,
  swapExecIntentPending,
  swapExecIntentRefreshing,
  swapExecIntentApproved,
  approveSwapExecIntent,
  denySwapExecIntent,
  clearSwapExecIntent,
}: HomeProps) {
  const defaultTab = isConnected ? tabs[0] : tabs.find((tab) => tab.id === "swap-exact-in");
  if (!defaultTab) return null;
  const sdkProps = {
    client,
    ready,
    address,
    onSwapIntent,
    onSwapExecIntent,
    swapIntent,
    swapIntentPending,
    swapIntentRefreshing,
    swapIntentApproved,
    approveSwapIntent,
    denySwapIntent,
    clearSwapIntent,
    swapExecIntent,
    swapExecIntentPending,
    swapExecIntentRefreshing,
    swapExecIntentApproved,
    approveSwapExecIntent,
    denySwapExecIntent,
    clearSwapExecIntent,
  };

  return (
    <Routes>
      <Route path="/" element={<Navigate to={defaultTab.path} replace />} />
      {tabs.map((tab) => (
        <Route
          key={tab.id}
          path={tab.path}
          element={isConnected || tab.id === "swap-exact-in"
            ? <OperationPage key={`${network}:${tab.id}`} config={tab} {...sdkProps} />
            : <ConnectGate />}
        />
      ))}
      <Route path="*" element={<Navigate to={defaultTab.path} replace />} />
    </Routes>
  );
}
