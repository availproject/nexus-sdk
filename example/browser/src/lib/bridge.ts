import type { NexusClient } from "@avail-project/nexus-core";
import type { ChainOption, TokenOption, SourceOption } from "./types";
import { D } from "./math";

export function getSupportedChains(client: NexusClient): ChainOption[] {
  const supported = client
    .getSupportedChains()
    .filter((chain) => chain.capabilities.intent);
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
    tokenAddress: t.address,
    decimals: t.decimals,
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
