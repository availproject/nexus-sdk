import type { Hex, WalletClient } from 'viem';
import { storageGetItem, storageRemoveItem, storageSetItem } from '../../services/platform';
import { equalFold } from '../../services/strings';
import {
  deriveEphemeralKeyFromSignature,
  getEphemeralSignatureStorageKey,
  signEphemeralKeyMessage,
  verifyEphemeralSignature,
} from './derived-key';

type DerivedKey = ReturnType<typeof deriveEphemeralKeyFromSignature>;

export const createEphemeralSession = ({ resolveDomain }: { resolveDomain: () => string }) => {
  let derivedKey: DerivedKey | undefined;
  let derivedKeyOwner: Hex | undefined;
  let pendingDerivation: {
    address: Hex;
    promise: Promise<DerivedKey>;
  } | null = null;

  const isCurrentDerivedKeyForAddress = (address: Hex) =>
    !!derivedKey && !!derivedKeyOwner && equalFold(derivedKeyOwner, address);

  const getStored = async (address: Hex): Promise<DerivedKey | null> => {
    if (isCurrentDerivedKeyForAddress(address) && derivedKey) {
      return derivedKey;
    }

    const domain = resolveDomain();
    const storageKey = getEphemeralSignatureStorageKey(address, domain);
    const signature = storageGetItem(storageKey);
    if (!signature) return null;

    const verified = await verifyEphemeralSignature({
      address,
      domain,
      signature: signature as Hex,
    });
    if (!verified) {
      storageRemoveItem(storageKey);
      return null;
    }

    try {
      const key = deriveEphemeralKeyFromSignature(signature as Hex);
      derivedKey = key;
      derivedKeyOwner = address;
      return key;
    } catch {
      storageRemoveItem(storageKey);
      return null;
    }
  };

  const getOrDerive = async (walletClient: WalletClient, address: Hex) => {
    if (isCurrentDerivedKeyForAddress(address) && derivedKey) {
      return derivedKey;
    }

    const storedKey = await getStored(address);
    if (storedKey) {
      return storedKey;
    }

    if (!pendingDerivation || !equalFold(pendingDerivation.address, address)) {
      const domain = resolveDomain();
      const promise = signEphemeralKeyMessage(walletClient, address, domain).then(
        (signature) => {
          storageSetItem(getEphemeralSignatureStorageKey(address, domain), signature);
          const key = deriveEphemeralKeyFromSignature(signature);
          derivedKey = key;
          derivedKeyOwner = address;
          if (pendingDerivation && equalFold(pendingDerivation.address, address)) {
            pendingDerivation = null;
          }
          return key;
        },
        (error) => {
          if (pendingDerivation && equalFold(pendingDerivation.address, address)) {
            pendingDerivation = null;
          }
          throw error;
        }
      );

      pendingDerivation = { address, promise };
    }

    return pendingDerivation.promise;
  };

  const getAddressForEstimation = async (address: Hex): Promise<Hex> => {
    await getStored(address);
    return address;
  };

  /**
   * Synchronously returns the in-memory derived ephemeral key, if any. Unlike
   * `getStored`/`getOrDerive` this never prompts the wallet or touches storage —
   * used by background tasks (e.g. the periodic COT sweep) that must not trigger
   * a fresh signature on every tick.
   */
  const peek = (address: Hex): DerivedKey | null => {
    return isCurrentDerivedKeyForAddress(address) && derivedKey ? derivedKey : null;
  };

  return {
    getAddressForEstimation,
    getStored,
    getOrDerive,
    peek,
  };
};
