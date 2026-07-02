import { describe, expect, it } from 'vitest';
import { getPrivateKeyFromEthSignature } from '../../../src/swap/wallet/stark';

// Stark curve order — same constant as in src/swap/wallet/stark.ts. Duplicated
// so the test asserts the invariant `output < n` independently of the impl.
const STARK_N = 0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn;

// Golden values captured from
// `@starkware-industries/starkware-crypto-utils` v0.2.1, the package this
// in-tree impl replaces. The corpus mixes edge-shaped signatures, deterministic
// SHA-256-derived signatures, and one entry (`grind-2-iter`) chosen because it
// triggers the rejection loop in `grindKey` (first SHA-256 output ≥ MAX_ALLOWED).
// Regenerate with .tmp-gen-golden.mjs if the source impl ever changes.
const GOLDEN: Array<{ name: string; sig: string; expected: string }> = [
  {
    name: 'all-zero r',
    sig: `0x${'00'.repeat(32)}${'ab'.repeat(32)}1b`,
    expected: '79c9e31ac8255cb2f258583df262dc0bcdf5483bc9cd2e60196c90c789ae728',
  },
  {
    name: 'all-f r',
    sig: `0x${'ff'.repeat(32)}${'ab'.repeat(32)}1b`,
    expected: '4ac3220fb26c7dbfaf29edc60f4fcf1def74c1daaa870f8e6953794e53d0cdd',
  },
  {
    name: 'mixed-hi r',
    sig: `0x${'aa'.repeat(32)}${'55'.repeat(32)}1c`,
    expected: '20c20907b449bacb0a16d9a297ea531aa98eadd80424215dc17da8604868ebf',
  },
  {
    name: 'no-0x prefix',
    sig: `${'12'.repeat(32)}${'34'.repeat(32)}1b`,
    expected: '709efbdf9a45ce2de86c5043c3aca6987f43f3e5ed0af8d2fd929043dbecaed',
  },
  {
    name: 'seed-0',
    sig: '0x5aab6915c8a231a90665d7b7561e0195736fc6ffefe63ec27c842bf5167dc44f649ae9221b6e075e0f20c25211a195d76554285ab92b3ebc098de458c4e654bf1b',
    expected: '7e5ea5715765ce17ddf3aea676a1009c1c3828f4a66500c5477c930a6de7bf2',
  },
  {
    name: 'seed-3 (short hex output)',
    sig: '0xf797214119d3dddb962fb654226414ead4f291edea084d839f18fce1057625830ca30732330ce1e34c06dddf89d8e39bac9c9334c35fd7b0333227d9057b3cd91b',
    expected: '40e6ae7804b63356ef3d0d91996a69b34d27b350eab621bd5eff5263c7c5a46',
  },
  {
    name: 'seed-16 (61-char output)',
    sig: '0xd85ccc184eca044b1d139ff968a29528077eb453bb1c58a111ddf21d0dc0ea0087668895c556471b73fd6c7e7a41385d51ffd4335775b7d1d198922edc69d6001b',
    expected: 'e3f7c379d6afa7b091f68892af8de912e9057cab6aa4b81910442bf500d98',
  },
  {
    name: 'seed-21 (62-char output)',
    sig: '0x0191270adbe6ac5428b3004043b75d019c9e8c670ab6b11d82ff62cba3ca08b415e45323b1f5f8fa218cdbe413c4cb36351e501490b2c3294439a2e5fc0b03fb1b',
    expected: 'e75f56ab6056920fae5b0135dd93868b060c9e5022a260c437c3f412b81c1b',
  },
  {
    name: 'grind-2-iter (triggers rejection loop)',
    sig: '0xe0f22a22299bcae3c4cf7dab3d0ea949aa26c528266e0744902097bb8dd456d2eff56bab2355b3aa86a3852561692670cec68abfff9d016f09c2aa6a398b33691b',
    expected: '3e9cebb796c07cd34a0eb40da7e5fca89236b9f4d097a438b65558801f958bf',
  },
  // Canonical fixtures from starkware-libs/starkware-crypto-utils
  // (test/js/key_derivation.spec.ts on the `dev` branch).
  {
    name: 'upstream getPrivateKeyFromEthSignature fixture',
    sig: '0x21fbf0696d5e0aa2ef41a2b4ffb623bcaf070461d61cf7251c74161f82fec3a4370854bc0a34b3ab487c1bc021cd318c734c51ae29374f2beb0e6f2dd49b4bf41c',
    expected: '766f11e90cd7c7b43085b56da35c781f8c067ac0d578eabdceebc4886435bda',
  },
  {
    // Upstream's `grindKey` test exercises grind directly on a private key.
    // Wrap that input as the r-component of a synthetic signature so it flows
    // through `getPrivateKeyFromEthSignature`; the s/v bytes are ignored.
    name: 'upstream grindKey fixture (wrapped as signature)',
    sig: `0x86F3E7293141F20A8BAFF320E8EE4ACCB9D4A4BF2B4D295E8CEE784DB46E0519${'00'.repeat(32)}1b`,
    expected: '5c8c8683596c732541a59e03007b2d30dbbbb873556fe65b5fb63c16688f941',
  },
];

