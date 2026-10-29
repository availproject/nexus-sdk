import type {
  IntentEvent,
  IntentResult,
  NexusClient,
  SwapAndExecuteParams,
} from "@avail-project/nexus-core";
import { formatUnits, parseUnits } from "viem";
import type {
  TabConfig,
  ExecuteContext,
  OperationResult,
  NetworkMode,
  SwapRouteStep,
} from "./types";
import {
  getDepositSupportedChains,
  getDepositTokenOptions,
  getDepositProtocol,
  buildDepositExecute,
} from "./deposit";
import { getSwapChainOptions } from "./destinationTokens";
import { fetchUiBalances } from "./nexus";

/**
 * Look up a chain's display name from the SDK's chain registry. Falls back to
 * `Chain <id>` when the registry isn't yet loaded (client not initialized) or
 * the chain isn't recognized — keeps callers from having to maintain their own
 * id→name table.
 */
function chainName(client: NexusClient | null | undefined, chainId: number): string {
  const found = client?.getSupportedChains().find((chain) => chain.id === chainId);
  if (found) return found.name;
  return `Chain ${chainId}`;
}

/* ── Source derivation ────────────────────────────────────────────── */

function deriveSwapSources(ctx: ExecuteContext) {
  const { sourceOptions, selectedSources } = ctx;
  if (selectedSources.length === 0) return undefined;
  return sourceOptions
    .filter((s) => selectedSources.includes(s.id))
    .map((s) => ({ chainId: s.chainId, tokenAddress: s.tokenAddress }));
}

function deriveExactInSources(ctx: ExecuteContext) {
  const sourceAmounts = ctx.sourceAmounts ?? {};
  const sources = ctx.sourceOptions
    .filter((source) => ctx.selectedSources.includes(source.id))
    .filter((source) => Number(sourceAmounts[source.id] ?? "0") > 0)
    .map((source) => {
      if (source.decimals === undefined)
        throw new Error(`Missing decimals for ${source.symbol} on ${source.chainName}`);
      return {
        chainId: source.chainId,
        tokenAddress: source.tokenAddress,
        amountRaw: parseUnits(sourceAmounts[source.id]!, source.decimals),
      };
    });
  if (sources.length === 0)
    throw new Error("Enter an amount for at least one source asset");
  return sources;
}

/* ── Better Intent event → existing progress UI ──────────────────── */

function createIntentEventHandler(
  ctx: ExecuteContext,
  operation: "swap" | "swapAndExecute",
) {
  return (event: IntentEvent) => {
    ctx.handleProgressEvent?.(event);

    if (event.type === "quote") {
      ctx.setStatusMessage("Waiting for approval...");
      return;
    }

    if (event.type === "step") {
      if (event.state === "started") {
        const messages: Record<typeof event.step.type, string> = {
          erc20_approval: "Approve token in your wallet...",
          source_approval_signature: "Sign token approval in your wallet...",
          intent_signature: "Sign intent in your wallet...",
          native_transaction: "Submit source transaction...",
          intent_submission: "Submitting intent...",
          intent_fulfillment: "Waiting for fulfillment...",
        };
        ctx.setStatusMessage(messages[event.step.type]);
      }
      return;
    }

    if (event.status === "deposited") {
      ctx.setCompletedSteps((previous) => new Set(previous).add("INTENT_APPROVED"));
      ctx.setStatusMessage("Waiting for fulfillment...");
    } else if (event.status === "fulfilled") {
      ctx.setCompletedSteps((previous) => {
        const next = new Set(previous);
        next.add("INTENT_APPROVED");
        next.add("SWAP_COMPLETE");
        return next;
      });
      ctx.setStatusMessage(operation === "swapAndExecute" ? "Deposit fulfilled" : "");
    } else if (event.status === "expired") {
      ctx.setStatusMessage("Intent expired");
    }
  };
}

/* ── Tab configs ─────────────────────────────────────────────────── */

/**
 * Map an SDK SwapResult into the example app's OperationResult (tx hashes +
 * route visualization). Shared by the exact-out and exact-in swap tabs, which
 * both resolve to a SwapResult.
 */

