import type {
  NexusClient,
  BridgeResult,
  BridgeAndExecuteResult,
  SwapResult,
  SwapAndExecuteResult,
  SwapEvent,
  BridgeEvent,
  SwapAndExecuteEvent,
  BridgeAndExecuteEvent,
} from "@avail-project/nexus-core";
import { parseUnits } from "viem";
import { D } from "./math";
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
  extractBridgeResultHashes,
} from "./bridge";
import { getSwapChainOptions, getSwapTokenOptions } from "./destinationTokens";

/**
 * Look up a chain's display name from the SDK's chain registry. Falls back to
 * `Chain <id>` when the registry isn't yet loaded (client not initialized) or
 * the chain isn't recognized — keeps callers from having to maintain their own
 * id→name table.
 */
function chainName(client: NexusClient | null | undefined, chainId: number): string {
  try {
    const found = client?.chainList.chains.find((c) => c.id === chainId);
    if (found) return found.name;
  } catch {
    // chainList getter throws if the client hasn't finished initialize().
  }
  return `Chain ${chainId}`;
}

/* ── Max-calc strategies ──────────────────────────────────────────── */

async function swapMax(
  client: NexusClient,
  chainId: number,
  _tokenSymbol: string,
  tokenAddress: `0x${string}` | undefined,
  _sourceChainIds: number[],
  fromSources:
    | Array<{ chainId: number; tokenAddress: `0x${string}` }>
    | undefined,
) {
  if (!tokenAddress) throw new Error("Token address required for swap max");
  const result = await client.calculateMaxForSwap({
    toChainId: chainId,
    toTokenAddress: tokenAddress,
    sources: fromSources,
  });
  return { maxAmount: result.maxAmount, symbol: result.symbol };
}

async function bridgeMax(
  client: NexusClient,
  chainId: number,
  tokenSymbol: string,
  _tokenAddress: `0x${string}` | undefined,
  sourceChainIds: number[],
) {
  const result = await client.calculateMaxForBridge({
    toChainId: chainId,
    toTokenSymbol: tokenSymbol,
    sources: sourceChainIds.length > 0 ? sourceChainIds : undefined,
  });
  return { maxAmount: result.maxAmount, symbol: result.symbol };
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

/* ── v2 event → step tracking ─────────────────────────────────────── */

function createSwapEventHandler(ctx: ExecuteContext) {
  return (event: SwapEvent) => {
    ctx.handleProgressEvent?.(event);
    if (event.type === "status") {
      if (event.status === "approved") {
        ctx.setCompletedSteps((prev) => new Set(prev).add("INTENT_APPROVED"));
        ctx.setStatusMessage("Executing swap...");
      } else if (event.status === "completed") {
        ctx.setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add("INTENT_APPROVED");
          next.add("SWAP_COMPLETE");
          return next;
        });
        ctx.setStatusMessage("");
      } else if (event.status === "route_building") {
        ctx.setStatusMessage("Building route...");
      } else if (event.status === "awaiting_approval") {
        ctx.setStatusMessage("Waiting for approval...");
      } else if (event.status === "executing") {
        ctx.setStatusMessage("Executing...");
      }
    } else if (event.type === "plan_progress") {
      const step = event as {
        stepType?: string;
        state?: string;
        chain?: { name?: string };
      };
      if (step.state === "wallet_prompted") {
        const chain = step.chain?.name ?? "";
        if (step.stepType === "source_swap") {
          ctx.setStatusMessage(`Swapping on ${chain}...`);
        } else if (step.stepType === "bridge_deposit") {
          ctx.setStatusMessage(`Depositing to bridge on ${chain}...`);
        } else if (step.stepType === "destination_swap") {
          ctx.setStatusMessage(`Swapping on destination ${chain}...`);
        }
      } else if (step.stepType === "bridge_fill" && step.state === "waiting") {
        ctx.setStatusMessage("Waiting for bridge fill...");
      }
    }
  };
}

function createBridgeEventHandler(ctx: ExecuteContext) {
  return (event: BridgeEvent) => {
    ctx.handleProgressEvent?.(event);
    if (event.type === "status") {
      if (event.status === "approved") {
        ctx.setCompletedSteps((prev) => new Set(prev).add("INTENT_APPROVED"));
        ctx.setStatusMessage("Executing bridge...");
      } else if (event.status === "completed") {
        ctx.setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add("INTENT_APPROVED");
          next.add("INTENT_FULFILLED");
          return next;
        });
        ctx.setStatusMessage("");
      } else if (event.status === "intent_building") {
        ctx.setStatusMessage("Building intent...");
      } else if (event.status === "awaiting_approval") {
        ctx.setStatusMessage("Waiting for approval...");
      } else if (event.status === "executing") {
        ctx.setStatusMessage("Executing...");
      }
    } else if (event.type === "plan_progress") {
      const step = event as {
        stepType?: string;
        state?: string;
        chain?: { name?: string };
      };
      if (
        step.stepType === "vault_deposit" &&
        step.state === "wallet_prompted"
      ) {
        ctx.setStatusMessage(`Depositing on ${step.chain?.name ?? ""}...`);
      } else if (step.stepType === "bridge_fill" && step.state === "waiting") {
        ctx.setStatusMessage("Waiting for bridge fill...");
      }
    }
  };
}

