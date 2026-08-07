import type { EthereumProvider } from '../domain';

export const serializeForAnalytics = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeForAnalytics);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeForAnalytics(entry)])
    );
  }
  return value;
};

const USER_WALLET_FIELDS = new Set([
  'recipient',
  'recipients',
  'fromAddress',
  'toAddress',
  'walletAddress',
  'sender',
  'holderAddress',
  'address',
  'userAddress',
  'from',
  'to',
  'signer',
  'owner',
]);
const HEX_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const anonymizeWalletAddress = (address: string, salt: string): string => {
  let hash = 0x811c9dc5;
  for (const character of address.toLowerCase() + salt) {
    hash ^= character.charCodeAt(0);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `anon_${hash.toString(16).padStart(8, '0')}`;
};

export const normalizeAddresses = (
  value: unknown,
  options: { hashUserWallets?: boolean; salt?: string } = {},
  parentKey?: string
): unknown => {
  if (typeof value === 'string') {
    if (!HEX_ADDRESS_REGEX.test(value)) return value;
    if (options.hashUserWallets && parentKey && USER_WALLET_FIELDS.has(parentKey)) {
      return anonymizeWalletAddress(value, options.salt ?? '');
    }
    return value.toLowerCase();
  }
  if (value === null || value === undefined) return value;
  if (Array.isArray(value))
    return value.map((entry) => normalizeAddresses(entry, options, parentKey));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeAddresses(entry, options, key)])
    );
  }
  return value;
};

export const getWalletType = (provider: EthereumProvider): string => {
  const candidate = provider as unknown as Record<string, unknown>;
  if (candidate.isCoinbaseWallet) return 'Coinbase Wallet';
  if (candidate.isWalletConnect) return 'WalletConnect';
  if (candidate.isTrust) return 'Trust Wallet';
  if (candidate.isRabby) return 'Rabby';
  if (candidate.isBraveWallet) return 'Brave Wallet';
  if (candidate.isExodus) return 'Exodus';
  if (candidate.isAmbire) return 'Ambire Wallet';
  if (candidate.isMetaMask) return 'MetaMask';
  if (candidate.session) return 'WalletConnect v2';
  const name = (candidate.constructor as { name?: string } | undefined)?.name;
  return name && name !== 'Object' ? name : 'Unknown';
};

export const sanitizeUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.startsWith('http') ? url.split('?')[0] : undefined;
  }
};