describe('getPrivateKeyFromEthSignature', () => {
  describe('golden parity with @starkware-industries/starkware-crypto-utils', () => {
    for (const { name, sig, expected } of GOLDEN) {
      it(`matches legacy output for ${name}`, () => {
        expect(getPrivateKeyFromEthSignature(sig)).toBe(expected);
      });
    }
  });

  describe('input handling', () => {
    const baseSig = `${'12'.repeat(32)}${'34'.repeat(32)}1b`; // 130 hex, no prefix

    it('strips a leading 0x prefix', () => {
      const withPrefix = getPrivateKeyFromEthSignature(`0x${baseSig}`);
      const withoutPrefix = getPrivateKeyFromEthSignature(baseSig);
      expect(withPrefix).toBe(withoutPrefix);
    });

    it('treats uppercase and lowercase hex identically', () => {
      const lower = getPrivateKeyFromEthSignature(`0x${baseSig}`);
      const upper = getPrivateKeyFromEthSignature(`0x${baseSig.toUpperCase()}`);
      expect(upper).toBe(lower);
    });

    it('only depends on the first 32 bytes (r); s and v are ignored', () => {
      const r = '12'.repeat(32);
      const sigA = `0x${r}${'aa'.repeat(32)}1b`;
      const sigB = `0x${r}${'bb'.repeat(32)}1c`;
      expect(getPrivateKeyFromEthSignature(sigA)).toBe(getPrivateKeyFromEthSignature(sigB));
    });

    it('is deterministic across repeated calls', () => {
      const a = getPrivateKeyFromEthSignature(`0x${baseSig}`);
      const b = getPrivateKeyFromEthSignature(`0x${baseSig}`);
      expect(a).toBe(b);
    });
  });

  describe('validation', () => {
    const errMatcher = /expected 130-char hex signature/;

    it('throws on empty string', () => {
      expect(() => getPrivateKeyFromEthSignature('')).toThrow(errMatcher);
    });

    it('throws on too-short input', () => {
      expect(() => getPrivateKeyFromEthSignature(`0x${'ab'.repeat(64)}`)).toThrow(errMatcher);
    });

    it('throws on too-long input', () => {
      expect(() => getPrivateKeyFromEthSignature(`0x${'ab'.repeat(66)}`)).toThrow(errMatcher);
    });

    it('throws on non-hex characters', () => {
      const bad = `0x${'zz'.repeat(32)}${'12'.repeat(32)}1b`;
      expect(() => getPrivateKeyFromEthSignature(bad)).toThrow(errMatcher);
    });

    it('throws on 0X (uppercase prefix) since the strip is case-sensitive', () => {
      // Matches legacy behavior: regex /^0x/ is case-sensitive, so a 0X-prefixed
      // signature stays 132 chars after the no-op strip and fails validation.
      const sig = `0X${'12'.repeat(32)}${'34'.repeat(32)}1b`;
      expect(() => getPrivateKeyFromEthSignature(sig)).toThrow(errMatcher);
    });
  });

  describe('output properties', () => {
    it('returns lowercase hex without a 0x prefix', () => {
      for (const { sig } of GOLDEN) {
        const out = getPrivateKeyFromEthSignature(sig);
        expect(out).toMatch(/^[0-9a-f]+$/);
      }
    });

    it('returns a value strictly less than the Stark curve order', () => {
      for (const { sig } of GOLDEN) {
        const out = getPrivateKeyFromEthSignature(sig);
        expect(BigInt(`0x${out}`)).toBeLessThan(STARK_N);
      }
    });

    it('returns a non-zero value for non-degenerate inputs', () => {
      for (const { sig } of GOLDEN) {
        const out = getPrivateKeyFromEthSignature(sig);
        expect(BigInt(`0x${out}`)).toBeGreaterThan(0n);
      }
    });

    it('produces output up to 63 hex chars (≤ STARK_N bit length)', () => {
      for (const { sig } of GOLDEN) {
        expect(getPrivateKeyFromEthSignature(sig).length).toBeLessThanOrEqual(63);
      }
    });
  });
});
