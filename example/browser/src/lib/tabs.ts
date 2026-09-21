import type {
  IntentEvent,
  IntentResult,
  NexusClient,
  SwapAndExecuteResult,
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
        if (operation.endsWith("Execute")) next.add("TRANSACTION_CONFIRMED");
        return next;
      });
      ctx.setStatusMessage(operation.endsWith("Execute") ? "Executing deposit..." : "");
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
      label: "Intent",
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
          onIntent: (data) => {
            // Intent is handled via useNexusSdk hook - called from App level
            return (
              ctx as unknown as { _onSwapIntent?: (d: typeof data) => Promise<void> }
            )._onSwapIntent?.(data);
          },
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
      "Pick the source assets you want to spend and set an amount for each. Nexus routes every input into your chosen destination token in a single flow.",
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
    const { client, chainId, tokenSymbol, sourceOptions, selectedSources } = ctx;
    const sourceAmounts = ctx.sourceAmounts ?? {};

    if (!ctx.tokenAddress) throw new Error("Select a destination token");
    const selectedToken = await client.getToken({ chainId, tokenAddress: ctx.tokenAddress });

    const sources = sourceOptions
      .filter((s) => selectedSources.includes(s.id))
      .filter((s) => Number(sourceAmounts[s.id] ?? "0") > 0)
      .map((s) => {
        if (s.decimals === undefined)
          throw new Error(`Missing decimals for ${s.symbol} on ${s.chainName}`);
        return {
          chainId: s.chainId,
          tokenAddress: s.tokenAddress,
          amountRaw: parseUnits(sourceAmounts[s.id]!, s.decimals),
        };
      });
    if (sources.length === 0)
      throw new Error("Enter an amount for at least one source asset");

    const result = await client.swapWithExactIn(
      {
        toChainId: chainId,
        toTokenAddress: selectedToken.address,
        sources,
      },
      {
        onEvent: createIntentEventHandler(ctx, "swap"),
        hooks: {
          onIntent: (data) => {
            // Intent is handled via useNexusSdk hook - called from App level
            return (
              ctx as unknown as { _onSwapIntent?: (d: typeof data) => Promise<void> }
            )._onSwapIntent?.(data);
          },
        },
      },
    );

    return buildSwapResult(client, result, chainId, tokenSymbol);
  },
};

export const SWAP_AND_EXECUTE_TAB: TabConfig = {
  id: "swap-and-execute",
  path: "/swap-and-execute",
  navLabel: "Swap & Execute",
  hero: {
    icon: "◎",
    title: "Swap & Execute",
    description:
      "Swap into the destination asset, then deposit it into the chain's lending market. The deposit layer is config-driven — adding new protocols, chains, or tokens stays local.",
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
    { key: "execute", label: "Execute", doneWhen: "TRANSACTION_CONFIRMED" },
  ],

  execute: async (ctx): Promise<OperationResult> => {
    const { client, address, chainId, tokenSymbol, amount } = ctx;
    const tokenOptions = getDepositTokenOptions(chainId);
    const selectedToken = tokenOptions.find(
      (t) => t.tokenAddress?.toLowerCase() === ctx.tokenAddress?.toLowerCase(),
    );
    if (!selectedToken)
      throw new Error("Token cannot be used as swap destination");

    const toAmount = parseUnits(amount, selectedToken.decimals!);
    const deposit = buildDepositExecute({
      chainId,
      symbol: tokenSymbol,
      amount: toAmount,
      wallet: address,
    });
    const fromSources = deriveSwapSources(ctx);

    const result = await client.swapAndExecute(
      {
        toChainId: chainId,
        toTokenAddress: selectedToken.tokenAddress!,
        toAmountRaw: toAmount,
        sources: fromSources,
        execute: deposit.execute,
      },
      {
        onEvent: createIntentEventHandler(ctx, "swapAndExecute"),
        hooks: {
          onIntent: (data) => {
            return (
              ctx as unknown as {
                _onSwapExecIntent?: (
                  d: typeof data,
                  context: import("./nexus").CompositeIntentContext,
                ) => Promise<void>;
              }
            )._onSwapExecIntent?.(data, {
              contractAddress: deposit.execute.to,
              tokenSymbol,
              amount,
              tokenApproval: deposit.execute.tokenApproval
                ? { symbol: tokenSymbol, amount }
                : undefined,
            });
          },
        },
      },
    );

    const typedResult = result as SwapAndExecuteResult;
    const hashes: Array<{ label: string; value: string; href?: string }> = [];
    const route: import("./types").SwapRouteStep[] = [];

    const swapResult = typedResult.swapResult;
    if (swapResult) {
      const intentResult = await buildSwapResult(client, swapResult, chainId, tokenSymbol, amount);
      hashes.push(...intentResult.hashes);
      if (intentResult.richResult?.kind === "swap") {
        route.push(...intentResult.richResult.route);
      }
    }
    route.push({
      type: "destination",
      chainId,
      chainName: chainName(client, chainId),
      tokenSymbol: `${tokenSymbol} → ${getDepositProtocol(chainId)?.label ?? "deposit"}`,
      amount: amount,
      txHash: typedResult.execute.txHash,
    });

    hashes.push({
      label: "Deposit tx",
      value: typedResult.execute.txHash,
      href: typedResult.execute.txExplorerUrl,
    });

    return {
      hashes,
      marketUrl: deposit.marketUrl,
      richResult: {
        kind: "swap",
        route,
        intentExplorerUrl: swapResult?.intentExplorerUrl || undefined,
        summary: `Swap & deposit ${amount} ${tokenSymbol} on ${chainName(client, chainId)}`,
      },
    };
  },
};

/* ── Tab collections by network ──────────────────────────────────── */

export const MAINNET_TABS: TabConfig[] = [
  EXACT_OUT_SWAP_TAB,
  EXACT_IN_SWAP_TAB,
  SWAP_AND_EXECUTE_TAB,
];

export function getTabsForNetwork(_network: NetworkMode): TabConfig[] {
  return MAINNET_TABS;
}
