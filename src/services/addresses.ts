import { EADDRESS, EADDRESS_BYTES_32, ZERO_ADDRESS, ZERO_ADDRESS_BYTES_32 } from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { equalFold } from './strings';

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
