import { FUEL_NETWORK_URL } from '../constants';
import { getLogger } from '../logger';
import { CreateHandlerResponse, RequestHandler, RequestHandlerInput } from '@nexus/commons';
import { switchChain } from '../utils';
import { isERC20TokenTransfer, isNativeTokenTransfer } from './evm/common';
import ERC20Transfer from './evm/erc20';
import NativeTransfer from './evm/native';
import TRC20Transfer from './tron/trc20';
import TRXTransfer from './tron/native';
import { fixTx, isFuelNativeTransfer } from './fuel/common';
import FuelNativeTransfer from './fuel/native';
import FuelTokenTransfer from './fuel/token';
import { isTRC20TokenTransfer, isTRXTransfer } from './tron/common';

const logger = getLogger();

enum TxType {
  EVMERC20Transfer,
  EVMNativeTransfer,
  TronTRXTransfer,
  TronTRC20Transfer,
  FuelTokenTransfer,
  FuelNativeTransfer,
}

const handlers: Record<TxType, RequestHandler> = {
  [TxType.EVMERC20Transfer]: ERC20Transfer,
  [TxType.EVMNativeTransfer]: NativeTransfer,
  [TxType.TronTRXTransfer]: TRXTransfer,
  [TxType.TronTRC20Transfer]: TRC20Transfer,
  [TxType.FuelNativeTransfer]: FuelNativeTransfer,
  [TxType.FuelTokenTransfer]: FuelTokenTransfer,
};

const createHandler = (input: RequestHandlerInput): CreateHandlerResponse => {
  logger.debug('router', { input });
  let handler: null | RequestHandler = null;
  let processTx: () => Promise<unknown> = async () => {};
  if (input.evm.tx) {
    const tx = input.evm.tx;
    if (isERC20TokenTransfer(input)) {
      handler = handlers[TxType.EVMERC20Transfer];
    } else if (isNativeTokenTransfer(input)) {
      handler = handlers[TxType.EVMNativeTransfer];
    }
    processTx = async () => {
      if (!input.options.bridge && !input.options.skipTx) {
        logger.debug('in processTx', {
          tx: input.evm.tx,
        });
        await switchChain(input.evm.client, input.chain);
        return input.evm.client.request({
          method: 'eth_sendTransaction',
          params: [tx],
        });
      }
      return;
    };
  } else if (input.fuel && input.fuel.tx) {
    const fuelInput = input.fuel;
    const tx = input.fuel.tx;
    if (isFuelNativeTransfer(input.fuel.tx)) {
      handler = handlers[TxType.FuelNativeTransfer];
    } else {
      handler = handlers[TxType.FuelTokenTransfer];
    }

    processTx = async () => {
      if (!input.options.bridge && !input.options.skipTx) {
        logger.debug('in processTx', {
          address: fuelInput.address,
          provider: fuelInput.provider,
          tx: input.fuel?.tx,
        });
        const fixedTx = await fixTx(fuelInput.address, tx, fuelInput.provider);
        return fuelInput.connector.sendTransaction(fuelInput.address, fixedTx, {
          provider: {
            url: FUEL_NETWORK_URL,
          },
        });
      }
      return;
    };
  } else if (input.tron && input.tron?.tx) {
    if (isTRXTransfer(input.tron.tx)) {
      handler = handlers[TxType.TronTRXTransfer];
    } else if (isTRC20TokenTransfer(input.tron.tx)) {
      handler = handlers[TxType.TronTRC20Transfer];
    }
    processTx = async () => {
      if (!input.options.bridge && !input.options.skipTx) {
        // Send tron tx
      }
    };
  } else {
    throw Error('Unknown handler');
  }

  return {
    handler: handler ? new handler(input) : null,
    processTx,
  };
};

export { createHandler };