function buildIntentHashes(client: NexusClient, result: IntentResult) {
  return [
    ...result.approvals.map((tx, index) => ({
      label: `Approval ${index + 1} (${chainName(client, tx.chainId)})`,
      value: tx.txHash,
      href: tx.txExplorerUrl,
    })),
    ...result.nativeTransactions.map((tx, index) => ({
      label: `Source tx ${index + 1}`,
      value: tx.txHash,
      href: tx.txExplorerUrl,
    })),
    {
      label: "RFF Intent",
      value: result.intentId,
      href: result.intentExplorerUrl,
    },
  ];
}

async function buildSwapResult(
  client: NexusClient,
  result: IntentResult,
  destChainId: number,
  destTokenSymbol: string,
  destFallbackAmount = "",
): Promise<OperationResult> {
  const [outputToken, ...inputTokens] = await Promise.all([result.quote.output, ...result.quote.input].map(
    (token) => client.getToken({ chainId: token.chainId, tokenAddress: token.tokenAddress }),
  ));
  const route: SwapRouteStep[] = result.quote.input.map((source, index) => ({
    type: "source",
    chainId: source.chainId,
    chainName: chainName(client, source.chainId),
    tokenSymbol: source.tokenSymbol,
    amount: formatUnits(
      source.totalRequiredRaw,
      inputTokens[index]!.decimals,
    ),
  }));
  route.push({
    type: "intent",
    chainId: destChainId,
    chainName: chainName(client, destChainId),
    tokenSymbol: destTokenSymbol,
    amount: "",
    explorerUrl: result.intentExplorerUrl,
  });
  route.push({
    type: "destination",
    chainId: destChainId,
    chainName: chainName(client, destChainId),
    tokenSymbol: destTokenSymbol,
    amount: formatUnits(
      result.quote.output.amountRaw,
      outputToken!.decimals,
    ) || destFallbackAmount,
  });

  return {
    hashes: buildIntentHashes(client, result),
    richResult: {
      kind: "swap",
      route,
      intentExplorerUrl: result.intentExplorerUrl,
      summary: `${result.quote.input.length} source${result.quote.input.length === 1 ? "" : "s"}, ${result.quote.provider} intent`,
    },
  };
}

export const EXACT_OUT_SWAP_TAB: TabConfig = {
  id: "swap-exact-out",
  path: "/swap-exact-out",
  navLabel: "Exact Out Swap",
  hero: {
    icon: "◎",
    title: "Exact Out Swap",
    description:
      "Select source balances, choose the destination chain and token, then request the exact output amount through Nexus routing.",
    buttonLabel: "Run Exact Out Swap",
    buttonPendingLabel: "Running exact out swap...",
  },
  amountLabel: "Receive amount",
  chainLabel: "Destination chain",
  tokenLabel: "Destination token",
  defaultChainId: 8453,

  getChainOptions: (client) => getSwapChainOptions(client),

  balanceQueryKey: "swap-balances",
  fetchBalances: (client) => fetchUiBalances(client),

  intentType: "swap",

  phases: [
    { key: "approve", label: "Approve", doneWhen: "INTENT_APPROVED" },
    { key: "swap", label: "Swap", doneWhen: "SWAP_COMPLETE" },
  ],

  execute: async (ctx): Promise<OperationResult> => {
    const { client, chainId, tokenSymbol, amount } = ctx;
    if (!ctx.tokenAddress) throw new Error("Select a destination token");
    const selectedToken = await client.getToken({ chainId, tokenAddress: ctx.tokenAddress });

    const toAmount = parseUnits(amount, selectedToken.decimals!);
    const fromSources = deriveSwapSources(ctx);

    const result = await client.swapWithExactOut(
      {
        toChainId: chainId,
        toTokenAddress: selectedToken.address,
        toAmountRaw: toAmount,
        sources: fromSources,
      },
      {
        onEvent: createIntentEventHandler(ctx, "swap"),
        hooks: {
          onIntent: ctx.onSwapIntent,
        },
      },
    );

    return buildSwapResult(client, result, chainId, tokenSymbol, amount);
  },
};

