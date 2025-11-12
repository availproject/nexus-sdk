import { Hex } from 'viem';

function tronHexToEvmAddress(tronHex: string): Hex {
  const normalized = tronHex.toLowerCase().replace(/^0x/, '');

  // Validate length and prefix
  if (!/^41[a-f0-9]{40}$/.test(normalized)) {
    throw new Error(`Invalid TRON hex address: ${tronHex}`);
  }

  // Extract last 20 bytes (40 hex chars) and return as EVM address
  return `0x${normalized.slice(2)}`;
}

export { tronHexToEvmAddress };
