import type { Bytes } from '@avail-project/ca-common';
import { type Hex, pad, toBytes, toHex } from 'viem';
import { SUPPORTED_CHAINS } from '../commons';

const convertTo32Bytes = (value: Hex | Bytes) => {
  if (typeof value === 'bigint' || typeof value === 'number') {
    return toBytes(value, {
      size: 32,
    });
  }

  if (typeof value === 'string') {
    return pad(toBytes(value), {
      dir: 'left',
      size: 32,
    });
  }

  return pad(value, {
    dir: 'left',
    size: 32,
  });
};

const convertTo32BytesHex = (value: Hex | Bytes) => {
  return toHex(convertTo32Bytes(value));
};

export const EADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const EADDRESS_32_BYTES = convertTo32Bytes(EADDRESS);
export const SWEEPER_ADDRESS = '0x0000000000296e7a886f40f7bc60D2E3653216a6';
export const ZERO_BYTES_32 = new Uint8Array(32);
export const ZERO_BYTES_20 = new Uint8Array(20);
export const CALIBUR_ADDRESS = '0x00000000557A0daF2659cbb6A45f2beB6081e6AE';
export const CALIBUR_EIP712 = {
  name: 'Calibur',
  salt: convertTo32BytesHex(CALIBUR_ADDRESS),
  version: '1.0.0',
} as const;
export const CALIBUR_ENTRYPOINTS: Partial<Record<number, Hex>> = {
  [SUPPORTED_CHAINS.HYPEREVM]: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
};
export const requireCaliburEntryPoint = (chainId: number): Hex => {
  const entryPoint = CALIBUR_ENTRYPOINTS[chainId];
  if (!entryPoint) {
    throw new Error(`Missing Calibur entrypoint for chain ${chainId}`);
  }
  return entryPoint;
};
export const LIFI_API_KEY =
  'bcb7981d-ea26-4adf-8926-95d3adf4c001.23bcc0d7-7df7-4c86-bb37-ae9ffc25bb95';
export const BEBOP_API_KEY = 'ae262dbf-e4d0-4b66-aaec-57a1b4581440';
export const FEE_COLLECTOR = '0xCABB1EEafEC3d94553E0001B07F9C921b5265090';