export const EXACT_IN_SWAP_TAB: TabConfig = {
  id: "swap-exact-in",
  path: "/swap-exact-in",
  navLabel: "Exact In Swap",
  hero: {
    icon: "◉",
    title: "Exact In Swap",
    description:
      "Pick source assets and amounts to preview your rate. Connect your wallet when you are ready to swap.",
    buttonLabel: "Review Exact In Swap",
    buttonPendingLabel: "Building exact in swap...",
  },
  amountLabel: "Receive",
  chainLabel: "Destination chain",
  tokenLabel: "Destination token",
  defaultChainId: 8453,

  getChainOptions: (client) => getSwapChainOptions(client),

  balanceQueryKey: "swap-balances",
  fetchBalances: (client) => fetchUiBalances(client),

  amountMode: "per-source",
  intentType: "swap",

  phases: [
    { key: "approve", label: "Approve", doneWhen: "INTENT_APPROVED" },
    { key: "swap", label: "Swap", doneWhen: "SWAP_COMPLETE" },
  ],

  execute: async (ctx): Promise<OperationResult> => {
    const { client, chainId, tokenSymbol } = ctx;

    if (!ctx.tokenAddress) throw new Error("Select a destination token");
    const selectedToken = await client.getToken({ chainId, tokenAddress: ctx.tokenAddress });

    const sources = deriveExactInSources(ctx);

    const result = await client.swapWithExactIn(
      {
        toChainId: chainId,
        toTokenAddress: selectedToken.address,
        sources,
      },
      {
        onEvent: createIntentEventHandler(ctx, "swap"),
        hooks: {
          onIntent: ctx.onSwapIntent,
        },
      },
    );

    return buildSwapResult(client, result, chainId, tokenSymbol);
  },
};

async function executeSwapAndDeposit(
  ctx: ExecuteContext,
  tradeType: "exactInput" | "exactOutput",
): Promise<OperationResult> {
  const { client, address, chainId, tokenSymbol } = ctx;
  if (!address) throw new Error("Connect wallet first");
  const selectedToken = getDepositTokenOptions(chainId).find(
    (token) => token.tokenAddress?.toLowerCase() === ctx.tokenAddress?.toLowerCase(),
  );
  if (!selectedToken?.tokenAddress)
    throw new Error("Token cannot be used as swap destination");
  const decimals = selectedToken.decimals;
  if (decimals === undefined)
    throw new Error("Missing destination token decimals");

  const exactInput = tradeType === "exactInput";
  const depositedAmountRaw = exactInput ? 0n : parseUnits(ctx.amount, decimals);
  const deposit = buildDepositExecute({
    chainId, symbol: tokenSymbol, amount: depositedAmountRaw, wallet: address,
  });
  const input: SwapAndExecuteParams = exactInput
    ? {
        tradeType: "exactInput",
        toChainId: chainId,
        toTokenAddress: selectedToken.tokenAddress,
        sources: deriveExactInSources(ctx),
        execute: deposit.execute,
      }
    : {
        tradeType: "exactOutput",
        toChainId: chainId,
        toTokenAddress: selectedToken.tokenAddress,
        toAmountRaw: depositedAmountRaw,
        sources: deriveSwapSources(ctx),
        execute: deposit.execute,
      };
  const result = await client.swapAndExecute(input, {
    useProviderDestinationExecution: true,
    onEvent: createIntentEventHandler(ctx, "swapAndExecute"),
    hooks: {
      onIntent: (data) => {
        ctx.setStatusMessage("Waiting for approval...");
        return ctx.onSwapExecIntent(data);
      },
    },
    beforeExecute: async (amounts) => {
      const updated = buildDepositExecute({
        chainId, symbol: tokenSymbol, amount: amounts.executeAmountRaw, wallet: address,
      });
      return { data: updated.execute.data, value: updated.execute.value };
    },
  });

  ctx.setCompletedSteps((previous) => new Set(previous).add("TRANSACTION_CONFIRMED"));
  ctx.setStatusMessage("");
  const amount = formatUnits(result.executeAmountRaw, decimals);
  const hashes: Array<{ label: string; value: string; href?: string }> = [];
  const route: SwapRouteStep[] = [];
  const swapResult = result.swapResult;
  if (swapResult) {
    const intentResult = await buildSwapResult(client, swapResult, chainId, tokenSymbol, amount);
    hashes.push(...intentResult.hashes);
    if (intentResult.richResult?.kind === "swap") {
      route.push(...intentResult.richResult.route.filter((step) => step.type !== "destination"));
    }
  }
  route.push({
    type: "destination",
    chainId,
    chainName: chainName(client, chainId),
    tokenSymbol: `${tokenSymbol} → ${getDepositProtocol(chainId)?.label ?? "deposit"}`,
    amount,
    explorerUrl: swapResult?.intentExplorerUrl,
  });

  return {
    hashes,
    marketUrl: deposit.marketUrl,
    richResult: {
      kind: "swap",
      route,
      intentExplorerUrl: swapResult?.intentExplorerUrl || undefined,
      summary: `${result.swapSkipped ? "Deposit" : "Swap & deposit"} ${amount} ${tokenSymbol} on ${chainName(client, chainId)}`,
    },
  };
}

