import { Universe } from '@avail-project/ca-common';
import { createPublicClient, type Hex, http, type PublicClient, type WalletClient } from 'viem';
import {
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
  type SwapParams,
  type Tx,
  type UserAssetDatum,
} from '../commons';
import { isNativeAddress } from '../core/constants';
import { Errors } from '../core/errors';
import { convertTo32BytesHex, equalFold, erc20GetAllowance, mulDecimals } from '../core/utils';
import { type ExecuteFeeParams, sendExecuteTransactions } from '../services/executeTransactions';
import { estimateFeeContext, finalizeFeeEstimates } from '../services/feeEstimation';
import { EADDRESS } from '../swap/constants';
import type { FlatBalance } from '../swap/data';
import { getTokenInfo, packERC20Approve } from '../swap/utils';

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
      options?: OnEventParam,
      preloadedBalances?: SwapParams['preloadedBalances']
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

    const approvalGasPromise = approvalTx
      ? dstPublicClient
          .estimateGas({
            to: approvalTx.to,
            data: approvalTx.data,
            value: approvalTx.value,
            account: address,
          })
          .catch(() => 70_000n)
      : Promise.resolve(0n);

    const feeContextPromise = estimateFeeContext(
      dstPublicClient,
      toChainId,
      [
        ...(approvalTx
          ? [
              {
                tx: {
                  to: approvalTx.to,
                  data: approvalTx.data,
                  value: approvalTx.value,
                },
                gasEstimateKind: 'final' as const,
              },
            ]
          : []),
        {
          tx: {
            to: tx.to,
            data: tx.data,
            value: tx.value,
          },
        },
      ],
      params.execute.gasPrice ?? 'medium'
    );

    const [approvalGas, balances, dstTokenInfo, feeContext] = await Promise.all([
      approvalGasPromise,
      this.getBalancesForSwap(),
      getTokenInfo(params.toTokenAddress, dstPublicClient, dstChain),
      feeContextPromise,
    ]);
    const fees = finalizeFeeEstimates(
      [
        ...(approvalTx
          ? [
              {
                tx: {
                  to: approvalTx.to,
                  data: approvalTx.data,
                  value: approvalTx.value,
                },
                gasEstimate: approvalGas,
                gasEstimateKind: 'final' as const,
              },
            ]
          : []),
        {
          tx: {
            to: tx.to,
            data: tx.data,
            value: tx.value,
          },
          gasEstimate: params.execute.gas,
        },
      ],
      feeContext
    );
    const approvalFee = approvalTx ? fees[0] : null;
    const txFee = fees[approvalTx ? 1 : 0];

    if (!txFee || txFee.recommended.maxFeePerGas === 0n) {
      throw Errors.gasPriceError({
        chainId: toChainId,
      });
    }

    if (approvalTx && approvalFee) {
      approvalTx.gas = approvalFee.recommended.gasLimit;
    }

    tx.gas = txFee.recommended.gasLimit;

    const gasPrice = txFee.recommended.maxFeePerGas;
    const l1Fee = fees.reduce((sum, fee) => sum + fee.l1Fee, 0n);
    const gasFee = fees.reduce((sum, fee) => sum + fee.recommended.totalMaxCost, 0n);

    logger.debug('SwapAndExecute:3', {
      fees,
      gasPrice,
      balances,
      l1Fee,
      gasFee,
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
        tx: txFee.recommended.gasLimit,
        approval: approvalFee?.recommended.gasLimit ?? 0n,
      },
      feeParams: txFee.recommended.useLegacyPricing
        ? ({
            type: 'legacy',
            gasPrice: txFee.recommended.maxFeePerGas,
          } satisfies ExecuteFeeParams)
        : ({
            type: 'eip1559',
            maxFeePerGas: txFee.recommended.maxFeePerGas,
            maxPriorityFeePerGas: txFee.recommended.maxPriorityFeePerGas,
          } satisfies ExecuteFeeParams),
      dstTokenInfo,
      address,
      gasFee,
      gasPrice,
      balances,
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
      feeParams,
      gasPrice,
      dstTokenInfo,
      gasFee,
      balances,
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
          // Positive: shortfall to source. Negative: reserve abs(value) from native balance.
          // -1n: exactly enough gas — remove native from sources entirely.
          toNativeAmount: amount.gas === 0n ? -1n : amount.gas,
          toChainId: params.toChainId,
        },
        options,
        balances.balances
      );

      logger.debug('swapResult:SwapAndExecute()', { swapResult });
    }

    const executeResponse = await this.sendTx(
      {
        approvalTx,
        tx,
        feeParams,
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

        if (destinationGasAmount < requiredGasAmount) {
          // Case 1: need more gas — positive shortfall
          gasAmount = requiredGasAmount - destinationGasAmount;
        } else if (destinationGasAmount > requiredGasAmount) {
          // Case 2: surplus gas — negative required amount signals "reserve this, use the rest"
          gasAmount = -requiredGasAmount;
        } else {
          // Case 3: exactly enough — 0n, caller converts to -1n sentinel
          gasAmount = 0n;
        }
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
      feeParams?: ExecuteFeeParams;
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
    return sendExecuteTransactions(params, options);
  }
}

export { SwapAndExecuteQuery };
