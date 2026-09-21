import type { IntentTokenQuery, NexusClient } from "@avail-project/nexus-core";
import type { ChainOption } from "./types";

export function getSwapChainOptions(client: NexusClient | null): ChainOption[] {
  return (client?.getSupportedChains() ?? [])
    .filter((chain) => chain.capabilities.intent && (chain.asDestination ?? chain.providers).length > 0)
    .map(({ id, name }) => ({ id, name }));
}

export async function getSwapTokenOptions(client: NexusClient, query: IntentTokenQuery) {
  const { chains, ...pagination } = await client.getAvailableDestinationTokens([], query);
  return {
    ...pagination,
    options: chains.flatMap((chain) => chain.tokens.map((token) => ({
      id: `${chain.id}:${token.address.toLowerCase()}`,
      chainId: chain.id,
      chainName: chain.name,
      chainLogo: chain.logo,
      symbol: token.symbol,
      label: token.symbol,
      tokenLogo: token.logo,
      tokenAddress: token.address,
      decimals: token.decimals,
    }))),
  };
}
