import { Universe } from '@arcana/ca-common';
import Decimal from 'decimal.js';
import Long from 'long';
import {
  createPublicClient,
  decodeFunctionData,
  Hex,
  PublicClient,
  serializeTransaction,
  toHex,
  webSocket,
  WebSocketTransport,
} from 'viem';

import { utils, Types } from 'tronweb';

import type { RequestHandlerInput, SimulateReturnType } from '@nexus/commons';

import { ERC20TransferABI } from '../../abi/erc20';
import { KAIA_CHAIN_ID, SOPHON_CHAIN_ID } from '../../chains';
import {
  AaveTokenContracts,
  HYPEREVM_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  TOKEN_MINTER_CONTRACTS,
  TOP_OWNER,
} from '../../constants';
import { getLogger } from '../../logger';
import { simulateTransaction, SimulationRequest } from '../../simulate';
import { divDecimals, evmWaitForFill, getL1Fee, UserAssets } from '../../utils';
import RequestBase from '../common/base';
import { tokenRequestParseSimulation } from '../common/utils';

const logger = getLogger();

class TRC20Transfer extends RequestBase {
  destinationUniverse = Universe.ETHEREUM;
  publicClient: PublicClient<WebSocketTransport>;
  simulateTxRes?: SimulateReturnType;

  constructor(readonly input: RequestHandlerInput) {
    super(input);
    this.publicClient = createPublicClient({
      transport: webSocket(this.input.chain.rpcUrls.default.webSocket[0]),
    });
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
    const from = this.input.evm.address;
    const tokenHexAddr: Hex = `0x${utils.address.toHex(tx.raw_data.contract[0].parameter.value.contract_address)}`;
    const token = this.chainList.getTokenByAddress(this.input.chain.id, tokenHexAddr);
    const nativeToken = this.chainList.getNativeToken(this.input.chain.id);
    if (!token) {
      return;
    }

    const tokenAmount = tx.raw_data.contract[0].parameter.value.call_token_value!;

    if ([HYPEREVM_CHAIN_ID, KAIA_CHAIN_ID, MONAD_TESTNET_CHAIN_ID].includes(this.input.chain.id)) {
      this.simulateTxRes = {
        amount: divDecimals(tokenAmount, token.decimals),
        gas: 100_000n,
        gasFee: new Decimal(0),
        token,
      };
    }

    if (this.simulateTxRes) {
      let gasFee = 0n;
      if (!this.input.options.bridge) {
        const [{ gasPrice, maxFeePerGas }, l1Fee] = await Promise.all([
          this.publicClient.estimateFeesPerGas(),
          getL1Fee(
            this.input.chain,
            serializeTransaction({
              chainId: this.input.chain.id,
              data: data ?? '0x00',
              to: to,
              type: 'eip1559',
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

    const amountToAdd = new Decimal(args[1].toString())
      .toHexadecimal()
      .split('0x')[1]
      .padStart(40, '0');

    let txsToSimulate: SimulationRequest[] = [];
    if (AaveTokenContracts[this.input.chain.id]?.[token.symbol]) {
      txsToSimulate.push({
        from: AaveTokenContracts[this.input.chain.id][token.symbol],
        input: `0xa9059cbb000000000000000000000000${from
          .replace('0x', '')
          .toLowerCase()}000000000000000000000000${amountToAdd}`,
        to: token.contractAddress,
      });
    } else if (TOKEN_MINTER_CONTRACTS[this.input.chain.id]?.[token.symbol]) {
      txsToSimulate.push({
        from: TOKEN_MINTER_CONTRACTS[this.input.chain.id]?.[token.symbol],
        input: `0x40c10f19000000000000000000000000${from
          .replace('0x', '')
          .toLowerCase()}000000000000000000000000000000000000000000000000000000003b9aca00`,
        to: token.contractAddress,
      });
    }
    txsToSimulate.push({
      from,
      input: data,
      to,
    });

    if (TOP_OWNER[this.input.chain.id]?.[token.symbol]) {
      const ownerAddress = TOP_OWNER[this.input.chain.id][token.symbol];
      txsToSimulate = [
        {
          from: ownerAddress,
          input: data as `0x${string}`,
          to,
        },
      ];
    }

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
        }),
      ),
    ]);

    logger.debug('simulateTx', { feeData });

    const gasUnitPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    if (gasUnitPrice === 0n) {
      throw new Error('could not get maxFeePerGas or gasPrice from RPC');
    }

    let gasFee =
      (this.input.chain.id === SOPHON_CHAIN_ID
        ? BigInt(simulation.data.gas)
        : BigInt(simulation.data.gas_used)) *
        gasUnitPrice +
      l1Fee;

    logger.debug('erc20:simulateTx', {
      args,
      feeData,
      l1Fee,
      maxFeePerGas: gasUnitPrice,
      simulation,
      totalGas: gasFee,
      totalGasInDecimal: divDecimals(gasFee, nativeToken.decimals).toFixed(),
    });

    if (this.input.options.bridge) {
      gasFee = 0n;
    }

    const amount = simulation.data.amount === '' ? args[1].toString() : simulation.data.amount;

    this.simulateTxRes = {
      amount: divDecimals(amount, token.decimals),
      gas:
        this.input.chain.id === SOPHON_CHAIN_ID
          ? BigInt(simulation.data.gas)
          : BigInt(simulation.data.gas_used),
      gasFee: divDecimals(gasFee, nativeToken.decimals),
      token,
    };
    return this.simulateTxRes;
  }

  async waitForFill(
    requestHash: `0x${string}`,
    intentID: Long,
    waitForDoubleCheckTx: () => Promise<void>,
  ) {
    logger.debug('waitForFill', {
      intentID,
      requestHash,
      waitForDoubleCheckTx,
    });
    try {
      await Promise.all([
        waitForDoubleCheckTx(),
        evmWaitForFill(
          this.input.chainList.getVaultContractAddress(this.input.chain.id),
          this.publicClient,
          requestHash,
          intentID,
          this.input.options.networkConfig.GRPC_URL,
          this.input.options.networkConfig.COSMOS_URL,
        ),
      ]);
    } finally {
      (await this.publicClient.transport.getRpcClient()).close();
    }
  }
}

export default TRC20Transfer;
