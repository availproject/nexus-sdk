import type { IntentChainMetadata, IntentToken, IntentTokenQuery, NexusClient } from "@avail-project/nexus-core";
import type { ChainOption } from "./types";

export function getSwapChainOptions(client: NexusClient | null, direction: "source" | "destination" = "destination"): ChainOption[] {
  return (client?.getSupportedChains() ?? [])
    .filter((chain) => chain.capabilities.intent &&
      ((direction === "source" ? chain.asSource : chain.asDestination) ?? chain.providers).length > 0)
    .map(({ id, name }) => ({ id, name }));
}

function tokenOption(chain: IntentChainMetadata, token: IntentToken) {
  return {
    id: `${chain.id}:${token.address.toLowerCase()}`,
    chainId: chain.id,
    chainName: chain.name,
    chainLogo: chain.logo,
    symbol: token.symbol,
    label: token.symbol,
    tokenLogo: token.logo,
    tokenAddress: token.address,
    decimals: token.decimals,
  };
}

export async function getSwapTokenOptions(
  client: NexusClient,
  query: IntentTokenQuery,
  direction: "source" | "destination" = "destination",
) {
  if (direction === "source") {
    const { tokens, ...pagination } = await client.getTokens(query);
    const chains = client.getSupportedChains();
    return {
      ...pagination,
      options: tokens.flatMap((token) => {
        const chain = chains.find((entry) => entry.id === token.chainId);
        return chain?.capabilities.intent && (token.asSource ?? token.providers).some(
          (provider) => (chain.asSource ?? chain.providers).includes(provider.id),
        )
          ? [tokenOption(chain, token)] : [];
      }),
    };
  }
  const { chains, ...pagination } = await client.getAvailableDestinationTokens([], query);
  return {
    ...pagination,
    options: chains.flatMap((chain) => chain.tokens.map((token) => tokenOption(chain, token))),
  };
}
