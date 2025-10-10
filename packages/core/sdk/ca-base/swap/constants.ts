import { convertTo32BytesHex } from '../utils';

export const EADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const SWEEPER_ADDRESS = '0x0000000000296e7a886f40f7bc60D2E3653216a6';
export const ZERO_BYTES_32 = new Uint8Array(32);
export const ZERO_BYTES_20 = new Uint8Array(20);
export const CALIBUR_ADDRESS = '0x00000000557A0daF2659cbb6A45f2beB6081e6AE';
export const CALIBUR_EIP712 = {
  name: 'Calibur',
  salt: convertTo32BytesHex(CALIBUR_ADDRESS),
  version: '1.0.0',
} as const;
export const LIFI_API_KEY =
  'bcb7981d-ea26-4adf-8926-95d3adf4c001.23bcc0d7-7df7-4c86-bb37-ae9ffc25bb95';
export const BEBOP_API_KEY = 'ae262dbf-e4d0-4b66-aaec-57a1b4581440';
