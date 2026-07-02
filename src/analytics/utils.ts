/**
 * Analytics Utility Functions
 * Helper functions for extracting analytics properties from SDK data structures
 */

import Decimal from 'decimal.js';
import { compact, uniq } from 'es-toolkit';
import type { BridgeIntent, EthereumProvider, TokenBalance } from '../domain';

/**
 * Recursively converts bigints to strings so JSON-based event serializers can
 * handle the value.
 * @param value - Arbitrary value that may contain nested bigints.
 * @returns Same shape with bigints replaced by their decimal string form.
 */
export function serializeForAnalytics(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeForAnalytics);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = serializeForAnalytics(v);
    }
    return result;
  }
  return value;
}

/**
 * Returns a scalar-only summary of a Plan suitable for analytics.
 * @param plan - Plan object emitted by the SDK.
 * @returns Flat record of step counts, types, and capability flags.
 */
export function extractPlanSummary(plan: unknown): Record<string, unknown> {
  if (!plan || typeof plan !== 'object') return {};
  const p = plan as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (Array.isArray(p.steps)) {
    summary.stepCount = p.steps.length;
    const stepTypes = (p.steps as Array<Record<string, unknown>>)
      .map((s) => s?.type)
      .filter((t): t is string => typeof t === 'string');
    summary.stepTypes = stepTypes;
    summary.hasAllowance = stepTypes.includes('allowance_approval');
  }
  if (typeof p.hasBridge === 'boolean') summary.hasBridge = p.hasBridge;
  if (typeof p.hasDestinationSwap === 'boolean') summary.hasDestinationSwap = p.hasDestinationSwap;
  return summary;
}

/**
 * Returns a scalar-only summary of a Step suitable for analytics.
 * @param step - Step object emitted by the SDK.
 * @returns Flat record with stepType, stepId, chain, and token fields.
 */
export function extractStepSummary(step: unknown): Record<string, unknown> {
  if (!step || typeof step !== 'object') return {};
  const s = step as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (typeof s.type === 'string') summary.stepType = s.type;
  if (typeof s.id === 'string') summary.stepId = s.id;
  const chain = s.chain as Record<string, unknown> | undefined;
  if (chain) {
    if (typeof chain.id === 'number') summary.chainId = chain.id;
    if (typeof chain.name === 'string') summary.chainName = chain.name;
  }
  const token = s.token as Record<string, unknown> | undefined;
  if (token) {
    if (typeof token.symbol === 'string') summary.tokenSymbol = token.symbol;
    if (typeof token.contractAddress === 'string') summary.tokenAddress = token.contractAddress;
  }
  // Swap steps carry the user-facing asset on `step.asset`; the wallet-level
  // `step.token` may be an ephemeral wrapper (e.g. WETH) that doesn't match
  // what the user thinks they're swapping. When both exist, `asset.token`
  // wins because it's what surfaces in the UI and is the right grouping key
  // for analytics.
  const asset = s.asset as Record<string, unknown> | undefined;
  if (asset) {
    const assetToken = asset.token as Record<string, unknown> | undefined;
    if (assetToken && typeof assetToken.symbol === 'string')
      summary.tokenSymbol = assetToken.symbol;
  }
  return summary;
}

/**
 * Property names carrying user-wallet addresses. Values under these keys are
 * hashed when `anonymizeWallets` is set; other 0x-addresses are lowercased
 * only. Includes common plurals and short forms (from/to in tx logs) so
 * EIP-1193 payloads don't slip through.
 */
const USER_WALLET_FIELDS = new Set([
  'recipient',
  'recipients',
  'fromAddress',
  'toAddress',
  'walletAddress',
  'sender',
  'holderAddress',
  'ephemeralAddress',
  'address',
  'userAddress',
  'from',
  'to',
  'signer',
  'owner',
]);

const HEX_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Canonical anonymization for wallet addresses. Used in both `identify()`
 * (user-id) and event-payload normalization so the same wallet collapses to
 * the same `anon_<8-hex>` everywhere — without this consistency, dashboards
 * can't correlate a user's identified id to their address in event payloads.
 *
 * Not cryptographic. FNV-1a + session-derived salt; truncated to 32 bits.
 */
export function anonymizeWalletAddress(address: string, salt: string): string {
  let h = 0x811c9dc5;
  const input = address.toLowerCase() + salt;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `anon_${h.toString(16).padStart(8, '0')}`;
}

