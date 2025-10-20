import { Hex } from 'viem';
import { convertIntent, mulDecimals } from '../utils';
import {
  BridgeQueryInput,
  CA,
  IRequestHandler,
  ChainListType,
  SupportedUniverse,
} from '@nexus/commons';
import { Universe } from '@avail-project/ca-common';

class BridgeQuery {
  private handler?: IRequestHandler | null = null;
  constructor(
    private input: BridgeQueryInput,
    private init: CA['init'],
    private createHandler: CA['createHandler'],
    private address: `0x${string}`,
    private chainList: ChainListType,
  ) {}

  exec = () => {
    if (!this.handler) {
      throw new Error('ca not applicable');
    }

    return this.handler.process();
  };

  public async initHandler() {
    if (!this.handler) {
      const input = this.input;
      await this.init();

      if (input.token && input.amount && input.chainId) {
        const { chain, token } = this.chainList.getChainAndTokenFromSymbol(
          input.chainId,
          input.token,
        );
        if (!token) {
          throw new Error('Token not supported on this chain.');
        }

        const bridgeAmount = mulDecimals(input.amount, token.decimals);
        const params = {
          amount: bridgeAmount,
          receiver: this.address,
          tokenAddress: token.contractAddress,
          universe: chain.universe as SupportedUniverse,
          chainId: chain.id,
        };

        if (chain.universe === Universe.FUEL) {
          params.receiver =
            '0xE78655DfAd552fc3658c01bfb427b9EAb0c628F54e60b54fDA16c95aaAdE797A' as Hex;
        }

        const response = await this.createHandler(params, {
          bridge: true,
          gas: input.gas ?? 0n,
          skipTx: true,
          sourceChains: input.sourceChains,
        });
        this.handler = response?.handler;

        return;
      }
      throw new Error('bridge: missing params');
    }
  }

  simulate = async () => {
    if (!this.handler) {
      throw new Error('ca not applicable');
    }

    const response = await this.handler.buildIntent(this.input.sourceChains ?? []);
    if (!response) {
      throw new Error('ca not applicable');
    }

    return {
      intent: convertIntent(response.intent, response.token, this.chainList),
      token: response.token,
    };
  };
}

export { BridgeQuery };
