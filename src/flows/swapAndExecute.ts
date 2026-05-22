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
import { getTokenInfo, packERC20Approve, validateDestinationChainForSwap } from '../swap/utils';

class SwapAndExecuteQuery {
  constructor(
    private chainList: ChainListType,
    private evmClient: WalletClient,
    // EOA address resolved up-front by the caller (via `withReinit`, which already syncs
    // `_evm.address` from the wallet). Avoids re-issuing `getAddresses()` on every entry
    // point — wallet RPCs can add 50–200ms each and the value can't have changed in this
    // window (`withReinit` already aborted/reinit'd on account change).
    private address: Hex,
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

    validateDestinationChainForSwap(this.chainList, toChainId);

    const address = this.address;

    // `createTxsForExecute` is now sync — it builds a *speculative* approvalTx
    // unconditionally (when params.tokenApproval is set) and surfaces the allowance-check
    // params separately. The actual allowance read is run in parallel with everything else
    // below, so it no longer blocks the parallel batch.
    const { tx, speculativeApprovalTx, dstChain, dstPublicClient, allowanceCheck } =
      this.createTxsForExecute(execute, toChainId);

    logger.debug('SwapAndExecute:2', {
      tx,
      dstPublicClient,
      speculativeApprovalTx,
    });

    // Speculative: every parallel arm assumes the approval *might* be needed.
    // - approvalGasPromise: estimateGas for the speculative approvalTx. Wasted if allowance
    //   turns out to be sufficient, but the call runs in parallel either way.
    // - feeContextPromise: includes the speculative approval in its items list. If approval
    //   isn't actually needed, we trim `feeContext.overheads[0]` after Promise.all.
    // - allowancePromise: the deciding read.
    const allowancePromise = allowanceCheck
      ? erc20GetAllowance(
          {
            contractAddress: allowanceCheck.token,
            spender: allowanceCheck.spender,
            owner: address,
          },
          dstPublicClient
        )
      : Promise.resolve(null);

    const approvalGasPromise = speculativeApprovalTx
      ? dstPublicClient
          .estimateGas({
            to: speculativeApprovalTx.to,
            data: speculativeApprovalTx.data,
            value: speculativeApprovalTx.value,
            account: address,
          })
          .catch(() => 70_000n)
      : Promise.resolve(0n);

    const feeContextItems = [
      ...(speculativeApprovalTx
        ? [
            {
              tx: {
                to: speculativeApprovalTx.to,
                data: speculativeApprovalTx.data,
                value: speculativeApprovalTx.value,
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
    ];
    const feeContextPromise = estimateFeeContext(
      dstPublicClient,
      toChainId,
      feeContextItems,
      params.execute.gasPrice ?? 'medium'
    );

    const [currentAllowance, approvalGas, balances, dstTokenInfo, feeContext] = await Promise.all([
      allowancePromise,
      approvalGasPromise,
      this.getBalancesForSwap(),
      getTokenInfo(params.toTokenAddress, dstPublicClient, dstChain),
      feeContextPromise,
    ]);

    // Decide whether approval is actually required now that we have the on-chain allowance.
    const approvalTx: Tx | null =
      allowanceCheck &&
      currentAllowance !== null &&
      currentAllowance < allowanceCheck.requiredAllowance
        ? speculativeApprovalTx
        : null;

    // If we built feeContext with a speculative approval but the real allowance covers it,
    // drop the leading overhead so `overheads` aligns with the real items list (one entry).
    const effectiveFeeContext =
      speculativeApprovalTx && !approvalTx
        ? { ...feeContext, overheads: feeContext.overheads.slice(1) }
        : feeContext;

    const txs: Tx[] = [];
    if (approvalTx) {
      txs.push(approvalTx);
    }
    txs.push(tx);

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
      effectiveFeeContext
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
    const { skipSwap, tokenAmount, gasAmount } = this.calculateOptimalSwapAmount(
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

  // Sync — does no I/O. The allowance read used to live here, gating every parallel
  // step downstream; the caller now runs it in parallel with balances / tokenInfo /
  // feeContext via `allowanceCheck`. We always build the speculative approvalTx when
  // `params.tokenApproval` is set so callers can both speculate (estimate gas, fold into
  // feeContext) in parallel with the allowance check itself.
  private createTxsForExecute(
    params: SwapExecuteParams,
    chainId: number
  ): {
    tx: Tx;
    speculativeApprovalTx: Tx | null;
    dstChain: Chain;
    dstPublicClient: PublicClient;
    allowanceCheck: { token: Hex; spender: Hex; requiredAllowance: bigint } | null;
  } {
    const dstChain = this.chainList.getChainByID(chainId);
    if (!dstChain) {
      throw Errors.chainNotFound(chainId);
    }

    const dstPublicClient = createPublicClient({
      transport: http(dstChain.rpcUrls.default.http[0]),
    });

    let speculativeApprovalTx: Tx | null = null;
    let allowanceCheck: { token: Hex; spender: Hex; requiredAllowance: bigint } | null = null;
    if (params.tokenApproval) {
      const requiredAllowance = BigInt(params.tokenApproval.amount);
      speculativeApprovalTx = {
        to: params.tokenApproval.token,
        data: packERC20Approve(params.tokenApproval.spender, requiredAllowance),
        value: 0n,
      };
      allowanceCheck = {
        token: params.tokenApproval.token,
        spender: params.tokenApproval.spender,
        requiredAllowance,
      };
    }

    const tx: Tx = {
      to: params.to,
      value: params.value ?? 0n,
      data: params.data ?? '0x',
    };

    return { tx, speculativeApprovalTx, dstChain, dstPublicClient, allowanceCheck };
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
          // Same sentinel shape for both: >0n shortfall, <-1n surplus (reserve abs(value)),
          // -1n exactly enough — remove the token/native from dst-chain sources.
          toAmount: amount.token === 0n ? -1n : amount.token,
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
  private calculateOptimalSwapAmount(
    toChainId: number,
    tokenAddress: Hex,
    tokenDecimals: number,
    requiredTokenAmount: bigint,
    requiredGasAmount: bigint,
    balances: FlatBalance[]
  ): { skipSwap: boolean; tokenAmount: bigint; gasAmount: bigint } {
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

        // 3-case sentinel (same shape for token and gas):
        //   shortfall  -> positive (req - dst)
        //   surplus    -> -required (reserve this, use the rest as source)
        //   exact      -> 0n (caller converts to -1n sentinel)
        if (destinationTokenAmount < requiredTokenAmount) {
          tokenAmount = requiredTokenAmount - destinationTokenAmount;
        } else if (destinationTokenAmount > requiredTokenAmount) {
          tokenAmount = -requiredTokenAmount;
        } else {
          tokenAmount = 0n;
        }

        if (destinationGasAmount < requiredGasAmount) {
          gasAmount = requiredGasAmount - destinationGasAmount;
        } else if (destinationGasAmount > requiredGasAmount) {
          gasAmount = -requiredGasAmount;
        } else {
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
