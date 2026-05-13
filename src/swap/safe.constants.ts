import { type Hex, keccak256, stringToBytes } from 'viem';

export const SAFE_PROXY_FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67';
export const SAFE_L2_SINGLETON = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762';
export const MULTI_SEND_CALL_ONLY = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2';
export const COMPAT_FALLBACK_HANDLER = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99';

export const SAFE_SALT_NONCE =
  11197599655881020237971107609127442512094659259259914404695382623312824468967n;

export const SAFE_PROXY_INIT_CODE_HASH =
  '0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee';

export const SAFE_TX_TYPEHASH = keccak256(
  stringToBytes(
    'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)'
  )
);

export const SAFE_DOMAIN_TYPEHASH = keccak256(
  stringToBytes('EIP712Domain(uint256 chainId,address verifyingContract)')
);

export const ENSURE_AUTH_TYPEHASH = keccak256(
  stringToBytes(
    'NexusSafeEnsure(uint256 chainId,address owner,address safeAddress,uint256 saltNonce,uint256 deadline)'
  )
);

export const SAFE_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export const SAFE_OPERATION_CALL = 0;
export const SAFE_OPERATION_DELEGATECALL = 1;

export type SafeOperation = typeof SAFE_OPERATION_CALL | typeof SAFE_OPERATION_DELEGATECALL;
export type SafeAddress = Hex;
