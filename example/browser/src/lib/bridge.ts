import type { NexusClient } from "@avail-project/nexus-core";
import type { ChainOption, HashRecord, TokenOption, SourceOption } from "./types";
import { D } from "./math";

export function getSupportedChains(client: NexusClient): ChainOption[] {
  const supported = client.getSupportedChains();
  return supported.map((c) => ({ id: c.id, name: c.name }));
}

export function getSupportedTokens(
  client: NexusClient,
  chainId: number,
): TokenOption[] {
  const supported = client.getSupportedChains();
  const chain = supported.find((c) => c.id === chainId);
  if (!chain) return [];

  const tokens: TokenOption[] = chain.tokens.map((t) => ({
    symbol: t.symbol,
    label: t.symbol,
    tokenAddress: t.contractAddress,
  }));

  return tokens;
}

export function filterBridgeSources(
  sources: SourceOption[],
  chainId: number,
  tokenSymbol: string,
): SourceOption[] {
  return sources.filter(
    (s) =>
      s.symbol === tokenSymbol &&
      s.chainId !== chainId &&
      D(s.balance).gt(0),
  );
}

export function extractBridgeResultHashes(result: {
  intentExplorerUrl: string;
  sourceTxs: Array<{
    chain: { id: number; name: string };
    txHash: string;
    txExplorerUrl: string;
  }>;
}): HashRecord[] {
  const hashes: HashRecord[] = [];

  for (const [index, tx] of result.sourceTxs.entries()) {
    hashes.push({
      label: `Source tx ${index + 1} (${tx.chain.name})`,
      value: tx.txHash,
      href: tx.txExplorerUrl,
    });
  }

  if (result.intentExplorerUrl) {
    hashes.push({
      label: "Bridge explorer",
      value: result.intentExplorerUrl,
      href: result.intentExplorerUrl,
    });
  }

  return hashes;
}