/**
 * Returns `value` with 0x-addresses lowercased, and known user-wallet fields
 * hashed when `hashUserWallets` is set.
 * @param value - Arbitrary payload (object, array, primitive).
 * @param options - `hashUserWallets` toggles user-wallet hashing; `salt` is
 *   appended before hashing.
 * @param parentKey - Internal: the key under which `value` lives in its
 *   parent object, used to identify user-wallet fields.
 * @returns Same shape with addresses normalized.
 */
export function normalizeAddresses(
  value: unknown,
  options: { hashUserWallets?: boolean; salt?: string } = {},
  parentKey?: string
): unknown {
  const { hashUserWallets = false, salt = '' } = options;

  if (typeof value === 'string') {
    if (!HEX_ADDRESS_REGEX.test(value)) return value;
    if (hashUserWallets && parentKey && USER_WALLET_FIELDS.has(parentKey)) {
      return anonymizeWalletAddress(value, salt);
    }
    return value.toLowerCase();
  }

  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => normalizeAddresses(v, options, parentKey));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = normalizeAddresses(v, options, k);
    }
    return result;
  }
  return value;
}

/**
 * Detect wallet type from provider
 * @param provider - Ethereum provider object
 * @returns Wallet type string (MetaMask, Coinbase, WalletConnect, etc.)
 */
export function getWalletType(provider: EthereumProvider): string {
  if (!provider) return 'Unknown';

  const p = provider as unknown as Record<string, unknown>;

  // Check for common wallet provider flags
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isWalletConnect) return 'WalletConnect';
  if (p.isTrust) return 'Trust Wallet';
  if (p.isRabby) return 'Rabby';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isExodus) return 'Exodus';
  if (p.isAmbire) return 'Ambire Wallet';
  if (p.isMetaMask) return 'MetaMask'; // placing metamask last to avoid false positives

  // Try to get from constructor name
  if (p.constructor?.name && p.constructor.name !== 'Object') {
    return p.constructor.name;
  }

  // Check for provider session (WalletConnect v2)
  if (p.session) return 'WalletConnect v2';

  return 'Unknown';
}

/**
 * Calculate USD value from token amount and oracle prices
 * @param token - Token symbol (e.g., 'USDC', 'ETH')
 * @param amount - Token amount as bigint or string
 * @param oraclePrices - Oracle price data (if available)
 * @returns USD value or undefined if cannot calculate
 */
export function calculateUsdValue(
  token: string,
  amount: bigint | string | number,
  oraclePrices?: Record<string, number>
): number | undefined {
  if (!oraclePrices || !oraclePrices[token]) {
    return undefined;
  }

  try {
    // Convert amount to number (handle bigint, string, number)
    let numericAmount: number;
    if (typeof amount === 'bigint') {
      // Assuming 6 decimals for most stablecoins, 18 for ETH
      // This is a simplification - real implementation should know token decimals
      const decimals = token === 'ETH' ? 18 : 6;
      numericAmount = Number(amount) / 10 ** decimals;
    } else if (typeof amount === 'string') {
      numericAmount = Number.parseFloat(amount);
    } else {
      numericAmount = amount;
    }

    const price = oraclePrices[token];
    return numericAmount * price;
  } catch (_error) {
    return undefined;
  }
}

/**
 * Extract analytics properties from bridge/transfer intent
 * @param intent - Intent object from CA SDK
 * @returns Object with sourceChains, totalBreakdowns, and other properties
 */
export function extractIntentProperties(intent: BridgeIntent): Record<string, unknown> {
  if (!intent) return {};

  const props: Record<string, unknown> = {};

  // Extract source chains
  if (intent.selectedSources && Array.isArray(intent.selectedSources)) {
    props.sourceChains = compact(intent.selectedSources.map((source) => source.chain.id));
    props.totalBreakdowns = intent.selectedSources.length;
  }

  // Extract destination chain (uses the SDK-wide `toChainId` / `tokenSymbol`
  // naming to match top-level event payloads).
  if (intent.destination) {
    props.toChainId = intent.destination.chain.id;
    props.tokenSymbol = intent.destination.token.symbol;
  }

  // Extract amount
  if (intent.sourcesTotal !== undefined) {
    props.amount = intent.sourcesTotal;
  }

  // Extract fees if available
  if (intent.fees) {
    props.fees = intent.fees;
  }

  return props;
}