export const SWAP_AND_EXECUTE_TAB: TabConfig = {
  id: "swap-and-execute",
  path: "/swap-and-execute",
  navLabel: "Exact Out Deposit",
  hero: {
    icon: "◎",
    title: "Exact Out Swap & Execute",
    description:
      "Choose a deposit amount. Relay swaps your selected funds and supplies the tokens to the lending market on your behalf. The route must select one funding leg.",
    accentClass: "hero-card-accent",
    buttonLabel: "Swap & Deposit",
    buttonPendingLabel: "Running swap and deposit...",
  },
  amountLabel: "Deposit amount",
  chainLabel: "Destination chain",
  tokenLabel: "Deposit token",
  defaultChainId: 8453,

  getChainOptions: (_client) => getDepositSupportedChains(),
  getTokenOptions: (_client, chainId) => getDepositTokenOptions(chainId),

  balanceQueryKey: "swap-balances",
  fetchBalances: (client) => fetchUiBalances(client),

  intentType: "swapAndExecute",

  phases: [
    { key: "approve", label: "Approve", doneWhen: "INTENT_APPROVED" },
    { key: "swap", label: "Swap", doneWhen: "SWAP_COMPLETE" },
    { key: "execute", label: "Deposit", doneWhen: "TRANSACTION_CONFIRMED" },
  ],

  execute: (ctx) => executeSwapAndDeposit(ctx, "exactOutput"),
};

export const EXACT_IN_SWAP_AND_EXECUTE_TAB: TabConfig = {
  ...SWAP_AND_EXECUTE_TAB,
  id: "swap-and-execute-exact-in",
  path: "/swap-and-execute-exact-in",
  navLabel: "Exact In Deposit",
  hero: {
    ...SWAP_AND_EXECUTE_TAB.hero,
    title: "Exact In Swap & Execute",
    description:
      "Choose source amounts. Relay deposits a fixed amount below the guaranteed minimum, reserving 1% capped at $1. Remaining output goes to your wallet. The route must select one funding leg.",
  },
  amountLabel: "Deposit",
  amountMode: "per-source",
  execute: (ctx) => executeSwapAndDeposit(ctx, "exactInput"),
};

/* ── Tab collections by network ──────────────────────────────────── */

export const MAINNET_TABS: TabConfig[] = [
  EXACT_OUT_SWAP_TAB,
  EXACT_IN_SWAP_TAB,
  SWAP_AND_EXECUTE_TAB,
  EXACT_IN_SWAP_AND_EXECUTE_TAB,
];

export function getTabsForNetwork(_network: NetworkMode): TabConfig[] {
  return MAINNET_TABS;
}
