import type { NexusClient } from "@avail-project/nexus-core";
import type { ChainOption, TokenOption } from "./types";

/* ── Swap destination tokens ────────────────────────────────────────
 * Extra tokens you can swap *into* on each chain, on top of whatever the
 * SDK already lists for that chain. Merged with `getSupportedChains()`
 * tokens in `getSwapTokenOptions` below. */

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as `0x${string}`;

type DestinationToken = {
  symbol: string;
  label: string;
  tokenAddress: `0x${string}`;
  decimals: number;
};

export const DESTINATION_TOKENS: ReadonlyMap<number, DestinationToken[]> =
  new Map([
    [
      1,
      [
        {
          symbol: "ETH",
          label: "ETH",
          tokenAddress: ZERO_ADDRESS,
          decimals: 18,
        },
        {
          symbol: "USDC",
          label: "USDC",
          tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          decimals: 6,
        },
      ],
    ],
    [
      8453,
      [
        {
          symbol: "ETH",
          label: "ETH",
          tokenAddress: ZERO_ADDRESS,
          decimals: 18,
        },
        {
          symbol: "USDC",
          label: "USDC",
          tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          decimals: 6,
        },
        {
          symbol: "KAITO",
          label: "KAITO",
          tokenAddress: "0x98d0baa52b2D063E780DE12F615f963Fe8537553",
          decimals: 18,
        },
        {
          symbol: "SOL",
          label: "SOL",
          tokenAddress: "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82",
          decimals: 9,
        },
        {
          symbol: "USDS",
          label: "USDS",
          tokenAddress: "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc",
          decimals: 18,
        },
      ],
    ],
    [
    999,
    [
      {
        symbol: "HYPE",
        label: "HYPE",
        tokenAddress: ZERO_ADDRESS,
        decimals: 18,
      },
      {
        symbol: "USDC",
        label: "USDC",
        tokenAddress: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
        decimals: 6,
      },
      {
        symbol: "KHYPE",
        label: "KHYPE",
        tokenAddress: "0xfd739d4e423301ce9385c1fb8850539d657c296d",
        decimals: 18,
      },
      {
        symbol: "WHYPE",
        label: "WHYPE",
        tokenAddress: "0x5555555555555555555555555555555555555555",
        decimals: 18,
      },
    ],
  ],
    [
      42161,
      [
        {
          symbol: "ETH",
          label: "ETH",
          tokenAddress: ZERO_ADDRESS,
          decimals: 18,
        },
        {
          symbol: "USDC",
          label: "USDC",
          tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
          decimals: 6,
        },
        {
          symbol: "LINK",
          label: "LINK",
          tokenAddress: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
          decimals: 18,
        },
        {
          symbol: "AAVE",
          label: "AAVE",
          tokenAddress: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196",
          decimals: 18,
        },
        {
          symbol: "PEPE",
          label: "PEPE",
          tokenAddress: "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00",
          decimals: 18,
        },
      ],
    ],
    [
      137,
      [
        {
          symbol: "POL",
          label: "POL",
          tokenAddress: ZERO_ADDRESS,
          decimals: 18,
        },
        {
          symbol: "USDC",
          label: "USDC",
          tokenAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
          decimals: 6,
        },
        {
          symbol: "UNI",
          label: "UNI",
          tokenAddress: "0xb33EaAd8d922B1083446DC23f610c2567fB5180f",
          decimals: 18,
        },
        {
          symbol: "LDO",
          label: "LDO",
          tokenAddress: "0xC3C7d422809852031b44ab29EEC9F1EfF2A58756",
          decimals: 18,
        },
        {
          symbol: "SUSHI",
          label: "SUSHI",
          tokenAddress: "0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a",
          decimals: 18,
        },
      ],
    ],
    [
      10,
      [
        {
          symbol: "USDC",
          label: "USDC",
          tokenAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
          decimals: 6,
        },
      ],
    ],
    [
      4114, // Citrea
      [
        {
          symbol: "cBTC",
          label: "cBTC",
          tokenAddress: ZERO_ADDRESS,
          decimals: 18,
        },
        {
          symbol: "WCBTC",
          label: "WCBTC",
          tokenAddress: "0x3100000000000000000000000000000000000006",
          decimals: 18,
        },
        {
          symbol: "USDC",
          label: "USDC.e",
          tokenAddress: "0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839",
          decimals: 6,
        },
        {
          symbol: "ctUSD",
          label: "ctUSD",
          tokenAddress: "0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D",
          decimals: 6,
        },
      ],
    ],
    [
      143, // Monad
      [
        {
          symbol: "USDC",
          label: "USDC",
          tokenAddress: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
          decimals: 6,
        },
      ],
    ],
  ]);

/* ── Swap chain/token options ───────────────────────────────────────── */

/** Chains a swap can target: the SDK's supported chains filtered to those
 *  flagged `swapSupported`. */
export function getSwapChainOptions(client: NexusClient | null): ChainOption[] {
  if (!client) return [];
  return client
    .getSupportedChains()
    .filter((c) => c.swapSupported)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Destination tokens for a chain: the SDK's listed tokens plus our extra
 *  `DESTINATION_TOKENS`, deduped by address (SDK entry wins). */
export function getSwapTokenOptions(
  client: NexusClient | null,
  chainId: number,
): TokenOption[] {
  const chain = client?.getSupportedChains().find((c) => c.id === chainId);
  const sdkTokens: TokenOption[] = (chain?.tokens ?? []).map((t) => ({
    symbol: t.symbol,
    label: t.symbol,
    tokenAddress: t.contractAddress,
    decimals: t.decimals,
  }));

  const seen = new Set(sdkTokens.map((t) => t.tokenAddress?.toLowerCase()));
  const extras = (DESTINATION_TOKENS.get(chainId) ?? []).filter(
    (t) => !seen.has(t.tokenAddress.toLowerCase()),
  );

  return [...sdkTokens, ...extras];
}
