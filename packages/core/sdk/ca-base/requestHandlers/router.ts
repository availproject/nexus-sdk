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
  } else if (input.fuel?.tx) {
    if (isFuelNativeTransfer(input.fuel.tx)) {
      handler = handlers[TxType.FuelNativeTransfer];
    } else {
      handler = handlers[TxType.FuelTokenTransfer];
    }

    processTx = async () => {
      if (!input.options.bridge && !input.options.skipTx) {
        logger.debug('in processTx', {
          address: input.fuel!.address,
          provider: input.fuel!.provider,
          tx: input.fuel?.tx,
        });
        const tx = await fixTx(input.fuel!.address, input.fuel!.tx!, input.fuel!.provider);

        return input.fuel!.connector.sendTransaction(input.fuel!.address, tx, {
          provider: {
            url: FUEL_NETWORK_URL,
          },
        });
      }
      return;
    };
  } else if (input.tron?.tx) {
    
  } else {
    throw Error('Unknown handler');
  }

  return {
    handler: handler ? new handler(input) : null,
    processTx,
  };
};

export { createHandler };
