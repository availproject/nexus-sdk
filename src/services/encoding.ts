import { type Hex, pad, toBytes, toHex } from 'viem';
import type { Bytes } from '../domain/chain-abstraction';

const convertTo32Bytes = (value: bigint | Hex | number | Bytes) => {
  if (typeof value === 'bigint' || typeof value === 'number') {
    return toBytes(value, {
      size: 32,
    });
  } else if (typeof value === 'string') {
    return pad(toBytes(value), {
      dir: 'left',
      size: 32,
    });
  } else {
    const bytes = Array.isArray(value) ? Uint8Array.from(value) : value;
    return pad(bytes, {
      dir: 'left',
      size: 32,
    });
  }
};

export const convertTo32BytesHex = (value: Hex | Bytes) => {
  const bytes = convertTo32Bytes(value);
  return toHex(bytes);
};