/**
 * Extract breakdown statistics from balance assets
 * @param assets - Array of user assets from balance query
 * @returns Object with totalBreakdowns, chains, and tokens
 */
export function extractBreakdownStats(assets: TokenBalance[]): {
  totalBreakdowns: number;
  chains: number[];
  tokens: string[];
  balanceCount: number;
} {
  if (!Array.isArray(assets) || assets.length === 0) {
    return {
      totalBreakdowns: 0,
      chains: [],
      tokens: [],
      balanceCount: 0,
    };
  }

  const chains = new Set<number>();
  const tokens = new Set<string>();
  let totalBreakdowns = 0;

  for (const asset of assets) {
    // Count breakdowns
    if (asset.chainBalances && Array.isArray(asset.chainBalances)) {
      totalBreakdowns += asset.chainBalances.length;

      // Extract chains and tokens from breakdowns
      for (const chainBalance of asset.chainBalances) {
        if (chainBalance.chain.id && new Decimal(chainBalance.balance).greaterThan(0)) {
          chains.add(chainBalance.chain.id);
        }
      }
    }

    // Extract token symbol
    if (asset.symbol && new Decimal(asset.balance).greaterThan(0)) {
      tokens.add(asset.symbol);
    }
  }

  return {
    totalBreakdowns,
    chains: uniq(Array.from(chains)),
    tokens: uniq(Array.from(tokens)),
    balanceCount: assets.length,
  };
}

/**
 * Sanitize URL to remove query parameters and sensitive data
 * @param url - URL string
 * @returns Sanitized URL without query params
 */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;

  try {
    const urlObj = new URL(url);
    // Return URL without search params
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch (_error) {
    // If URL parsing fails, just return the origin if it looks like a URL
    if (url.startsWith('http')) {
      return url.split('?')[0];
    }
    return undefined;
  }
}

/**
 * Builds the `economics` block emitted on swap and bridge success events.
 * `valueUsd` (destination and each source) is in USD, rounded to cents.
 * `amount` is in token units; `fees` and `buffer` are in COT (USDC/USDT) units.
 */
export function buildEconomics(input: {
  provider: 'nexus' | 'mayan' | null;
  valueUsd?: string;
  tokenSymbol?: string;
  amount?: string;
  fees: { protocol: string; caGas: string; solver: string; total: string } | null;
  buffer?: string;
  sources: Array<{
    symbol: string;
    chainId: number;
    chainName: string;
    amount: string;
    valueUsd?: string;
  }>;
}): Record<string, unknown> {
  const toUsd = (value?: string): string | undefined => {
    if (value == null) return undefined;
    try {
      return new Decimal(value).toFixed(2);
    } catch {
      return value;
    }
  };
  return {
    economics: {
      ...input,
      valueUsd: toUsd(input.valueUsd),
      sources: input.sources.map((source) => ({ ...source, valueUsd: toUsd(source.valueUsd) })),
    },
  };
}

/**
 * Extract properties from Bridge Intent for analytics
 * @param intent - Intent object
 * @returns Object with bridge property
 */
export function extractBridgeProperties(intent?: BridgeIntent): Record<string, unknown> {
  if (!intent) return {};

  return {
    bridge: {
      sources: intent.selectedSources?.map((source) => ({
        chainId: source.chain.id,
        token: source.token.contractAddress,
        amount: new Decimal(source.amount).toFixed(),
      })),
      destination: {
        chainId: intent.destination?.chain.id,
        token: intent.destination?.token.symbol,
        amount: new Decimal(intent.destination?.amount || 0).toFixed(),
      },
      fees: intent.fees,
    },
    ...buildEconomics({
      provider: intent.provider,
      valueUsd: intent.destination?.value,
      tokenSymbol: intent.destination?.token.symbol,
      amount: intent.destination?.amount,
      fees: intent.fees
        ? {
            protocol: intent.fees.protocol,
            caGas: intent.fees.caGas,
            solver: intent.fees.solver,
            total: intent.fees.total,
          }
        : null,
      sources: (intent.selectedSources ?? []).map((source) => ({
        symbol: source.token.symbol,
        chainId: source.chain.id,
        chainName: source.chain.name,
        amount: source.amount,
        valueUsd: source.value,
      })),
    }),
  };
}
