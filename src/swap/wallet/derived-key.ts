import { type Hex, recoverMessageAddress, type WalletClient } from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';
import { Errors } from '../../domain/errors';
import { isUserRejectedRequest } from '../../services/is-user-rejected-request';
import { equalFold } from '../../services/strings';
import { getPrivateKeyFromEthSignature } from './stark';

const EPHEMERAL_SIGNATURE_STORAGE_PREFIX = 'nexus-sdk-v2:ephemeral-signature:';
const EPHEMERAL_SIGN_IDENTIFIER = 'avail-nexus';

// ---------------------------------------------------------------------------
// deriveEphemeralKey
// ---------------------------------------------------------------------------

/**
 * Derives an ephemeral PrivateKeyAccount from an EOA wallet signature.
 *
 * 1. personal_sign(buildEphemeralSignMessage({ address, domain }))
 * 2. starkware grind: getPrivateKeyFromEthSignature(signature)
 * 3. privateKeyToAccount(`0x${derivedKey}`)
 *
 * Deterministic: same EOA + same domain → same ephemeral address.
 */
export const buildEphemeralSignMessage = ({
  address,
  domain,
}: {
  address: Hex;
  domain: string;
}): string =>
  [
    'Sign in to enable Avail Nexus swap',
    '',
    'This signature does not authorize any transaction.',
    '',
    `Account: ${address.toLowerCase()}`,
    `Domain: ${domain}`,
    `Identifier: ${EPHEMERAL_SIGN_IDENTIFIER}`,
  ].join('\n');

export const getEphemeralSignatureStorageKey = (address: Hex, domain: string): string =>
  `${EPHEMERAL_SIGNATURE_STORAGE_PREFIX}${address.toLowerCase()}:${domain}`;

export const signEphemeralKeyMessage = async (
  walletClient: WalletClient,
  address: Hex,
  domain: string
): Promise<Hex> => {
  try {
    return await walletClient.signMessage({
      message: buildEphemeralSignMessage({ address, domain }),
      account: address,
    });
  } catch (error) {
    if (isUserRejectedRequest(error)) {
      throw Errors.userRejectedEphemeralKey();
    }
    throw Errors.ephemeralKeyFailed(error);
  }
};

export const deriveEphemeralKeyFromSignature = (signature: Hex): PrivateKeyAccount => {
  try {
    const pvtKey = getPrivateKeyFromEthSignature(signature);
    return privateKeyToAccount(`0x${pvtKey.padStart(64, '0')}`);
  } catch (error) {
    throw Errors.ephemeralKeyFailed(error);
  }
};

export const deriveEphemeralKey = async (
  walletClient: WalletClient,
  address: Hex,
  domain: string
): Promise<PrivateKeyAccount> => {
  const signature = await signEphemeralKeyMessage(walletClient, address, domain);
  return deriveEphemeralKeyFromSignature(signature);
};

/**
 * Verifies that `signature` was produced by `address` signing the ephemeral-key
 * message for `domain`. Used to validate a cached signature before deriving a
 * key from it, so a tampered or stale localStorage value can't silently swap
 * the ephemeral key for one controlled by someone else.
 */
export const verifyEphemeralSignature = async ({
  address,
  domain,
  signature,
}: {
  address: Hex;
  domain: string;
  signature: Hex;
}): Promise<boolean> => {
  try {
    const recovered = await recoverMessageAddress({
      message: buildEphemeralSignMessage({ address, domain }),
      signature,
    });
    return equalFold(recovered, address);
  } catch {
    return false;
  }
};
