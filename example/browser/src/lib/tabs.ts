import type {
  IntentEvent,
  IntentResult,
  NexusClient,
  BridgeAndExecuteResult,
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
import {
  getSupportedChains,
  getSupportedTokens,
  filterBridgeSources,
} from "./bridge";
import { getSwapChainOptions, getSwapTokenOptions } from "./destinationTokens";
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

function deriveBridgeSourceChains(ctx: ExecuteContext): number[] | undefined {
  const { sourceOptions, selectedSources } = ctx;
  if (selectedSources.length === 0) return undefined;
  const chainIds = sourceOptions
    .filter((s) => selectedSources.includes(s.id))
    .map((s) => s.chainId);
  return [...new Set(chainIds)];
}

/* ── Better Intent event → existing progress UI ──────────────────── */

function createIntentEventHandler(
  ctx: ExecuteContext,
  operation: "swap" | "bridge" | "swapAndExecute" | "bridgeAndExecute",
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
        next.add(operation.includes("swap") ? "SWAP_COMPLETE" : "INTENT_FULFILLED");
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
function tokenDecimals(client: NexusClient, chainId: number, address: `0x${string}`) {
  const chain = client.getSupportedChains().find((entry) => entry.id === chainId);
  return chain?.tokens.find(
    (token) => token.address.toLowerCase() === address.toLowerCase(),
  )?.decimals ?? 18;
}

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

function buildSwapResult(
  client: NexusClient,
  result: IntentResult,
  destChainId: number,
  destTokenSymbol: string,
  destFallbackAmount = "",
): OperationResult {
  const route: SwapRouteStep[] = result.quote.input.map((source) => ({
    type: "source",
    chainId: source.chainId,
    chainName: chainName(client, source.chainId),
    tokenSymbol: source.tokenSymbol,
    amount: formatUnits(
      source.totalRequiredRaw,
      tokenDecimals(client, source.chainId, source.tokenAddress),
    ),
  }));
  route.push({
    type: "bridge",
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
      tokenDecimals(client, destChainId, result.quote.output.tokenAddress),
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
  getTokenOptions: (client, chainId) => getSwapTokenOptions(client, chainId),

  balanceQueryKey: "swap-balances",
  fetchBalances: (client) => fetchUiBalances(client, "swap"),

  intentType: "swap",

  phases: [
    { key: "approve", label: "Approve", doneWhen: "INTENT_APPROVED" },
    { key: "swap", label: "Swap", doneWhen: "SWAP_COMPLETE" },
  ],

  execute: async (ctx): Promise<OperationResult> => {
    const { client, chainId, tokenSymbol, amount } = ctx;
    const tokenOptions = getSwapTokenOptions(client, chainId);
    const selectedToken = tokenOptions.find((t) => t.symbol === tokenSymbol);
    if (!selectedToken)
      throw new Error("Destination token not available on selected chain");

    const toAmount = parseUnits(amount, selectedToken.decimals!);
    const fromSources = deriveSwapSources(ctx);

    const result = await client.swapWithExactOut(
      {
        toChainId: chainId,
        toTokenAddress: selectedToken.tokenAddress!,
        toAmountRaw: toAmount,
        sources: fromSources,
      },
      {
        onEvent: createIntentEventHandler(ctx, "swap"),
        hooks: {
          onIntent: (data) => {
            // Intent is handled via useNexusSdk hook - called from App level
            (
              ctx as unknown as { _onSwapIntent?: (d: typeof data) => void }
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
  getTokenOptions: (client, chainId) => getSwapTokenOptions(client, chainId),

  balanceQueryKey: "swap-balances",
  fetchBalances: (client) => fetchUiBalances(client, "swap"),

  amountMode: "per-source",
  intentType: "swap",

  phases: [
    { key: "approve", label: "Approve", doneWhen: "INTENT_APPROVED" },
    { key: "swap", label: "Swap", doneWhen: "SWAP_COMPLETE" },
  ],

  execute: async (ctx): Promise<OperationResult> => {
    const { client, chainId, tokenSymbol, sourceOptions, selectedSources } = ctx;
    const sourceAmounts = ctx.sourceAmounts ?? {};

    const tokenOptions = getSwapTokenOptions(client, chainId);
    const selectedToken = tokenOptions.find((t) => t.symbol === tokenSymbol);
    if (!selectedToken)
      throw new Error("Destination token not available on selected chain");

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
        toTokenAddress: selectedToken.tokenAddress!,
        sources,
      },
      {
        onEvent: createIntentEventHandler(ctx, "swap"),
        hooks: {
          onIntent: (data) => {
            // Intent is handled via useNexusSdk hook - called from App level
            (
              ctx as unknown as { _onSwapIntent?: (d: typeof data) => void }
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
  fetchBalances: (client) => fetchUiBalances(client, "swap"),

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
      (t) => t.symbol.toLowerCase() === tokenSymbol.toLowerCase(),
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
            (
              ctx as unknown as {
                _onSwapExecIntent?: (
                  d: typeof data,
                  context: import("./nexus").CompositeIntentContext,
                ) => void;
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
      const intentResult = buildSwapResult(client, swapResult, chainId, tokenSymbol, amount);
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

export const BRIDGE_TAB: TabConfig = {
  id: "bridge",
  path: "/bridge",
  navLabel: "Bridge",
  hero: {
    icon: "◎",
    title: "Bridge",
    description:
      "Bridge tokens to any supported destination chain using Nexus. Select source chains or let the SDK auto-select optimal sources.",
    buttonLabel: "Bridge",
    buttonPendingLabel: "Bridging...",
  },
  amountLabel: "Receive amount",
  chainLabel: "Destination chain",
  tokenLabel: "Token",
  defaultChainId: 8453,

  getChainOptions: (client) => (client ? getSupportedChains(client) : []),
  getTokenOptions: (client, chainId) =>
    client ? getSupportedTokens(client, chainId) : [],

  balanceQueryKey: "bridge-balances",
  fetchBalances: (client) => fetchUiBalances(client, "bridge"),

  intentType: "bridge",

  filterSources: filterBridgeSources,

  phases: [
    { key: "approve", label: "Approve", doneWhen: "INTENT_APPROVED" },
    { key: "bridge", label: "Bridge", doneWhen: "INTENT_FULFILLED" },
  ],

  execute: async (ctx): Promise<OperationResult> => {
    const { client, chainId, tokenSymbol, amount } = ctx;
    const amountBigInt = client.convertTokenReadableAmountToBigInt(
      amount,
      tokenSymbol,
      chainId,
    );
    const sourceChains = deriveBridgeSourceChains(ctx);

    const toNativeAmountRaw = ctx.nativeAmount.trim()
      ? client.convertTokenReadableAmountToBigInt(
          ctx.nativeAmount,
          client.chainList.getNativeToken(chainId).symbol,
          chainId,
        )
      : undefined;

    const recipient = ctx.recipient.trim()
      ? (ctx.recipient.trim() as `0x${string}`)
      : undefined;

    const result = (await client.bridge(
      {
        toTokenSymbol: tokenSymbol,
        toAmountRaw: amountBigInt,
        toChainId: chainId,
        toNativeAmountRaw,
        recipient,
        sources: sourceChains,
      },
      {
        fillTimeoutMinutes: 4,
        onEvent: createIntentEventHandler(ctx, "bridge"),
        hooks: {
          onIntent: (data) => {
            (
              ctx as unknown as { _onBridgeIntent?: (d: typeof data) => void }
            )._onBridgeIntent?.(data);
          },
          onAllowance: ({ allow, allowances }) => allow(allowances.map(() => "min")),
        },
      },
    ));

    const links: import("./types").BridgeLink[] = [];
    for (const tx of [...result.approvals, ...result.nativeTransactions]) {
      links.push({
        label: `Source transaction (${chainName(client, tx.chainId)})`,
        href: tx.txExplorerUrl,
        icon: "collection",
      });
    }
    if (result.intentExplorerUrl) {
      links.push({
        label: "Intent",
        href: result.intentExplorerUrl,
        icon: "intent",
      });
    }

    return {
      hashes: buildIntentHashes(client, result),
      richResult: {
        kind: "bridge",
        summary: `Bridged ${amount} ${tokenSymbol} to ${chainName(client, chainId)}`,
        links,
      },
    };
  },
};

export const BRIDGE_AND_EXECUTE_TAB: TabConfig = {
  id: "bridge-and-execute",
  path: "/bridge-and-execute",
  navLabel: "Bridge & Execute",
  hero: {
    icon: "◎",
    title: "Bridge & Execute",
    description:
      "Bridge tokens to the destination chain and deposit them into its lending market in one operation. The bridge step is skipped if sufficient funds are already available.",
    accentClass: "hero-card-accent",
    buttonLabel: "Bridge & Deposit",
    buttonPendingLabel: "Bridging and depositing...",
  },
  amountLabel: "Deposit amount",
  chainLabel: "Destination chain",
  tokenLabel: "Deposit token",
  defaultChainId: 8453,

  getChainOptions: (_client) => getDepositSupportedChains(),
  getTokenOptions: (_client, chainId) => getDepositTokenOptions(chainId),

  balanceQueryKey: "bridge-balances",
  fetchBalances: (client) => fetchUiBalances(client, "bridge"),

  intentType: "bridgeAndExecute",

  filterSources: filterBridgeSources,

  phases: [
    { key: "approve", label: "Approve", doneWhen: "INTENT_APPROVED" },
    { key: "bridge", label: "Bridge", doneWhen: "INTENT_FULFILLED" },
    { key: "execute", label: "Execute", doneWhen: "TRANSACTION_CONFIRMED" },
  ],

  execute: async (ctx): Promise<OperationResult> => {
    const { client, address, chainId, tokenSymbol, amount } = ctx;
    const amountBigInt = client.convertTokenReadableAmountToBigInt(
      amount,
      tokenSymbol,
      chainId,
    );
    const deposit = buildDepositExecute({
      chainId,
      symbol: tokenSymbol,
      amount: amountBigInt,
      wallet: address,
    });
    const sourceChains = deriveBridgeSourceChains(ctx);

    // bridgeAndExecute uses ExecuteParams.tokenApproval (toTokenSymbol)
    // while swapAndExecute uses SwapExecuteParams.tokenApproval (toTokenAddress)
    const { tokenApproval: depositApproval, ...depositRest } = deposit.execute;
    const bridgeExecute = {
      ...depositRest,
      ...(depositApproval
        ? {
            tokenApproval: {
              toTokenSymbol: tokenSymbol,
              amount: depositApproval.amount,
              spender: depositApproval.spender,
            },
          }
        : {}),
    };

    const result = (await client.bridgeAndExecute(
      {
        toChainId: chainId,
        toTokenSymbol: tokenSymbol,
        toAmountRaw: amountBigInt,
        sources: sourceChains,
        execute: bridgeExecute,
      },
      {
        onEvent: createIntentEventHandler(ctx, "bridgeAndExecute"),
        hooks: {
          onIntent: (data) => {
            (
              ctx as unknown as {
                _onBridgeExecIntent?: (
                  d: typeof data,
                  context: import("./nexus").CompositeIntentContext,
                ) => void;
              }
            )._onBridgeExecIntent?.(data, {
              contractAddress: deposit.execute.to,
              tokenSymbol,
              amount,
              tokenApproval: depositApproval
                ? { symbol: tokenSymbol, amount }
                : undefined,
            });
          },
        },
      },
    )) as BridgeAndExecuteResult;

    const hashes: Array<{ label: string; value: string; href?: string }> = [];
    const links: import("./types").BridgeLink[] = [];

    if (!result.bridgeSkipped && result.bridgeResult.intentExplorerUrl) {
      hashes.push({
        label: "Bridge",
        value: result.bridgeResult.intentExplorerUrl,
        href: result.bridgeResult.intentExplorerUrl,
      });
      links.push({
        label: "Intent",
        href: result.bridgeResult.intentExplorerUrl,
        icon: "intent",
      });
    }

    hashes.push({
      label: "Execute tx",
      value: result.execute.txHash,
      href: result.execute.txExplorerUrl,
    });
    if (result.execute.txExplorerUrl) {
      links.push({
        label: `Deposit (${chainName(client, chainId)})`,
        href: result.execute.txExplorerUrl,
        icon: "execute",
      });
    }

    return {
      hashes,
      marketUrl: deposit.marketUrl,
      richResult: {
        kind: "bridge",
        summary: `Bridged & deposited ${amount} ${tokenSymbol} on ${chainName(client, chainId)}`,
        links,
      },
    };
  },
};

/* ── Tab collections by network ──────────────────────────────────── */

export const MAINNET_TABS: TabConfig[] = [
  EXACT_OUT_SWAP_TAB,
  EXACT_IN_SWAP_TAB,
  SWAP_AND_EXECUTE_TAB,
  BRIDGE_TAB,
  BRIDGE_AND_EXECUTE_TAB,
];

export function getTabsForNetwork(_network: NetworkMode): TabConfig[] {
  return MAINNET_TABS;
}
