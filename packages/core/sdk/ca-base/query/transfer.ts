import { Hex } from 'viem';
import { getLogger } from '../logger';
import { convertIntent, mulDecimals } from '../utils';
import {
  CA,
  CreateHandlerResponse,
  TransferQueryInput,
  ChainListType,
  SupportedUniverse,
} from '@nexus/commons';

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
        const { chain, token } = this.chainList.getChainAndTokenFromSymbol(
          input.chainId,
          input.token,
        );
        if (!token) {
          throw new Error('Token not supported on this chain.');
        }

        const amount = mulDecimals(input.amount, token.decimals);

        this.handlerResponse = await this.createHandler(
          {
            amount: amount,
            receiver: input.to,
            tokenAddress: token.contractAddress,
            universe: chain.universe as SupportedUniverse,
            chainId: chain.id,
          },
          {
            bridge: false,
            gas: 0n,
            skipTx: false,
            sourceChains: input.sourceChains,
          },
        );

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
