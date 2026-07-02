import { bytesToBigInt, sha256, toBytes } from 'viem';

// Stark-friendly elliptic curve order — mirrors `ec.n` in
// @starkware-industries/starkware-crypto-utils. Hard-coded so we can avoid
// pulling that package (and its elliptic/bn.js/bip39/etc transitive deps,
// ~400KB minified) just to derive a key.
const STARK_N = 0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn;
const TWO_256 = 1n << 256n;
const MAX_ALLOWED = TWO_256 - (TWO_256 % STARK_N);

const ETH_SIGNATURE_HEX_LEN = 130;

const evenLengthHex = (n: number): string => {
  const h = n.toString(16);
  return h.length % 2 === 0 ? h : `0${h}`;
};

const hashWithIndex = (keyHex: string, index: number): bigint => {
  const bytes = toBytes(`0x${keyHex}${evenLengthHex(index)}`);
  return bytesToBigInt(sha256(bytes, 'bytes'));
};

const grindKey = (keyHex: string): string => {
  let i = 0;
  let key = hashWithIndex(keyHex, i++);
  // Reject biased outputs ≥ MAX_ALLOWED, then reduce mod n.
  while (key >= MAX_ALLOWED) {
    key = hashWithIndex(keyHex, i++);
  }
  return (key % STARK_N).toString(16);
};

/**
 * Derive a Stark-friendly private key from a 65-byte Ethereum signature.
 *
 * Behaviorally identical to `keyDerivation.getPrivateKeyFromEthSignature` from
 * @starkware-industries/starkware-crypto-utils; kept in-tree to avoid the
 * dependency. Output is an unpadded lowercase hex string (no `0x` prefix),
 * up to 63 chars long.
 */
export const getPrivateKeyFromEthSignature = (ethSignature: string): string => {
  const sig = ethSignature.replace(/^0x/, '');
  if (sig.length !== ETH_SIGNATURE_HEX_LEN || !/^[0-9a-fA-F]+$/.test(sig)) {
    throw new Error(
      `getPrivateKeyFromEthSignature: expected ${ETH_SIGNATURE_HEX_LEN}-char hex signature, got length ${sig.length}`
    );
  }
  return grindKey(sig.substring(0, 64));
};
