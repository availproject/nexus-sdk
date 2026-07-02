import type { Dispatch, SetStateAction } from "react";
import type { NexusClient, TokenBalance } from "@avail-project/nexus-core";

export type NetworkMode = "mainnet" | "canary" | "testnet";

export type TabId =
  | "swap-exact-out"
  | "swap-exact-in"
  | "swap-and-execute"
  | "bridge"
  | "bridge-and-execute";

export type ChainOption = { id: number; name: string };

export type TokenOption = {
  symbol: string;
  label: string;
  tokenAddress?: `0x${string}`;
  decimals?: number;
};

export type Phase = { key: string; label: string; doneWhen: string };
export type PhaseState = "idle" | "active" | "done";

export type HashRecord = { label: string; value: string; href?: string };

/* ── Rich result types for result cards ── */

export type SwapRouteStep = {
  type: "source" | "bridge" | "destination";
  chainId: number;
  chainName: string;
  tokenSymbol: string;
  amount: string;
  txHash?: string;
  explorerUrl?: string;
};

export type SwapResultData = {
  kind: "swap";
  route: SwapRouteStep[];
  intentExplorerUrl?: string;
  summary: string; // e.g. "2 source swaps, 1 bridge, 1 destination swap"
};

export type BridgeLink = {
  label: string;
  href: string;
  icon: "collection" | "fill" | "intent" | "execute" | "tx";
};

export type BridgeResultData = {
  kind: "bridge";
  summary: string; // e.g. "Bridged 100 USDC to Base"
  links: BridgeLink[];
};

export type OperationResult = {
  hashes: HashRecord[];
  marketUrl?: string;
  richResult?: SwapResultData | BridgeResultData;
};

export type HeroConfig = {
  icon: string;
  title: string;
  description: string;
  accentClass?: string;
  buttonLabel: string;
  buttonPendingLabel: string;
};

export type SourceOption = {
  id: string;
  chainId: number;
  chainName: string;
  chainLogo: string;
  tokenAddress: `0x${string}`;
  symbol: string;
  tokenLogo?: string;
  tokenName?: string;
  decimals?: number;
  balance: string;
  value: string;
};

export type ExecuteContext = {
  client: NexusClient;
  address: `0x${string}`;
  chainId: number;
  tokenSymbol: string;
  tokenAddress: `0x${string}` | undefined;
  amount: string;
  nativeAmount: string;
  recipient: string;
  sourceOptions: SourceOption[];
  selectedSources: string[];
  /** Per-source input amounts (human-readable), keyed by SourceOption.id.
   *  Populated only for "per-source" (exact-in) tabs. */
  sourceAmounts?: Record<string, string>;
  setCompletedSteps: Dispatch<SetStateAction<Set<string>>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  handleProgressEvent?: (event: unknown) => void;
};

/* ── Execution progress modal types ── */

export type StepState = "pending" | "active" | "submitted" | "done" | "failed";

export type NormalizedStep = {
  id: string;
  type: string;
  label: string;
  state: StepState;
  /** Raw SDK state string (e.g. "wallet_prompted", "started", "submitted",
   *  "confirmed") — kept alongside `state` so the UI can tell wallet-prompt
   *  steps apart from automated/server-side execution. */
  rawState?: string;
  chain?: { id: number; name: string; logo: string };
  token?: { symbol: string; amount: string; logo?: string };
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  /** Epoch ms when state transitioned to done/failed (for "X sec ago"). */
  completedAt?: number;
};

export type ProgressHeader = {
  sourceSymbols: string;
  amount: string;
  destTokenSymbol: string;
  destTokenLogo?: string;
  destChainName: string;
  destChainLogo?: string;
};

/** Source / fee data harvested from the approved intent — surfaced inside
 *  the progress modal (the "You Swapped" / "Total Fees" rows). */
export type ProgressResult = {
  sources?: Array<{
    chainId: number;
    chainName: string;
    chainLogo?: string;
    tokenSymbol: string;
    tokenLogo?: string;
    amount: string;
    value?: string;
  }>;
  sourcesTotal?: string;
  feesTotal?: string;
};

export type ProgressPhase =
  | "preparing"
  | "route_building"
  | "intent_building"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed";

export type ExecutionProgressState = {
  phase: ProgressPhase;
  steps: NormalizedStep[];
  operationType: "swap" | "bridge" | "bridgeAndExecute" | "swapAndExecute";
  resultLinks: Array<{ label: string; href: string }>;
  header?: ProgressHeader;
  result?: ProgressResult;
  /** Epoch ms when the modal was opened — used to compute completion duration. */
  startedAt?: number;
  /** Epoch ms when phase transitioned to completed. */
  completedAt?: number;
  /** Distinguish a user-cancelled flow (no funds moved) from a real on-chain
   *  failure (potentially with refund). Set when `phase` becomes "failed". */
  failureKind?: "cancelled" | "failed";
  /** Short human-readable reason shown beneath the amount on the failure hero. */
  failureReason?: string;
};

export type TabConfig = {
  id: TabId;
  path: string;
  navLabel: string;
  hero: HeroConfig;
  amountLabel: string;
  chainLabel: string;
  tokenLabel: string;
  defaultChainId: number;

  /**
   * How the form collects the swap amount.
   * - "single" (default): one global amount input (output amount for exact-out,
   *   input amount for bridge) + multi-select sources without per-source amounts.
   * - "per-source": each selected source carries its own input amount (exact-in).
   */
  amountMode?: "single" | "per-source";

  getChainOptions: (client: NexusClient | null) => ChainOption[];
  getTokenOptions: (client: NexusClient | null, chainId: number) => TokenOption[];

  balanceQueryKey: string;
  fetchBalances: (client: NexusClient) => Promise<TokenBalance[]>;

  calculateMax: (
    client: NexusClient,
    chainId: number,
    tokenSymbol: string,
    tokenAddress: `0x${string}` | undefined,
    sourceChainIds: number[],
    fromSources:
      | Array<{ chainId: number; tokenAddress: `0x${string}` }>
      | undefined,
  ) => Promise<{ maxAmount: string; symbol: string }>;

  filterSources?: (
    sources: SourceOption[],
    chainId: number,
    tokenSymbol: string,
  ) => SourceOption[];

  intentType: "swap" | "bridge" | "bridgeAndExecute" | "swapAndExecute";
  phases: Phase[];

  execute: (ctx: ExecuteContext) => Promise<OperationResult>;
};
