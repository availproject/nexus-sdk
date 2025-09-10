import Decimal from 'decimal.js';
import { Account, bn, CHAIN_IDS } from 'fuels';
import { encodeFunctionData } from 'viem';

import ERC20ABI from '../abi/erc20';
import { ZERO_ADDRESS } from '../constants';
import { getLogger } from '../logger';
import { BridgeQueryInput, CA, EVMTransaction, IRequestHandler } from '@nexus/commons';
import { convertIntent, equalFold, mulDecimals, ChainList, fetchBalances } from '../utils';

const logger = getLogger();

class BridgeQuery {
  private handler?: IRequestHandler | null = null;
  constructor(
    private input: BridgeQueryInput,
    private init: CA['init'],
    private switchChain: CA['switchChain'],
    private createEVMHandler: CA['createEVMHandler'],
    private createFuelHandler: CA['createFuelHandler'],
    private address: `0x${string}`,
    private vscDomain: string,
    private chainList: ChainList,
    private fuelAccount?: Account,
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

      if (input.token && input.amount && input.chainID) {
        const token = this.chainList.getTokenInfoBySymbol(input.chainID, input.token);
        if (!token) {
          throw new Error('Token not supported on this chain.');
        }

        const bridgeAmount = mulDecimals(input.amount, token.decimals);

        const balances = await fetchBalances(this.vscDomain, this.address, this.chainList);

        const asset = balances.assets.find(token.symbol);
        const currentChainBalance = asset.getBalanceOnChain(input.chainID);
        const assetBalance = asset.balance ?? 0;

        const availableBalance = mulDecimals(
          new Decimal(assetBalance).minus(currentChainBalance),
          token.decimals,
        );

        logger.debug('bridge', {
          asset,
          assetBalance: assetBalance.toString(),
          availableBalance: availableBalance.toString(),
          balances,
          currentChainBalance: currentChainBalance.toString(),
          requiredBalance: bridgeAmount.toString(),
        });

        if (availableBalance < bridgeAmount) {
          throw new Error('Insufficient balance');
        }

        if (input.chainID === CHAIN_IDS.fuel.mainnet) {
          if (this.fuelAccount) {
            const tx = await this.fuelAccount.createTransfer(
              // Random address, since bridge won't call the final tx
              '0xE78655DfAd552fc3658c01bfb427b9EAb0c628F54e60b54fDA16c95aaAdE797A',
              bn(bridgeAmount.toString()),
              token.contractAddress,
            );

            const handlerResponse = await this.createFuelHandler(tx, {
              bridge: true,
              gas: input.gas ?? 0n,
              skipTx: true,
            });

            this.handler = handlerResponse?.handler;
          } else {
            throw new Error('Fuel connector is not set');
          }
        } else {
          await this.switchChain(input.chainID);
          const p: EVMTransaction = {
            from: this.address,
            to: this.address,
          };

          const isNative = equalFold(token.contractAddress, ZERO_ADDRESS);

          if (isNative) {
            p.value = `0x${bridgeAmount.toString(16)}` as `0x${string}`;
            input.gas = 0n;
          } else {
            p.to = token.contractAddress;
            p.data = encodeFunctionData({
              abi: ERC20ABI,
              args: [this.address, BigInt(bridgeAmount.toString())],
              functionName: 'transfer',
            });
          }

          const handlerResponse = await this.createEVMHandler(p, {
            bridge: true,
            gas: input.gas ?? 0n,
            skipTx: true,
            sourceChains: input.sourceChains,
          });

          this.handler = handlerResponse?.handler;
        }

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
