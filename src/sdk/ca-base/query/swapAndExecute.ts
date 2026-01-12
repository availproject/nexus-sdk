import { Universe } from '@avail-project/ca-common';
import {
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
  serializeTransaction,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import {
  BRIDGE_STEPS,
  type Chain,
  type ChainListType,
  type ExactOutSwapInput,
  logger,
  NEXUS_EVENTS,
  type OnEventParam,
  type SuccessfulSwapResult,
  SWAP_STEPS,
  type SwapAndExecuteParams,
  type SwapAndExecuteResult,
  type SwapExecuteParams,
  type Tx,
  type UserAssetDatum,
} from '../../../commons';
import { isNativeAddress } from '../constants';
import { Errors } from '../errors';
import { EADDRESS } from '../swap/constants';
import type { FlatBalance } from '../swap/data';
import { getTokenInfo, packERC20Approve } from '../swap/utils';
import {
  convertTo32BytesHex,
  equalFold,
  erc20GetAllowance,
  getL1Fee,
  // divideBigInt,
  getPctGasBufferByChain,
  mulDecimals,
  pctAdditionToBigInt,
  switchChain,
  waitForTxReceipt,
} from '../utils';
import { getGasPriceRecommendations } from './gasFeeHistory';

class SwapAndExecuteQuery {
  constructor(
    private chainList: ChainListType,
    private evmClient: WalletClient,
    private getBalancesForSwap: () => Promise<{
      assets: UserAssetDatum[];
      balances: FlatBalance[];
    }>,
    private swap: (
      input: ExactOutSwapInput,
      options?: OnEventParam
    ) => Promise<SuccessfulSwapResult>
  ) {}

  private async estimateSwapAndExecute(params: SwapAndExecuteParams) {
    const { toChainId, toAmount, execute } = params;

    const address = (await this.evmClient.getAddresses())[0];
    const txs: Tx[] = [];

    const { tx, approvalTx, dstChain, dstPublicClient } = await this.createTxsForExecute(
      execute,
      toChainId,
      address
    );

    logger.debug('SwapAndExecute:2', {
      tx,
      dstPublicClient,
      approvalTx,
    });

    if (approvalTx) {
      txs.push(approvalTx);
    }

    txs.push(tx);

    const determineGasUsed = Promise.resolve({
      approvalGas: approvalTx ? 70_000n : 0n,
      txGas: params.execute.gas,
    });

    // 5. simulate approval(?) and execution + fetch gasPrice + fetch unified balance
    const [gasUsed, gasPriceRecommendations, balances, dstTokenInfo, l1Fee] = await Promise.all([
      determineGasUsed,
      getGasPriceRecommendations(dstPublicClient),
      this.getBalancesForSwap(),
      getTokenInfo(params.toTokenAddress, dstPublicClient, dstChain),
      getL1Fee(
        execute.to,
        dstChain,
        serializeTransaction({
          chainId: dstChain.id,
          data: execute.data ?? '0x',
          value: execute.value,
          to: execute.to,
          type: 'eip1559',
        })
      ),
    ]);

    const pctBuffer = getPctGasBufferByChain(toChainId);
    const [suggestedApprovalGas, approvalGas] = pctAdditionToBigInt(gasUsed.approvalGas, pctBuffer);
    const [suggestedTxGas, txGas] = pctAdditionToBigInt(gasUsed.txGas, pctBuffer);

    const gasPrice = gasPriceRecommendations[params.execute.gasPrice ?? 'high'];
    if (gasPrice === 0n) {
      throw Errors.gasPriceError({
        chainId: toChainId,
      });
    }

    if (approvalTx) {
      approvalTx.gas = suggestedApprovalGas;
    }

    tx.gas = suggestedTxGas;

    const gasFee = (approvalGas + txGas) * gasPrice + l1Fee;

    logger.debug('SwapAndExecute:3', {
      increasedGas: approvalGas + txGas,
      approvalGas,
      txGas,
      gasPriceRecommendations,
      gasPrice,
      balances,
    });

    // 6. Determine gas or token needed via bridge
    const { skipSwap, tokenAmount, gasAmount } = await this.calculateOptimalSwapAmount(
      toChainId,
      dstTokenInfo.contractAddress,
      dstTokenInfo.decimals,
      toAmount,
      gasFee,
      balances.balances
    );

    return {
      dstPublicClient,
      dstChain,
      amount: {
        token: tokenAmount,
        gas: gasAmount,
      },
      skipSwap,
      tx,
      approvalTx,
      gas: {
        tx: txGas,
        approval: approvalGas,
      },
      dstTokenInfo,
      address,
      gasFee,
      gasPrice,
    };
  }

  private async createTxsForExecute(params: SwapExecuteParams, chainId: number, address: Hex) {
    // 1. Check if dst chain data is available
    const dstChain = this.chainList.getChainByID(chainId);
    if (!dstChain) {
      throw Errors.chainNotFound(chainId);
    }

    const dstPublicClient = createPublicClient({
      transport: http(dstChain.rpcUrls.default.http[0]),
    });

    // 2. Check if token is supported
    let approvalTx: Tx | null = null;
    if (params.tokenApproval) {
      const spender = params.tokenApproval.spender;
      const currentAllowance = await erc20GetAllowance(
        {
          contractAddress: params.tokenApproval.token,
          spender: params.tokenApproval.spender,
          owner: address,
        },
        dstPublicClient
      );

      const requiredAllowance = BigInt(params.tokenApproval.amount);

      logger.debug('SwapAndExecute:createTxsForExecute', {
        requiredAllowance,
        currentAllowance,
        skipApproval: currentAllowance > requiredAllowance,
      });
      if (currentAllowance < requiredAllowance) {
        approvalTx = {
          to: params.tokenApproval.token,
          data: packERC20Approve(spender, requiredAllowance),
          value: 0n,
        };
      }
    }

    // 4. Encode execute tx
    const tx: Tx = {
      to: params.to,
      value: params.value ?? 0n,
      data: params.data ?? '0x',
    };

    return { tx, approvalTx, dstChain, dstPublicClient };
  }

  public async swapAndExecute(
    params: SwapAndExecuteParams,
    options?: OnEventParam
  ): Promise<SwapAndExecuteResult> {
    const {
      dstPublicClient,
      dstChain,
      address,
      skipSwap,
      tx,
      approvalTx,
      amount,
      gas,
      gasPrice,
      dstTokenInfo,
      gasFee,
    } = await this.estimateSwapAndExecute(params);

    logger.debug('BridgeAndExecute:4:CalculateOptimalSwapAmount', {
      params,
      skipSwap,
      fromSources: params.fromSources,
      amount,
      approval: {
        tx: approvalTx,
        gas: gas.approval,
      },
      tx: {
        tx,
        gas: gas.tx,
      },
      gasPrice,
    });

    if (approvalTx) {
      approvalTx.gas = gas.approval;
    }

    tx.gas = gas.tx;

    let swapResult: SuccessfulSwapResult | null = null;

    if (skipSwap) {
      // Emit SWAP_SKIPPED event with full data
      if (options?.onEvent) {
        options.onEvent({
          name: NEXUS_EVENTS.SWAP_STEP_COMPLETE,
          args: SWAP_STEPS.SWAP_SKIPPED({
            destination: {
              amount: params.toAmount.toString(),
              chain: { id: dstChain.id, name: dstChain.name },
              token: {
                contractAddress: params.toTokenAddress,
                decimals: dstTokenInfo.decimals,
                symbol: dstTokenInfo.symbol,
              },
            },
            input: {
              amount: params.toAmount.toString(),
              token: {
                contractAddress: params.toTokenAddress,
                decimals: dstTokenInfo.decimals,
                symbol: dstTokenInfo.symbol,
              },
            },
            gas: {
              required: (gas.tx + gas.approval).toString(),
              price: gasPrice.toString(),
              estimatedFee: gasFee.toString(),
            },
          }),
        });
      }
    } else {
      swapResult = await this.swap(
        {
          fromSources: params.fromSources,
          toTokenAddress: params.toTokenAddress,
          toAmount: amount.token,
          // -1n signifies the source list to not list native balance
          toNativeAmount: amount.gas === 0n ? -1n : amount.gas,
          toChainId: params.toChainId,
        },
        options
      );

      logger.debug('swapResult:SwapAndExecute()', { swapResult });
    }

    const executeResponse = await this.sendTx(
      {
        approvalTx,
        tx,
        gasPrice,
      },
      {
        emit: options?.onEvent,
        chain: dstChain,
        dstPublicClient,
        address,
        client: this.evmClient,
      }
    );

    logger.debug('swapResult:executeResponse()', { executeResponse });

    const result: SwapAndExecuteResult = {
      swapResult,
      swapSkipped: skipSwap,
      executeResponse,
    };

    logger.debug('swapResult:full result', { result });

    return result;
  }

  /**
   * Calculate optimal bridge amount based on destination chain balance
   * Returns the exact amount needed to bridge, or indicates if bridge can be skipped entirely
   */
  private async calculateOptimalSwapAmount(
    toChainId: number,
    tokenAddress: Hex,
    tokenDecimals: number,
    requiredTokenAmount: bigint,
    requiredGasAmount: bigint,
    balances: FlatBalance[]
  ): Promise<{ skipSwap: boolean; tokenAmount: bigint; gasAmount: bigint }> {
    let skipSwap = true;
    let tokenAmount = requiredTokenAmount;
    let gasAmount = requiredGasAmount;

    let destinationTokenAmount = 0n;
    const tokenBalance = balances.find(
      (b) => b.chainID === toChainId && equalFold(b.tokenAddress, convertTo32BytesHex(tokenAddress))
    );
    if (tokenBalance) {
      destinationTokenAmount = mulDecimals(tokenBalance.amount, tokenDecimals);
    }

    let destinationGasAmount = 0n;
    const gasBalance = balances.find(
      (b) => b.chainID === toChainId && equalFold(b.tokenAddress, convertTo32BytesHex(EADDRESS))
    );
    if (gasBalance) {
      destinationGasAmount = mulDecimals(gasBalance.amount, gasBalance.decimals);
    }

    logger.debug('calculateOptimalBridgeAmount', {
      destinationTokenAmount,
      requiredTokenAmount,
      destinationGasAmount,
      requiredGasAmount,
    });
    if (isNativeAddress(Universe.ETHEREUM, tokenAddress)) {
      const totalRequired = requiredGasAmount + requiredTokenAmount;
      if (destinationGasAmount < totalRequired) {
        skipSwap = false;
        // Total missing native amount
        const difference = totalRequired - destinationGasAmount;

        // First cover missing TOKEN
        const missingToken =
          requiredTokenAmount > destinationTokenAmount
            ? requiredTokenAmount - destinationTokenAmount
            : 0n;

        // Then cover missing GAS out of the remaining deficit
        const gasPart = difference > missingToken ? difference - missingToken : 0n;

        tokenAmount = missingToken;
        gasAmount = gasPart;
      }
    } else {
      const isGasBridgeRequired = destinationGasAmount < requiredGasAmount;
      const isTokenBridgeRequired = destinationTokenAmount < requiredTokenAmount;

      if (isGasBridgeRequired || isTokenBridgeRequired) {
        skipSwap = false;

        tokenAmount =
          destinationTokenAmount < requiredTokenAmount
            ? requiredTokenAmount - destinationTokenAmount
            : 0n;

        gasAmount =
          destinationGasAmount < requiredGasAmount ? requiredGasAmount - destinationGasAmount : 0n;
      }
    }
    return {
      skipSwap,
      tokenAmount,
      gasAmount,
    };
  }

  private async sendTx(
    params: {
      tx: Tx;
      approvalTx: Tx | null;
      gasPrice?: bigint;
    },
    options: {
      emit?: OnEventParam['onEvent'];
      chain: Chain;
      dstPublicClient: PublicClient;
      address: Hex;
      client: WalletClient;
      waitForReceipt?: boolean;
      receiptTimeout?: number;
      requiredConfirmations?: number;
    }
  ) {
    const { waitForReceipt = true, receiptTimeout = 300000, requiredConfirmations = 1 } = options;
    await switchChain(options.client, options.chain);

    let approvalHash: Hex | undefined;
    if (params.approvalTx) {
      approvalHash = await options.client.sendTransaction({
        ...params.approvalTx,
        account: options.address,
        chain: options.chain,
      });

      await waitForTxReceipt(approvalHash, options.dstPublicClient, 1);
      if (options.emit) {
        options.emit({
          name: NEXUS_EVENTS.STEP_COMPLETE,
          args: BRIDGE_STEPS.EXECUTE_APPROVAL_STEP,
        });
      }
    }

    const txHash = await options.client.sendTransaction({
      ...params.tx,
      account: options.address,
      chain: options.chain,
    });

    if (options.emit) {
      options.emit({
        name: NEXUS_EVENTS.STEP_COMPLETE,
        args: BRIDGE_STEPS.EXECUTE_TRANSACTION_SENT,
      });
    }

    let receipt: TransactionReceipt | undefined;
    if (waitForReceipt) {
      receipt = await waitForTxReceipt(
        txHash,
        options.dstPublicClient,
        requiredConfirmations,
        receiptTimeout
      );

      if (options.emit) {
        options.emit({
          name: NEXUS_EVENTS.STEP_COMPLETE,
          args: BRIDGE_STEPS.EXECUTE_TRANSACTION_CONFIRMED,
        });
      }
    }

    return {
      txHash,
      receipt,
      approvalHash,
    };
  }
}

export { SwapAndExecuteQuery };
