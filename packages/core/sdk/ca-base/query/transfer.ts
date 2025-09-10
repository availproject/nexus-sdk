import { Account, bn, CHAIN_IDS } from 'fuels';
import { encodeFunctionData, Hex } from 'viem';

import ERC20ABI from '../abi/erc20';
import { ZERO_ADDRESS } from '../constants';
import { getLogger } from '../logger';
import { CA, CreateHandlerResponse, EVMTransaction, TransferQueryInput } from '@nexus/commons';
import { ChainList, convertIntent, equalFold, mulDecimals } from '../utils';

const logger = getLogger();

class TransferQuery {
  private handlerResponse: CreateHandlerResponse | null = null;
  constructor(
    private input: TransferQueryInput,
    private init: CA['init'],
    private switchChain: CA['switchChain'],
    private createEVMHandler: CA['createEVMHandler'],
    private createFuelHandler: CA['createFuelHandler'],
    private evmAddress: Hex,
    private chainList: ChainList,
    private fuelAccount?: Account,
  ) {}

  exec = async () => {
    if (!this.handlerResponse?.handler) {
      throw new Error('ca not applicable');
    }

    await this.handlerResponse.handler.process();
    logger.debug('TransferQuery:Exec', {
      state: 'processing completed, going to processTx()',
    });
    return this.handlerResponse.processTx();
  };

  public async initHandler() {
    if (!this.handlerResponse) {
      const input = this.input;
      await this.init();

      logger.debug('SendQueryBuilder.exec', {
        c: input.chainID,
        p: input,
      });
      if (input.to && input.amount !== undefined && input.token && input.chainID) {
        const tokenInfo = this.chainList.getTokenInfoBySymbol(input.chainID, input.token);
        if (!tokenInfo) {
          throw new Error('Token not supported on this chain.');
        }

        const amount = mulDecimals(input.amount, tokenInfo.decimals);

        logger.debug('transfer:2', { amount, tokenInfo });

        if (input.chainID === CHAIN_IDS.fuel.mainnet) {
          if (this.fuelAccount) {
            const tx = await this.fuelAccount.createTransfer(
              input.to,
              bn(amount.toString()),
              tokenInfo.contractAddress,
            );
            this.handlerResponse = await this.createFuelHandler(tx, {
              bridge: false,
              gas: 0n,
              skipTx: false,
            });
          } else {
            throw new Error('Fuel connector is not set');
          }
        } else {
          await this.switchChain(input.chainID);
          const isNative = equalFold(tokenInfo.contractAddress, ZERO_ADDRESS);

          const p: EVMTransaction = {
            from: this.evmAddress,
            to: input.to,
          };
          if (isNative) {
            p.value = `0x${amount.toString(16)}`;
          } else {
            p.to = tokenInfo.contractAddress;
            p.data = encodeFunctionData({
              abi: ERC20ABI,
              args: [input.to, amount],
              functionName: 'transfer',
            });
          }

          this.handlerResponse = await this.createEVMHandler(p, {
            bridge: false,
            gas: 0n,
            skipTx: false,
            sourceChains: input.sourceChains,
          });
        }

        return;
      }
      throw new Error('transfer: missing params');
    }
  }

  simulate = async () => {
    if (!this.handlerResponse?.handler) {
      throw new Error('ca not applicable');
    }

    const response = await this.handlerResponse.handler.buildIntent(this.input.sourceChains ?? []);
    if (!response) {
      throw new Error('ca not applicable');
    }

    return {
      intent: convertIntent(response.intent, response.token, this.chainList),
      token: response.token,
    };
  };
}

export { TransferQuery };
