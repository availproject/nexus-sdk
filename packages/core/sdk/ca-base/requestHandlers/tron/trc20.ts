import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import Long from 'long';
import { decodeFunctionData, Hex } from 'viem';

import { utils, Types } from 'tronweb';

import type { RequestHandlerInput, SimulateReturnType } from '@nexus/commons';

import { ERC20TransferABI } from '../../abi/erc20';
import { getLogger } from '../../logger';
import { cosmosFillCheck, divDecimals, requestTimeout, UserAssets } from '../../utils';
import RequestBase from '../common/base';
import { tokenRequestParseSimulation } from '../common/utils';
import { tronHexToEvmAddress } from './common';

const logger = getLogger();

class TRC20Transfer extends RequestBase {
  destinationUniverse = Universe.TRON;
  simulateTxRes?: SimulateReturnType;

  constructor(readonly input: RequestHandlerInput) {
    super(input);
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

  async simulateTx(): Promise<undefined | SimulateReturnType> {
    const tx = this.input.tron!.tx! as Types.Transaction<Types.TriggerSmartContract>;
    const tokenHexAddr: Hex = tronHexToEvmAddress(
      utils.address.toHex(tx.raw_data.contract[0].parameter.value.contract_address),
    );
    const token = this.chainList.getTokenByAddress(this.input.chain.id, tokenHexAddr);
    logger.debug('TRC20Transfer:1', {
      tx,
      token,
      tokenHexAddr,
    });
    if (!token) {
      return;
    }

    logger.debug('TRC20Transfer:1', {
      tx,
    });

    const { args } = decodeFunctionData({
      abi: [ERC20TransferABI],
      data: `0x${tx.raw_data.contract[0].parameter.value.data}` as Hex,
    });

    const tokenAmount = args[1];

    logger.debug('TRC20Transfer:2', {
      tx,
      args,
    });

    this.simulateTxRes = {
      amount: divDecimals(tokenAmount, token.decimals),
      gas: 0n,
      gasFee: new Decimal(0),
      token,
    };

    return this.simulateTxRes;
  }

  async waitForFill(
    requestHash: `0x${string}`,
    intentID: Long,
    waitForDoubleCheckTx: () => Promise<void>,
  ) {
    logger.debug('waitForFill:TRC20', {
      intentID,
      requestHash,
      waitForDoubleCheckTx,
    });
    waitForDoubleCheckTx();
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

export default TRC20Transfer;
