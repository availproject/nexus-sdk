import { Universe } from '@avail-project/ca-common';
import {
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
  serializeTransaction,
  type TransactionReceipt,
  toHex,
  type WalletClient,
} from 'viem';
import {
  type BeforeExecuteHook,
  BRIDGE_STEPS,
  type BridgeAndExecuteParams,
  type BridgeAndExecuteResult,
  type BridgeAndExecuteSimulationResult,
  type BridgeParams,
  type BridgeResult,
  type BridgeStepType,
  type Chain,
  type ChainListType,
  type ExecuteParams,
  type ExecuteResult,
  type ExecuteSimulation,
  logger,
  NEXUS_EVENTS,
  type OnEventParam,
  type ReadableIntent,
  type TokenInfo,
  type Tx,
  type UserAssetDatum,
} from '../../../commons';
import type { BackendSimulationClient } from '../../../integrations/tenderly';
import { isNativeAddress } from '../constants';
import { Errors } from '../errors';
import type BridgeHandler from '../requestHandlers/bridge';
import { packERC20Approve } from '../swap/utils';
import {
  createExplorerTxURL,
  erc20GetAllowance,
  generateStateOverride,
  getL1Fee,
  getPctGasBufferByChain,
  mulDecimals,
  pctAdditionWithSuggestion,
  switchChain,
  UserAssets,
  waitForTxReceipt,
} from '../utils';
import { getGasPriceRecommendations } from './gasFeeHistory';

class BridgeAndExecuteQuery {
  constructor(
    private chainList: ChainListType,
    private evmClient: WalletClient,
    private bridge: (input: BridgeParams, options?: OnEventParam) => Promise<BridgeHandler>,
    private getUnifiedBalances: () => Promise<UserAssetDatum[]>,
    private simulationClient: BackendSimulationClient
  ) {}

