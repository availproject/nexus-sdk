import {
  type Address,
  concatHex,
  encodeFunctionData,
  encodePacked,
  getCreate2Address,
  type Hex,
  keccak256,
  zeroAddress,
} from 'viem';
import { safeProxyFactoryAbi, safeSetupAbi } from './abis';
import {
  SAFE_FALLBACK_HANDLER_ADDRESS,
  SAFE_L2_SINGLETON_ADDRESS,
  SAFE_PROXY_FACTORY_ADDRESS,
  SAFE_PROXY_INIT_CODE_HASH,
  SAFE_SALT_NONCE,
  SAFE_V2_ON_CHAIN_IDENTIFIER,
  SAFE_V2_SALT_NONCE,
} from './constants';

export type SafeAccountAddress = {
  address: Address;
  factoryAddress: Address;
  initializer: Hex;
};

export type SafeAccountAddressV2 = SafeAccountAddress & { salt: Hex };

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

/** @deprecated Predicts the legacy single-owner V1 Safe. Use predictSafeAccountAddressV2. */
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

export function buildSafeInitializerV2(eoaAddress: Address, ephemeralAddress: Address): Hex {
  return encodeFunctionData({
    abi: safeSetupAbi,
    functionName: 'setup',
    args: [
      [eoaAddress, ephemeralAddress],
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

export function predictSafeAccountAddressV2(
  eoaAddress: Address,
  ephemeralAddress: Address
): SafeAccountAddressV2 {
  const initializer = buildSafeInitializerV2(eoaAddress, ephemeralAddress);
  const salt = keccak256(
    encodePacked(['bytes32', 'uint256'], [keccak256(initializer), SAFE_V2_SALT_NONCE])
  );
  const address = getCreate2Address({
    from: SAFE_PROXY_FACTORY_ADDRESS,
    salt,
    bytecodeHash: SAFE_PROXY_INIT_CODE_HASH,
  });
  return { address, factoryAddress: SAFE_PROXY_FACTORY_ADDRESS, initializer, salt };
}

export function buildSafeDeploymentTransactionV2(
  eoaAddress: Address,
  ephemeralAddress: Address
): { to: Address; value: bigint; data: Hex } {
  const { initializer } = predictSafeAccountAddressV2(eoaAddress, ephemeralAddress);
  const data = encodeFunctionData({
    abi: safeProxyFactoryAbi,
    functionName: 'createProxyWithNonce',
    args: [SAFE_L2_SINGLETON_ADDRESS, initializer, SAFE_V2_SALT_NONCE],
  });
  return {
    to: SAFE_PROXY_FACTORY_ADDRESS,
    value: 0n,
    data: concatHex([data, SAFE_V2_ON_CHAIN_IDENTIFIER]),
  };
}
