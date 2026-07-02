import {
  type Address,
  encodeFunctionData,
  encodePacked,
  getCreate2Address,
  type Hex,
  keccak256,
  zeroAddress,
} from 'viem';
import { safeSetupAbi } from './abis';
import {
  SAFE_FALLBACK_HANDLER_ADDRESS,
  SAFE_PROXY_FACTORY_ADDRESS,
  SAFE_PROXY_INIT_CODE_HASH,
  SAFE_SALT_NONCE,
} from './constants';

export type SafeAccountAddress = {
  address: Address;
  factoryAddress: Address;
  initializer: Hex;
};

// setup() calldata the proxy factory delegatecalls on deploy: single owner, threshold 1, canonical
// fallback handler, no module/payment. Any drift produces a different CREATE2 salt and a different
// Safe address.
export function buildSafeInitializer(owner: Address): Hex {
  return encodeFunctionData({
    abi: safeSetupAbi,
    functionName: 'setup',
    args: [
      [owner],
      1n,
      zeroAddress,
      '0x',
      SAFE_FALLBACK_HANDLER_ADDRESS,
      zeroAddress,
      0n,
      zeroAddress,
    ],
  });
}

export function predictSafeAccountAddress(owner: Address): SafeAccountAddress {
  const initializer = buildSafeInitializer(owner);
  const salt = keccak256(
    encodePacked(['bytes32', 'uint256'], [keccak256(initializer), SAFE_SALT_NONCE])
  );
  const address = getCreate2Address({
    from: SAFE_PROXY_FACTORY_ADDRESS,
    salt,
    bytecodeHash: SAFE_PROXY_INIT_CODE_HASH,
  });
  return { address, factoryAddress: SAFE_PROXY_FACTORY_ADDRESS, initializer };
}
