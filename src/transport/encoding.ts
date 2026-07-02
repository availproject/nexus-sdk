import type { Hex } from 'viem';
import { padHex, toBytes } from 'viem';

/**
 * Encode a chain ID as a big-endian 32-byte Uint8Array.
 */
export const encodeChainIdToBytes32 = (chainId: number): Uint8Array => {
  return toBytes(chainId, { size: 32 });
};

/**
 * Parse a hex address into a left-padded 32-byte Uint8Array
 * (20 address bytes right-aligned at offset 12).
 */
export const parseHexToTokenBytes = (hexAddress: string): Uint8Array => {
  const hex = (hexAddress.startsWith('0x') ? hexAddress : `0x${hexAddress}`) as Hex;
  const padded = padHex(hex, { size: 32 });
  return toBytes(padded);
};