  private async estimateBridgeAndExecute(params: BridgeAndExecuteParams) {
    const { toChainId, token: tokenSymbol, amount, execute } = params;

    const { token, chain: dstChain } = this.chainList.getChainAndTokenFromSymbol(
      params.toChainId,
      tokenSymbol
    );
    if (!token) {
      throw Errors.tokenNotFound(tokenSymbol, toChainId);
    }

    const address = (await this.evmClient.getAddresses())[0];
    const txs: Tx[] = [];

    const { tx, approvalTx, dstPublicClient } = await this.createTxsForExecute(
      { ...execute, toChainId: params.toChainId },
      address
    );

    logger.debug('BridgeAndExecute:2', {
      tx,
      dstChain,
      dstPublicClient,
      approvalTx,
    });

    if (approvalTx) {
      txs.push(approvalTx);
    }

    txs.push(tx);

    const determineGasUsed = params.execute.gas
      ? Promise.resolve({ approvalGas: approvalTx ? 70_000n : 0n, txGas: params.execute.gas })
      : this.simulateBundle({
          txs,
          amount: params.amount,
          userAddress: address,
          chainId: dstChain.id,
          tokenAddress: token.contractAddress,
          tokenSymbol: params.token ?? 'ETH',
        }).then(({ gas }) => {
          if (approvalTx) {
            return {
              approvalGas: gas[0],
              txGas: gas[1],
            };
          } else {
            return {
              approvalGas: 0n,
              txGas: gas[0],
            };
          }
        });

    // 5. simulate approval(?) and execution + fetch gasPrice + fetch unified balance
    const [gasUsed, gasPriceRecommendations, balances, l1Fee] = await Promise.all([
      determineGasUsed,
      getGasPriceRecommendations(dstPublicClient),
      this.getUnifiedBalances(),
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

    const pctBuffer = getPctGasBufferByChain(dstChain.id);

    // We ask for more, but suggest lesser than that
    const [suggestedApprovalGas, approvalGas] = pctAdditionWithSuggestion(
      gasUsed.approvalGas,
      pctBuffer
    );
    const [suggestedTxGas, txGas] = pctAdditionWithSuggestion(gasUsed.txGas, pctBuffer);

    const gasPrice = gasPriceRecommendations[params.execute.gasPrice ?? 'medium'];

    if (gasPrice === 0n) {
      throw Errors.gasPriceError({
        chainId: dstChain.id,
      });
    }

    if (approvalTx) {
      approvalTx.gas = suggestedApprovalGas;
    }

    tx.gas = suggestedTxGas;

    const gasFee = (approvalGas + txGas) * gasPrice + l1Fee;

    logger.debug('BridgeAndExecute:3', {
      increasedGas: approvalGas + txGas,
      approvalGas,
      txGas,
      gasPriceRecommendations,
      gasPrice,
      balances,
      l1Fee,
    });

    // 6. Determine gas or token needed via bridge
    const { skipBridge, tokenAmount, gasAmount } = await this.calculateOptimalBridgeAmount(
      dstChain,
      token.contractAddress,
      token.decimals,
      amount,
      gasFee,
      balances
    );

    return {
      dstPublicClient,
      dstChain,
      amount: {
        token: tokenAmount,
        gas: gasAmount,
      },
      skipBridge,
      tx,
      approvalTx,
      gas: {
        tx: txGas,
        approval: approvalGas,
      },
      token,
      address,
      gasFee,
      gasPrice,
    };
  }

  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams
  ): Promise<BridgeAndExecuteSimulationResult> {
    const { gasFee, token, skipBridge, amount, gas, gasPrice } =
      await this.estimateBridgeAndExecute(params);

    logger.debug('BridgeAndExecute:4:CalculateOptimalBridgeAmount', {
      skipBridge,
      amount,
      gas,
    });

    let bridgeResult: null | {
      intent: ReadableIntent;
      token: TokenInfo;
    } = null;

    // 7. If bridge is required then simulate bridge
    if (!skipBridge) {
      bridgeResult = await this.simulateBridgeWrapper({
        token: token.symbol,
        amount: amount.token,
        toChainId: params.toChainId,
        sourceChains: params.sourceChains,
        gas: amount.gas,
      });
    }

    // 8. Return result
    const result: BridgeAndExecuteSimulationResult = {
      bridgeSimulation: bridgeResult,
      executeSimulation: {
        gasUsed: gas.approval + gas.tx,
        gasPrice,
        gasFee,
      },
    };

    return result;
  }

  /**
   * Bridge and execute operation - combines bridge and execute with proper sequencing
   * Checks balance and gas present on destination chain & bridges (required - available) token + gas.
   * Simulates using tenderly for gas and gasPrice if gas and gasPrice not provided.
   */
  public async bridgeAndExecute(
    params: BridgeAndExecuteParams,
    options?: OnEventParam & BeforeExecuteHook
  ): Promise<BridgeAndExecuteResult> {
    const {
      dstPublicClient,
      dstChain,
      address,
      token,
      skipBridge,
      tx,
      approvalTx,
      amount,
      gas,
      gasPrice,
    } = await this.estimateBridgeAndExecute(params);

    logger.debug('BridgeAndExecute:4:CalculateOptimalBridgeAmount', {
      params,
      skipBridge,
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

    const executeSteps: BridgeStepType[] = [
      BRIDGE_STEPS.EXECUTE_TRANSACTION_SENT,
      BRIDGE_STEPS.EXECUTE_TRANSACTION_CONFIRMED,
    ];

    // Approval and execute
    if (approvalTx) {
      executeSteps.unshift(BRIDGE_STEPS.EXECUTE_APPROVAL_STEP);
    }

    let bridgeResult: BridgeResult | null = null;

    // 7. If bridge is required then bridge
    if (skipBridge) {
      if (options?.onEvent) {
        options.onEvent({ name: NEXUS_EVENTS.STEPS_LIST, args: executeSteps });
      }
    } else {
      bridgeResult = await this.bridgeWrapper(
        {
          token: token.symbol,
          amount: amount.token,
          toChainId: params.toChainId,
          sourceChains: params.sourceChains,
          gas: amount.gas,
        },
        {
          onEvent: (event) => {
            if (options?.onEvent) {
              if (event.name === NEXUS_EVENTS.STEPS_LIST) {
                options.onEvent({
                  name: NEXUS_EVENTS.STEPS_LIST,
                  args: event.args.concat(executeSteps),
                });
              } else {
                options.onEvent(event);
              }
            }
          },
        }
      );
    }

    if (options?.beforeExecute) {
      const response = await options.beforeExecute();
      logger.debug('BeforeExecuteHook', {
        response,
      });
      if (response.data) {
        tx.data = response.data;
      }

      if (response.value) {
        tx.value = response.value;
      }

      if (response.gas && response.gas !== 0n) {
        tx.gas = response.gas;
      }
    }

    // 8. Execute the transaction
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
        receiptTimeout: params.receiptTimeout,
        requiredConfirmations: params.requiredConfirmations,
        waitForReceipt: params.waitForReceipt,
        client: this.evmClient,
      }
    );

    logger.debug('BridgeAndExecute:5', {
      executeResponse,
    });

    // 9. Return result
    const result: BridgeAndExecuteResult = {
      executeTransactionHash: executeResponse.txHash,
      executeExplorerUrl: createExplorerTxURL(
        executeResponse.txHash,
        dstChain.blockExplorers.default.url
      ),
      approvalTransactionHash: executeResponse.approvalHash,
      bridgeExplorerUrl: bridgeResult?.explorerUrl,
      toChainId: params.toChainId,
      bridgeSkipped: skipBridge,
      intent: bridgeResult?.intent,
    };

    return result;
  }

  private async createTxsForExecute(params: ExecuteParams, address: Hex) {
    // 1. Check if dst chain data is available
    const dstChain = this.chainList.getChainByID(params.toChainId);
    if (!dstChain) {
      throw Errors.chainNotFound(params.toChainId);
    }

    const dstPublicClient = createPublicClient({
      transport: http(dstChain.rpcUrls.default.http[0]),
    });

    // 2. Check if token is supported
    let approvalTx: Tx | null = null;
    if (params.tokenApproval) {
      const token = this.chainList.getTokenInfoBySymbol(
        params.toChainId,
        params.tokenApproval.token
      );
      if (!token) {
        throw Errors.tokenNotFound(params.tokenApproval.token, params.toChainId);
      }
      const spender = params.tokenApproval.spender;
      const currentAllowance = await erc20GetAllowance(
        {
          contractAddress: token.contractAddress,
          spender: params.tokenApproval.spender,
          owner: address,
        },
        dstPublicClient
      );

      const requiredAllowance = BigInt(params.tokenApproval.amount);
      if (currentAllowance < requiredAllowance) {
        approvalTx = {
          to: token.contractAddress,
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

  public async execute(params: ExecuteParams, options?: OnEventParam) {
    const address = (await this.evmClient.getAddresses())[0];
    const { dstPublicClient, dstChain, approvalTx, tx } = await this.createTxsForExecute(
      params,
      address
    );

    // 1. Execute the transaction
    const executeResponse = await this.sendTx(
      {
        approvalTx,
        tx,
      },
      {
        emit: options?.onEvent,
        chain: dstChain,
        dstPublicClient,
        address,
        receiptTimeout: params.receiptTimeout,
        requiredConfirmations: params.requiredConfirmations,
        waitForReceipt: params.waitForReceipt,
        client: this.evmClient,
      }
    );

    const result: ExecuteResult = {
      chainId: params.toChainId,
      explorerUrl: createExplorerTxURL(executeResponse.txHash, dstChain.blockExplorers.default.url),
      transactionHash: executeResponse.txHash,
      approvalTransactionHash: executeResponse.approvalHash,
      receipt: executeResponse.receipt,
      confirmations: params.requiredConfirmations,
      effectiveGasPrice: String(0),
      gasUsed: String(executeResponse.receipt?.gasUsed ?? 0n),
    };

    return result;
  }

  public async simulateExecute(params: ExecuteParams, address: Hex): Promise<ExecuteSimulation> {
    const { dstPublicClient, tx } = await this.createTxsForExecute(params, address);

    const [gasUsed, feeEstimate] = await Promise.all([
      dstPublicClient.estimateGas({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        account: address,
      }),
      dstPublicClient.estimateFeesPerGas(),
    ]);

    const gasPrice = feeEstimate.maxFeePerGas ?? feeEstimate.gasPrice ?? 0n;
    if (gasPrice === 0n) {
      throw Errors.gasPriceError({});
    }

    return {
      gasUsed: gasUsed,
      gasPrice: gasPrice,
      gasFee: gasUsed * gasPrice,
    };
  }

  /**
   * Calculate optimal bridge amount based on destination chain balance
   * Returns the exact amount needed to bridge, or indicates if bridge can be skipped entirely
   */
  private async calculateOptimalBridgeAmount(
    chain: Chain,
    tokenAddress: Hex,
    tokenDecimals: number,
    requiredTokenAmount: bigint,
    requiredGasAmount: bigint,
    assets: UserAssetDatum[]
  ): Promise<{ skipBridge: boolean; tokenAmount: bigint; gasAmount: bigint }> {
    let skipBridge = true;
    let tokenAmount = requiredTokenAmount;
    let gasAmount = requiredGasAmount;
    const assetList = new UserAssets(assets);
    const { destinationAssetBalance, destinationGasBalance } = assetList.getAssetDetails(
      chain,
      tokenAddress
    );

    const destinationTokenAmount = mulDecimals(destinationAssetBalance, tokenDecimals);
    const destinationGasAmount = mulDecimals(destinationGasBalance, chain.nativeCurrency.decimals);

    logger.debug('calculateOptimalBridgeAmount', {
      destinationTokenAmount,
      requiredTokenAmount,
      destinationGasAmount,
      requiredGasAmount,
    });
    if (isNativeAddress(Universe.ETHEREUM, tokenAddress)) {
      const totalRequired = requiredGasAmount + requiredTokenAmount;
      if (destinationGasAmount < totalRequired) {
        skipBridge = false;
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
        skipBridge = false;

        tokenAmount =
          destinationTokenAmount < requiredTokenAmount
            ? requiredTokenAmount - destinationTokenAmount
            : 0n;

        gasAmount =
          destinationGasAmount < requiredGasAmount ? requiredGasAmount - destinationGasAmount : 0n;
      }
    }
    return {
      skipBridge,
      tokenAmount,
      gasAmount,
    };
  }

  private async simulateBundle(input: {
    tokenSymbol: string;
    tokenAddress: Hex;
    amount: bigint;
    txs: Tx[];
    chainId: number;
    userAddress: Hex;
  }) {
    const overrides = generateStateOverride(input);
    return this.simulationClient.simulateBundleV2({
      chainId: String(input.chainId),
      simulations: input.txs.map((tx, i) => ({
        type: 'something',
        from: input.userAddress,
        to: tx.to,
        data: tx.data,
        value: toHex(tx.value),
        stepId: `sim_${i}`,
        enableStateOverride: true, // ????????
        stateOverride: overrides,
      })),
    });
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

  private readonly bridgeWrapper = async (
    params: BridgeParams,
    options?: OnEventParam
  ): Promise<BridgeResult> => {
    const handler = await this.bridge(params, options);
    const result = await handler.execute();
    return {
      explorerUrl: result.explorerURL,
      sourceTxs: result.sourceTxs,
      intent: result.intent,
    };
  };

  private readonly simulateBridgeWrapper = async (params: BridgeParams) => {
    const handler = await this.bridge(params);
    const result = await handler.simulate();
    return result;
  };
}

export { BridgeAndExecuteQuery };
