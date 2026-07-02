import type { Hex } from 'viem';
import { Universe } from '../domain/chain-abstraction';
import { Errors } from '../domain/errors';

export const retrieveAddress = (universe: Universe, input: { evm: { address: Hex } }): Hex => {
  if (universe === Universe.ETHEREUM) {
    return input.evm.address;
  }

  throw Errors.universeNotSupported();
};
