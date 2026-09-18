import { type ByteArray, type Hex, toBytes, toHex } from 'viem';
import { EADDRESS, EADDRESS_BYTES_32, ZERO_ADDRESS, ZERO_ADDRESS_BYTES_32 } from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { ARC_USDC_ERC20_INTERFACE } from '../domain/constants/addresses';
import { Errors } from '../domain/errors';
import { equalFold } from './strings';

// Arc's ERC-20 interface exposes the native USDC balance in ERC-20 units.
export const getNativeTokenErc20Interface = (chainId: number): Hex | undefined =>
  chainId === 5042 || chainId === 5042002 ? ARC_USDC_ERC20_INTERFACE : undefined;

export function convertAddressByUniverse(input: Hex, universe: Universe): Hex;
export function convertAddressByUniverse(input: ByteArray, universe: Universe): ByteArray;

export function convertAddressByUniverse(input: ByteArray | Hex, universe: Universe) {
  const inputIsString = typeof input === 'string';
  const bytes = inputIsString ? toBytes(input) : input;

  if (bytes.length !== 20 && bytes.length !== 32) {
    const addressType =
      universe === Universe.ETHEREUM
        ? 'evm'
        : String(Universe[universe] ?? 'address').toLowerCase();
    throw Errors.invalidAddressLength(addressType, 'expected 20 or 32 bytes');
  }

  if (universe === Universe.ETHEREUM) {
    if (bytes.length === 20) {
      return inputIsString ? input : bytes;
    }

    return inputIsString ? toHex(bytes.subarray(12)) : bytes.subarray(12);
  }

  return inputIsString ? input : bytes;
}

export const isNativeAddress = (address: `0x${string}`, universe: Universe = Universe.ETHEREUM) => {
  if (universe === Universe.ETHEREUM) {
    return (
      equalFold(address, ZERO_ADDRESS) ||
      equalFold(address, ZERO_ADDRESS_BYTES_32) ||
      equalFold(address, EADDRESS) ||
      equalFold(address, EADDRESS_BYTES_32)
    );
  }
  return false;
};