function createSwapAndExecuteEventHandler(ctx: ExecuteContext) {
  return (event: SwapAndExecuteEvent) => {
    ctx.handleProgressEvent?.(event);
    if (event.type === "status") {
      if (event.status === "approved") {
        ctx.setCompletedSteps((prev) => new Set(prev).add("INTENT_APPROVED"));
        ctx.setStatusMessage("Executing swap...");
      } else if (event.status === "completed") {
        ctx.setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add("INTENT_APPROVED");
          next.add("SWAP_COMPLETE");
          next.add("TRANSACTION_CONFIRMED");
          return next;
        });
        ctx.setStatusMessage("");
      } else if (event.status === "route_building") {
        ctx.setStatusMessage("Building route...");
      } else if (event.status === "awaiting_approval") {
        ctx.setStatusMessage("Waiting for approval...");
      } else if (event.status === "executing") {
        ctx.setStatusMessage("Executing...");
      }
    } else if (event.type === "plan_progress") {
      const step = event as {
        stepType?: string;
        state?: string;
        chain?: { name?: string };
      };
      if (step.stepType === "source_swap" && step.state === "confirmed") {
        ctx.setCompletedSteps((prev) => new Set(prev).add("SWAP_COMPLETE"));
        ctx.setStatusMessage("Executing deposit...");
      } else if (step.state === "wallet_prompted") {
        const chain = step.chain?.name ?? "";
        ctx.setStatusMessage(`Swapping on ${chain}...`);
      }
    }
  };
}

function createBridgeAndExecuteEventHandler(ctx: ExecuteContext) {
  return (event: BridgeAndExecuteEvent) => {
    ctx.handleProgressEvent?.(event);
    if (event.type === "status") {
      if (event.status === "approved") {
        ctx.setCompletedSteps((prev) => new Set(prev).add("INTENT_APPROVED"));
        ctx.setStatusMessage("Executing bridge...");
      } else if (event.status === "completed") {
        ctx.setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add("INTENT_APPROVED");
          next.add("INTENT_FULFILLED");
          next.add("TRANSACTION_CONFIRMED");
          return next;
        });
        ctx.setStatusMessage("");
      } else if (event.status === "intent_building") {
        ctx.setStatusMessage("Building intent...");
      } else if (event.status === "awaiting_approval") {
        ctx.setStatusMessage("Waiting for approval...");
      } else if (event.status === "executing") {
        ctx.setStatusMessage("Executing...");
      }
    } else if (event.type === "plan_progress") {
      const step = event as {
        stepType?: string;
        state?: string;
        chain?: { name?: string };
      };
      if (step.stepType === "bridge_fill" && step.state === "confirmed") {
        ctx.setCompletedSteps((prev) => new Set(prev).add("INTENT_FULFILLED"));
        ctx.setStatusMessage("Executing deposit...");
      } else if (
        step.stepType === "vault_deposit" &&
        step.state === "wallet_prompted"
      ) {
        ctx.setStatusMessage(`Depositing on ${step.chain?.name ?? ""}...`);
      } else if (step.stepType === "bridge_fill" && step.state === "waiting") {
        ctx.setStatusMessage("Waiting for bridge fill...");
      }
    }
  };
}

/* ── Tab configs ─────────────────────────────────────────────────── */

/**
 * Map an SDK SwapResult into the example app's OperationResult (tx hashes +
 * route visualization). Shared by the exact-out and exact-in swap tabs, which
 * both resolve to a SwapResult.
 */
