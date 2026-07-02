/**
 * Logo URL helpers for tokens and chains.
 *
 * Lookup order for tokens:
 *   1. nexus-assets registry (universal tokens — USDC, USDT, ETH, BNB, etc.) by symbol.
 *   2. Static `token-logos.json` map keyed by `chainId → address → logoURI`.
 *      Snapshotted from the LI.FI tokens endpoint (li.quest/v1/tokens?chainTypes=EVM)
 *      — covers ~5k ERC20s across 15 chains. Regenerate with:
 *        curl -s "https://li.quest/v1/tokens?chainTypes=EVM" | jq -c '...' > token-logos.json
 *   3. 1inch CDN fallback by lowercase address.
 *
 * Chain logos use the nexus-assets registry only.
 *
 * <AssetRowIcon> already falls back to a letter circle via `useImageOk` when
 * an image fails to load, so a broken URL degrades gracefully.
 */

import tokenLogosByChain from "./token-logos.json";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const NEXUS_ASSETS_BASE =
  "https://raw.githubusercontent.com/availproject/nexus-assets/main";

/** chainId → slug under nexus-assets/chains/. Source: chains/_index.json */
const NEXUS_CHAIN_SLUGS: Record<number, string> = {
  // Mainnets
  1: "ethereum",
  10: "optimism",
  56: "bnb",
  137: "polygon",
  143: "monad",
  999: "hyperevm",
  4114: "citrea",
  4326: "megaeth",
  8217: "kaia",
  8453: "base",
  42161: "arbitrum",
  43114: "avalanche",
  50104: "sophon",
  534352: "scroll",
  // Testnets
  5115: "citrea-testnet",
  10143: "monad-testnet",
  80002: "polygon-amoy",
  84532: "base-sepolia",
  421614: "arbitrum-sepolia",
  11155111: "ethereum-sepolia",
  11155420: "optimism-sepolia",
};

/** Token symbol (uppercase-normalized) → slug under nexus-assets/tokens/.
    Source: tokens/_index.json */
const NEXUS_TOKEN_SLUGS: Record<string, string> = {
  USDC: "usdc",
  USDT: "usdt",
  ETH: "eth",
  WETH: "weth",
  BNB: "bnb",
  AVAX: "avax",
  MATIC: "matic",
  POL: "pol",
  KAIA: "kaia",
  MON: "mon",
  HYPE: "hype",
  CBTC: "cbtc",
  WCBTC: "wcbtc",
  CTUSD: "ctusd",
  SOPH: "soph",
  USDM: "usdm",
  USDH: "usdh",
};

/**
 * Best-effort chain logo URL. Returns undefined for unknown chainIds →
 * letter fallback.
 */
export function getChainLogoUrl(chainId: number): string | undefined {
  const slug = NEXUS_CHAIN_SLUGS[chainId];
  return slug ? `${NEXUS_ASSETS_BASE}/chains/${slug}/logo.png` : undefined;
}

const TOKEN_LOGOS = tokenLogosByChain as Record<string, Record<string, string>>;

/**
 * Best-effort token logo URL. Tries (in order):
 *   1. nexus-assets registry by symbol (universal tokens with branded logos).
 *   2. Static LI.FI-derived map by `(chainId, lowercase-address)`.
 *   3. 1inch CDN by lowercase address.
 */
export function getTokenLogoUrl(
  symbol: string,
  tokenAddress?: `0x${string}`,
  chainId?: number,
): string | undefined {
  const slug = NEXUS_TOKEN_SLUGS[symbol.toUpperCase()];
  if (slug) return `${NEXUS_ASSETS_BASE}/tokens/${slug}/logo.png`;

  const addressKey = tokenAddress?.toLowerCase();
  if (chainId !== undefined && addressKey) {
    const chainMap = TOKEN_LOGOS[String(chainId)];
    const fromStatic = chainMap?.[addressKey];
    if (fromStatic) return fromStatic;
  }

  if (addressKey && addressKey !== ZERO_ADDRESS) {
    return `https://tokens.1inch.io/${addressKey}.png`;
  }
  return undefined;
}
