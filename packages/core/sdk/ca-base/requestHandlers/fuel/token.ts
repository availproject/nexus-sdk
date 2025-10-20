import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { Account, TransactionRequest, TransactionRequestLike } from 'fuels';
import Long from 'long';

import { getLogger } from '../../logger';
import { RequestHandlerInput, SimulateReturnType } from '@nexus/commons';
import { cosmosFillCheck, divDecimals, requestTimeout, UserAssets } from '../../utils';
import RequestBase from '../common/base';
import { tokenRequestParseSimulation } from '../common/utils';
import { simulate } from './common';

const logger = getLogger();

class FuelTokenTransfer extends RequestBase {
  allowances: { [k: number]: bigint | null } | null = null;
  destinationUniverse = Universe.FUEL;
  fuelAddress: string;
  simulateTxRes?: SimulateReturnType;
  tx: TransactionRequestLike;
  constructor(readonly input: RequestHandlerInput) {
    super(input);
    if (!this.input.fuel?.tx) {
      throw new Error('Invalid request');
    }
    if (!this.input.fuel.address) {
      throw new Error('fuel address missing');
    }
    this.tx = this.input.fuel.tx;
    this.fuelAddress = this.input.fuel.address;
  }

  parseSimulation({ assets, simulation }: { assets: UserAssets; simulation: SimulateReturnType }) {
    return tokenRequestParseSimulation({
      assets,
      bridge: this.input.options.bridge,
      chain: this.input.chain,
      iGas: this.input.options.gas,
      simulation,
    });
  }

  async simulateTx() {
    logger.debug('fuel: reached simulate tx');
    const nativeCurrency = this.input.chain.nativeCurrency;

    if (this.simulateTxRes) {
      let gasFee = new Decimal(0);
      if (!this.input.options.bridge) {
        const { assembledRequest } = await this.input.fuel!.provider.assembleTx({
          feePayerAccount: new Account(this.input.fuel!.address),
          request: this.input.fuel!.tx as TransactionRequest,
        });
        gasFee = divDecimals(
          BigInt(assembledRequest.maxFee.toString()) * 2n,
          nativeCurrency.decimals,
        );
      }
      return {
        ...this.simulateTxRes,
        gasFee,
      };
    }

    this.simulateTxRes = await simulate(
      this.tx,
      this.fuelAddress,
      this.input.fuel!.provider,
      this.input.chainList,
    );
    if (this.input.options.bridge && this.simulateTxRes) {
      this.simulateTxRes.gasFee = new Decimal(0);
    }

    return this.simulateTxRes;
  }

  async waitForFill(_: `0x${string}`, intentID: Long) {
    const ac = new AbortController();
    await Promise.race([
      requestTimeout(3, ac),
      cosmosFillCheck(
        intentID,
        this.input.options.networkConfig.GRPC_URL,
        this.input.options.networkConfig.COSMOS_URL,
        ac,
      ),
    ]);
  }
}

export default FuelTokenTransfer;