function buildSwapResult(
  client: NexusClient,
  result: SwapResult,
  destChainId: number,
  destTokenSymbol: string,
  destFallbackAmount = "",
): OperationResult {
  const hashes: Array<{ label: string; value: string; href?: string }> = [];
  const route: SwapRouteStep[] = [];

  if (result.sourceSwaps) {
    for (const swap of result.sourceSwaps) {
      hashes.push({
        label: `Source (${chainName(client, swap.chainId)})`,
        value: swap.txHash,
      });
      const firstSwap = swap.swaps[0];
      route.push({
        type: "source",
        chainId: swap.chainId,
        chainName: chainName(client, swap.chainId),
        tokenSymbol: destTokenSymbol,
        amount: firstSwap
          ? D(firstSwap.inputAmount.toString())
              .div(D(10).pow(firstSwap.inputDecimals))
              .toFixed(2)
          : "",
        txHash: swap.txHash,
      });
    }
  }
  if (result.intentExplorerUrl) {
    hashes.push({
      label: "Intent",
      value: result.intentExplorerUrl,
      href: result.intentExplorerUrl,
    });
    route.push({
      type: "bridge",
      chainId: destChainId,
      chainName: chainName(client, destChainId),
      tokenSymbol: "USDC",
      amount: "",
      explorerUrl: result.intentExplorerUrl,
    });
  }
  if (result.destinationSwap) {
    hashes.push({
      label: `Destination (${chainName(client, destChainId)})`,
      value: result.destinationSwap.txHash,
    });
    const lastSwap =
      result.destinationSwap.swaps[result.destinationSwap.swaps.length - 1];
    route.push({
      type: "destination",
      chainId: destChainId,
      chainName: chainName(client, destChainId),
      tokenSymbol: destTokenSymbol,
      amount: lastSwap
        ? D(lastSwap.outputAmount.toString())
            .div(D(10).pow(lastSwap.outputDecimals))
            .toFixed(6)
        : destFallbackAmount,
      txHash: result.destinationSwap.txHash,
    });
  }

  const parts: string[] = [];
  const srcCount = result.sourceSwaps?.length ?? 0;
  if (srcCount > 0)
    parts.push(`${srcCount} source swap${srcCount > 1 ? "s" : ""}`);
  if (result.intentExplorerUrl) parts.push("1 bridge");
  if (result.destinationSwap) parts.push("1 destination swap");

  return {
    hashes,
    richResult: {
      kind: "swap",
      route,
      intentExplorerUrl: result.intentExplorerUrl || undefined,
      summary: parts.join(", "),
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
  fetchBalances: (client) => client.getBalancesForSwap(),
  calculateMax: swapMax,

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
        onEvent: createSwapEventHandler(ctx),
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

    return buildSwapResult(client, result as SwapResult, chainId, tokenSymbol, amount);
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
  fetchBalances: (client) => client.getBalancesForSwap(),
  calculateMax: swapMax,

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
        onEvent: createSwapEventHandler(ctx),
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

    return buildSwapResult(client, result as SwapResult, chainId, tokenSymbol);
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
  fetchBalances: (client) => client.getBalancesForSwap(),
  calculateMax: swapMax,

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
        onEvent: createSwapAndExecuteEventHandler(ctx),
        onIntent: (data) => {
          (
            ctx as unknown as { _onSwapExecIntent?: (d: typeof data) => void }
          )._onSwapExecIntent?.(data);
        },
      },
    );

    const typedResult = result as SwapAndExecuteResult;
    const hashes: Array<{ label: string; value: string; href?: string }> = [];
    const route: import("./types").SwapRouteStep[] = [];

    const swapResult = typedResult.swapResult;
    if (swapResult?.sourceSwaps) {
      for (const swap of swapResult.sourceSwaps) {
        hashes.push({
          label: `Source (${chainName(client, swap.chainId)})`,
          value: swap.txHash,
        });
        route.push({
          type: "source",
          chainId: swap.chainId,
          chainName: chainName(client, swap.chainId),
          tokenSymbol: tokenSymbol,
          amount: "",
          txHash: swap.txHash,
        });
      }
    }
    if (swapResult?.intentExplorerUrl) {
      route.push({
        type: "bridge",
        chainId,
        chainName: chainName(client, chainId),
        tokenSymbol: "USDC",
        amount: "",
        explorerUrl: swapResult.intentExplorerUrl,
      });
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
  fetchBalances: (client) => client.getBalancesForBridge(),
  calculateMax: bridgeMax,

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
        onEvent: createBridgeEventHandler(ctx),
        hooks: {
          onIntent: (data) => {
            (
              ctx as unknown as { _onBridgeIntent?: (d: typeof data) => void }
            )._onBridgeIntent?.(data);
          },
          onAllowance: ({ allow, sources }) => allow(sources.map(() => "min")),
        },
      },
    )) as BridgeResult;

    const links: import("./types").BridgeLink[] = [];
    for (const tx of result.sourceTxs) {
      links.push({
        label: `Collection (${tx.chain.name})`,
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
      hashes: extractBridgeResultHashes(result),
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
  fetchBalances: (client) => client.getBalancesForBridge(),
  calculateMax: bridgeMax,

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
        onEvent: createBridgeAndExecuteEventHandler(ctx),
        onIntent: (data) => {
          (
            ctx as unknown as { _onBridgeExecIntent?: (d: typeof data) => void }
          )._onBridgeExecIntent?.(data);
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

export const TESTNET_TABS: TabConfig[] = [BRIDGE_TAB];

export function getTabsForNetwork(network: NetworkMode): TabConfig[] {
  return network === "testnet" ? TESTNET_TABS : MAINNET_TABS;
}
