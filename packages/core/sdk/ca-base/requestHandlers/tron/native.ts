import { Universe } from '@avail-project/ca-common';
import Long from 'long';
import { ZERO_ADDRESS } from '../../constants';
import { getLogger } from '../../logger';
import { RequestHandlerInput, SimulateReturnType } from '@nexus/commons';
import { cosmosFillCheck, divDecimals, requestTimeout, UserAssets } from '../../utils';
import RequestBase from '../common/base';
import { nativeRequestParseSimulation } from '../common/utils';
import Decimal from 'decimal.js';
import { Types } from 'tronweb';

const logger = getLogger();

class NativeTransfer extends RequestBase {
  destinationUniverse = Universe.TRON;
  private simulateTxRes?: SimulateReturnType;

  constructor(readonly input: RequestHandlerInput) {
    super(input);
  }

  parseSimulation({ assets, simulation }: { assets: UserAssets; simulation: SimulateReturnType }): {
    amount: Decimal;
    gas: Decimal;
    isIntentRequired: boolean;
  } {
    return nativeRequestParseSimulation({
      assets,
      bridge: this.input.options.bridge,
      chain: this.input.chain,
      simulation,
    });
  }

  async simulateTx() {
    const tx = this.input.tron!.tx! as Types.Transaction<Types.TransferContract>;
    const nativeToken = this.input.chainList.getNativeToken(this.input.chain.id);

    this.simulateTxRes = {
      amount: divDecimals(
        tx.raw_data.contract[0].parameter.value.amount ?? '0',
        nativeToken.decimals,
      ),
      gas: BigInt(0),
      gasFee: divDecimals(0, nativeToken.decimals),
      token: {
        contractAddress: ZERO_ADDRESS,
        decimals: nativeToken.decimals,
        name: nativeToken.name,
        symbol: nativeToken.symbol,
      },
    };
    return this.simulateTxRes;
  }

  async waitForFill(
    requestHash: `0x${string}`,
    intentID: Long,
    waitForDoubleCheckTx: () => Promise<void>,
  ) {
    logger.debug('waitForFill:TRX', {
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

export default NativeTransfer;
