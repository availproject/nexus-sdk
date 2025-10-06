import { Account, bn, CHAIN_IDS } from 'fuels';
import { encodeFunctionData, Hex } from 'viem';

import ERC20ABI from '../abi/erc20';
import { TRON_CHAIN_ID, ZERO_ADDRESS } from '../constants';
import { getLogger } from '../logger';
import { convertIntent, equalFold, mulDecimals } from '../utils';
import {
  CA,
  CreateHandlerResponse,
  EVMTransaction,
  TransferQueryInput,
  ChainListType,
  SupportedUniverse,
} from '@nexus/commons';
import { Universe } from '@arcana/ca-common';

const logger = getLogger();

class TransferQuery {
  private handlerResponse: CreateHandlerResponse | null = null;
  constructor(
    private input: TransferQueryInput,
    private init: CA['init'],
    private createHandler: CA['createHandler'],
    private chainList: ChainListType,
  ) {}

  exec = async () => {
    if (!this.handlerResponse?.handler) {
      throw new Error('ca not applicable');
    }

    let explorerURL = '';
    const result = await this.handlerResponse.handler.process();
    if (result) {
      explorerURL = result.explorerURL;
    }
    logger.debug('TransferQuery:Exec', {
      state: 'processing completed, going to processTx()',
    });
    const hash = (await this.handlerResponse.processTx()) as Hex;
    return {
      hash,
      explorerURL,
    };
  };

  public async initHandler() {
    if (!this.handlerResponse) {
      const input = this.input;
      await this.init();

      logger.debug('SendQueryBuilder.exec', {
        c: input.chainId,
        p: input,
      });
      if (input.to && input.amount !== undefined && input.token && input.chainId) {
        const token = this.chainList.getTokenInfoBySymbol(input.chainId, input.token);
        if (!token) {
          throw new Error('Token not supported on this chain.');
        }

        const amount = mulDecimals(input.amount, token.decimals);

        const params = {
          amount: amount,
          receiver: input.to,
          tokenAddress: token.contractAddress,
          universe: Universe.ETHEREUM as SupportedUniverse,
        };

        logger.debug('transfer:2', { amount, token });

        if (input.chainId === CHAIN_IDS.fuel.mainnet) {
        } else if (input.chainId === TRON_CHAIN_ID) {
          params.universe = Universe.UNRECOGNIZED;
        }

        this.handlerResponse = await this.createHandler(params, {
          bridge: false,
          gas: 0n,
          skipTx: false,
          sourceChains: input.sourceChains,
        });

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
