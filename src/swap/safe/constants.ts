import { type Address, type Hex, hexToBigInt, keccak256, stringToBytes } from 'viem';

// Canonical Safe v1.4.1 deployment addresses, identical on every chain Safe ships on. The
// middleware (nexus-v2/middleware/src/modules/sbc/safe/constants.ts) is the cross-repo source of
// truth — both client and server must agree byte-for-byte or address derivation diverges.
export const SAFE_PROXY_FACTORY_ADDRESS: Address = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67';
export const SAFE_L2_SINGLETON_ADDRESS: Address = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762';
export const SAFE_MULTI_SEND_CALL_ONLY_ADDRESS: Address =
  '0x9641d764fc13c8B624c04430C7356C1C7C8102e2';
export const SAFE_FALLBACK_HANDLER_ADDRESS: Address = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99';

// keccak256(SafeProxy.creationCode ‖ abi.encode(SAFE_L2_SINGLETON_ADDRESS)) for the deployed
// factory + singleton above. The CREATE2 prediction must use this exact value or it resolves to a
// different address than the factory actually deploys.
export const SAFE_PROXY_INIT_CODE_HASH: Hex =
  '0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee';

// CREATE2 salt nonce derived from a versioned namespace string. Pins each owner to one
// deterministic Safe; the version suffix leaves a path for `.v2` if the product ever wants
// multiple Safes per owner. The literal value (0x18c19de7…) is part of on-chain state for any
// Safe already deployed at this address — never change the source string after deploys exist.
export const SAFE_SALT_NONCE_NAMESPACE = 'avail.nexus.safe.v1' as const;
export const SAFE_SALT_NONCE = hexToBigInt(keccak256(stringToBytes(SAFE_SALT_NONCE_NAMESPACE)));

export const SAFE_OPERATION_CALL = 0 as const;
export const SAFE_OPERATION_DELEGATECALL = 1 as const;
export type SafeOperation = typeof SAFE_OPERATION_CALL | typeof SAFE_OPERATION_DELEGATECALL;
