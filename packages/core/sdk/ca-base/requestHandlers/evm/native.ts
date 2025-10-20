import { Universe } from '@avail-project/ca-common';
import Long from 'long';
import {
  createPublicClient,
  hexToBigInt,
  PublicClient,
  serializeTransaction,
  webSocket,
  WebSocketTransport,
} from 'viem';

import { ZERO_ADDRESS } from '../../constants';
import { getLogger } from '../../logger';
import { simulateTransaction, SimulationRequest } from '../../simulate';
import { RequestHandlerInput, SimulateReturnType } from '@nexus/commons';
import { divDecimals, evmWaitForFill, getL1Fee, UserAssets } from '../../utils';
import RequestBase from '../common/base';
import { nativeRequestParseSimulation } from '../common/utils';
import Decimal from 'decimal.js';

const logger = getLogger();

class NativeTransfer extends RequestBase {
  destinationUniverse = Universe.ETHEREUM;
  private publicClient: PublicClient<WebSocketTransport>;
  private simulateTxRes?: SimulateReturnType;

  constructor(readonly input: RequestHandlerInput) {
    super(input);
    const wsUrls = this.input.chain.rpcUrls?.default?.webSocket;
    if (!wsUrls?.length) {
      throw new Error(`Web-Socket RPC URL missing for chain ${this.input.chain.id}`);
    }

    this.publicClient = createPublicClient({
      transport: webSocket(wsUrls[0]),
    });
  }

  parseSimulation({ assets, simulation }: { assets: UserAssets; simulation: SimulateReturnType }) {
    return nativeRequestParseSimulation({
      assets,
      bridge: this.input.options.bridge,
      chain: this.input.chain,
      simulation,
    });
  }

  async simulateTx() {
    const { data, to, value } = this.input.evm.tx!;
    const nativeToken = this.input.chainList.getNativeToken(this.input.chain.id);

    const amount = hexToBigInt((value as `0x${string}`) ?? `0x00`);
    const amountInDecimal = divDecimals(amount, nativeToken.decimals);

    if (this.input.options.bridge) {
      this.simulateTxRes = {
        amount: amountInDecimal,
        gas: this.input.options.gas,
        gasFee: new Decimal(0),
        token: nativeToken,
      };
    }

    if (this.simulateTxRes) {
      let gasFee = 0n;

      if (this.simulateTxRes.gas > 0n) {
        const [{ gasPrice, maxFeePerGas }, l1Fee] = await Promise.all([
          this.publicClient.estimateFeesPerGas(),
          this.input.options.bridge
            ? Promise.resolve(0n)
            : getL1Fee(
                this.input.chain,
                serializeTransaction({
                  chainId: this.input.chain.id,
                  data: data ?? '0x00',
                  to: to,
                  type: 'eip1559',
                  value: amount,
                }),
              ),
        ]);

        const gasUnitPrice = maxFeePerGas ?? gasPrice ?? 0n;
        if (gasUnitPrice === 0n) {
          throw new Error('could not get maxFeePerGas or gasPrice from RPC');
        }

        gasFee = this.simulateTxRes.gas * gasUnitPrice + l1Fee;
      }

      return {
        ...this.simulateTxRes,
        gasFee: divDecimals(gasFee, nativeToken.decimals),
      };
    }

    const txsToSimulate: SimulationRequest[] = [
      {
        from: ZERO_ADDRESS,
        input: data ?? '0x00',
        to,
        value: (value as `0x${string}`) ?? '0x00',
      },
    ];

    const [simulation, feeData, l1Fee] = await Promise.all([
      simulateTransaction(
        this.input.chain.id,
        txsToSimulate,
        this.input.options.networkConfig.SIMULATION_URL,
      ),
      this.publicClient.estimateFeesPerGas(),
      getL1Fee(
        this.input.chain,
        serializeTransaction({
          chainId: this.input.chain.id,
          data: data ?? '0x00',
          to: to,
          type: 'eip1559',
          value: hexToBigInt((value as `0x${string}`) ?? '0x00'),
        }),
      ),
    ]);

    const gasUnitPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    if (gasUnitPrice === 0n) {
      throw new Error('could not get maxFeePerGas or gasPrice from RPC');
    }

    let gasFee = BigInt(simulation.data.gas_used) * gasUnitPrice + l1Fee;

    logger.debug('native:simulateTx', {
      feeData,
      l1Fee,
      maxFeePerGas: gasUnitPrice,
      simulation,
      totalGas: gasFee,
      totalGasInDecimal: divDecimals(gasFee, nativeToken.decimals),
    });

    this.simulateTxRes = {
      amount: amountInDecimal,
      gas: BigInt(simulation.data.gas_used),
      gasFee: divDecimals(gasFee, nativeToken.decimals),
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
    waitForDoubleCheckTx();
    try {
      await evmWaitForFill(
        this.input.chainList.getVaultContractAddress(this.input.chain.id),
        this.publicClient,
        requestHash,
        intentID,
        this.input.options.networkConfig.GRPC_URL,
        this.input.options.networkConfig.COSMOS_URL,
      );
    } finally {
      (await this.publicClient.transport.getRpcClient()).close();
    }
  }
}

export default NativeTransfer;
