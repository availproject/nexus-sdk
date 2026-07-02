import { Navigate, Route, Routes } from "react-router-dom";
import type { NexusClient } from "@avail-project/nexus-core";
import type { NetworkMode, TabConfig } from "../lib/types";
import type {
  BridgeAndExecuteIntentViewModel,
  BridgeIntentViewModel,
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
  onSwapIntent: (data: any) => void;
  onBridgeIntent: (data: any) => void;
  onSwapExecIntent: (data: any) => void;
  onBridgeExecIntent: (data: any) => void;
  swapIntent: SwapIntentViewModel | null;
  swapIntentPending: boolean;
  swapIntentRefreshing: boolean;
  swapIntentApproved: boolean;
  approveSwapIntent: () => void;
  denySwapIntent: () => void;
  clearSwapIntent: () => void;
  bridgeIntent: BridgeIntentViewModel | null;
  bridgeIntentPending: boolean;
  bridgeIntentRefreshing: boolean;
  bridgeIntentApproved: boolean;
  approveBridgeIntent: () => void;
  denyBridgeIntent: () => void;
  clearBridgeIntent: () => void;
  swapExecIntent: SwapAndExecuteIntentViewModel | null;
  swapExecIntentPending: boolean;
  swapExecIntentRefreshing: boolean;
  swapExecIntentApproved: boolean;
  approveSwapExecIntent: () => void;
  denySwapExecIntent: () => void;
  clearSwapExecIntent: () => void;
  bridgeExecIntent: BridgeAndExecuteIntentViewModel | null;
  bridgeExecIntentPending: boolean;
  bridgeExecIntentRefreshing: boolean;
  bridgeExecIntentApproved: boolean;
  approveBridgeExecIntent: () => void;
  denyBridgeExecIntent: () => void;
  clearBridgeExecIntent: () => void;
};

export default function Home({
  tabs,
  client,
  ready,
  address,
  isConnected,
  onSwapIntent,
  onBridgeIntent,
  onSwapExecIntent,
  onBridgeExecIntent,
  swapIntent,
  swapIntentPending,
  swapIntentRefreshing,
  swapIntentApproved,
  approveSwapIntent,
  denySwapIntent,
  clearSwapIntent,
  bridgeIntent,
  bridgeIntentPending,
  bridgeIntentRefreshing,
  bridgeIntentApproved,
  approveBridgeIntent,
  denyBridgeIntent,
  clearBridgeIntent,
  swapExecIntent,
  swapExecIntentPending,
  swapExecIntentRefreshing,
  swapExecIntentApproved,
  approveSwapExecIntent,
  denySwapExecIntent,
  clearSwapExecIntent,
  bridgeExecIntent,
  bridgeExecIntentPending,
  bridgeExecIntentRefreshing,
  bridgeExecIntentApproved,
  approveBridgeExecIntent,
  denyBridgeExecIntent,
  clearBridgeExecIntent,
}: HomeProps) {
  if (!isConnected) {
    return <ConnectGate />;
  }

  const defaultTab = tabs[0];
  if (!defaultTab) return null;
  const sdkProps = {
    client,
    ready,
    address,
    onSwapIntent,
    onBridgeIntent,
    onSwapExecIntent,
    onBridgeExecIntent,
    swapIntent,
    swapIntentPending,
    swapIntentRefreshing,
    swapIntentApproved,
    approveSwapIntent,
    denySwapIntent,
    clearSwapIntent,
    bridgeIntent,
    bridgeIntentPending,
    bridgeIntentRefreshing,
    bridgeIntentApproved,
    approveBridgeIntent,
    denyBridgeIntent,
    clearBridgeIntent,
    swapExecIntent,
    swapExecIntentPending,
    swapExecIntentRefreshing,
    swapExecIntentApproved,
    approveSwapExecIntent,
    denySwapExecIntent,
    clearSwapExecIntent,
    bridgeExecIntent,
    bridgeExecIntentPending,
    bridgeExecIntentRefreshing,
    bridgeExecIntentApproved,
    approveBridgeExecIntent,
    denyBridgeExecIntent,
    clearBridgeExecIntent,
  };

  return (
    <Routes>
      <Route path="/" element={<Navigate to={defaultTab.path} replace />} />
      {tabs.map((tab) => (
        <Route
          key={tab.id}
          path={tab.path}
          element={<OperationPage key={tab.id} config={tab} {...sdkProps} />}
        />
      ))}
      <Route path="*" element={<Navigate to={defaultTab.path} replace />} />
    </Routes>
  );
}
