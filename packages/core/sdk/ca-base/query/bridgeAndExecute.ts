import {
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeResult,
  logger,
  Tx,
  Chain,
  ChainListType,
  BridgeParams,
  UserAssetDatum,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  BridgeQueryInput,
  OnEventParam,
  BridgeAndExecuteSimulationResult,
  NEXUS_EVENTS,
  BRIDGE_STEPS,
  BridgeStepType,
} from '@nexus/commons';
import { createPublicClient, Hex, http, PublicClient, toHex, WalletClient } from 'viem';
import {
  createExplorerTxURL,
  divDecimals,
  erc20GetAllowance,
  mulDecimals,
  UserAssets,
  waitForTxReceipt,
  generateStateOverride,
} from '../utils';
import { packERC20Approve } from '../swap/utils';
import { BackendSimulationClient } from 'integrations/tenderly';
import BridgeHandler from '../requestHandlers/bridge';

class BridgeAndExecuteQuery {
  constructor(
    private chainList: ChainListType,
    private evmClient: WalletClient,
    private bridge: (input: BridgeQueryInput, options?: OnEventParam) => BridgeHandler,
    private getUnifiedBalances: () => Promise<UserAssetDatum[]>,
    private simulationClient: BackendSimulationClient,
  ) {}

  private async estimateBridgeAndExecute(params: BridgeAndExecuteParams) {
    const { toChainId, token: tokenSymbol, amount, execute } = params;

    const { token, chain: dstChain } = this.chainList.getChainAndTokenFromSymbol(
      params.toChainId,
      tokenSymbol,
    );
    if (!token) {
      throw new Error(`Token ${tokenSymbol} not supported on chain ${toChainId}.`);
    }

    logger.debug('BridgeAndExecute:1', {
      token,
      dstChain,
    });
    await this.evmClient.switchChain({ id: params.toChainId });

    const address = (await this.evmClient.getAddresses())[0];
    let txs: Tx[] = [];

    const { tx, approvalTx, dstPublicClient } = await this.createTxsForExecute(
      { ...execute, toChainId: params.toChainId },
      address,
    );

    logger.debug('BridgeAndExecute:2', {
      tx,
      approvalTx,
    });

    if (approvalTx) {
      txs.push(approvalTx);
    }

    txs.push(tx);

    const determineGasUsed = params.execute.gas
      ? Promise.resolve({ gasUsed: params.execute.gas + (approvalTx ? 85_000n : 0n) })
      : this.simulateBundle({
          txs,
          amount: BigInt(execute.tokenApproval?.amount ?? '0'),
          userAddress: address,
          chainId: dstChain.id,
          tokenAddress: token.contractAddress,
          tokenSymbol: execute.tokenApproval?.token ?? 'ETH',
        });

    const determineGasFee = params.execute.gasPrice
      ? Promise.resolve({
          maxFeePerGas: params.execute.gasPrice,
          gasPrice: params.execute.gasPrice,
        })
      : dstPublicClient.estimateFeesPerGas();

    // 5. simulate approval(?) and execution + fetch gasPrice + fetch unified balance
    const [{ gasUsed }, gasFeeEstimate, balances] = await Promise.all([
      determineGasUsed,
      determineGasFee,
      this.getUnifiedBalances(),
    ]);

    const gasPrice = gasFeeEstimate.maxFeePerGas ?? gasFeeEstimate.gasPrice ?? 0n;
    if (gasPrice === 0n) {
      throw new Error('Gas price could not be fetched from RPC URL.');
    }

    const gasFee = gasUsed * gasPrice;

    logger.debug('BridgeAndExecute:3', {
      gasUsed,
      gasFeeEstimate,
      gasPrice,
      balances,
    });

    // 6. Determine gas or token needed via bridge
    const { skipBridge, tokenAmount, gasAmount } = await this.calculateOptimalBridgeAmount(
      dstChain,
      token.contractAddress,
      token.decimals,
      amount,
      gasFee,
      balances,
    );

    return {
      skipBridge,
      tokenAmount,
      gasAmount,
      tx,
      approvalTx,
      token,
      dstChain,
      address,
      dstPublicClient,
      gasFee,
      gasUsed,
      gasPrice,
    };
  }

  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    const { gasFee, token, skipBridge, tokenAmount, gasAmount, gasUsed } =
      await this.estimateBridgeAndExecute(params);

    logger.debug('BridgeAndExecute:4:CalculateOptimalBridgeAmount', {
      skipBridge,
      tokenAmount,
      gasAmount,
    });

    let bridgeResult = null;

    // 7. If bridge is required then simulate bridge
    if (!skipBridge) {
      bridgeResult = await this.simulateBridgeWrapper({
        token: token.symbol,
        amount: divDecimals(BigInt(tokenAmount), token.decimals).toFixed(),
        chainId: params.toChainId,
        sourceChains: params.sourceChains,
        gas: gasAmount,
      });
    }

    // 8. Return result
    const result: BridgeAndExecuteSimulationResult = {
      bridgeSimulation: bridgeResult,
      executeSimulation: {
        gasUsed,
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
    options?: OnEventParam,
  ): Promise<BridgeAndExecuteResult> {
    const {
      dstPublicClient,
      address,
      dstChain,
      token,
      skipBridge,
      tokenAmount,
      gasAmount,
      tx,
      approvalTx,
      gasUsed,
      gasPrice,
    } = await this.estimateBridgeAndExecute(params);

    logger.debug('BridgeAndExecute:4:CalculateOptimalBridgeAmount', {
      skipBridge,
      tokenAmount,
      gasAmount,
    });

    const executeSteps: BridgeStepType[] = [
      BRIDGE_STEPS.EXECUTE_TRANSACTION_SENT,
      BRIDGE_STEPS.EXECUTE_TRANSACTION_CONFIRMED,
    ];

    // Approval and execute
    if (approvalTx) {
      executeSteps.unshift(BRIDGE_STEPS.EXECUTE_APPROVAL_STEP);
    }

    let bridgeResult: BridgeResult = {
      explorerUrl: '',
    };

    // 7. If bridge is required then bridge
    if (!skipBridge) {
      bridgeResult = await this.bridgeWrapper(
        {
          token: token.symbol,
          amount: divDecimals(BigInt(tokenAmount), token.decimals).toFixed(),
          chainId: params.toChainId,
          sourceChains: params.sourceChains,
          gas: gasAmount,
        },
        {
          onEvent: (event) => {
            if (options && options.onEvent) {
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
        },
      );
    } else {
      if (options && options.onEvent) {
        options.onEvent({ name: NEXUS_EVENTS.STEPS_LIST, args: executeSteps });
      }
    }

    // 8. Execute the transaction
    const executeResponse = await this.sendTx(
      {
        approvalTx,
        tx,
        gas: gasUsed,
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
      },
    );

    logger.debug('BridgeAndExecute:5', {
      executeResponse,
    });

    // 9. Return result
    const result: BridgeAndExecuteResult = {
      executeTransactionHash: executeResponse.txHash,
      executeExplorerUrl: createExplorerTxURL(
        executeResponse.txHash,
        dstChain.blockExplorers!.default.url,
      ),
      approvalTransactionHash: executeResponse.approvalHash,
      bridgeExplorerUrl: bridgeResult.explorerUrl,
      toChainId: params.toChainId,
      bridgeSkipped: skipBridge,
    };

    return result;
  }

  private async createTxsForExecute(params: ExecuteParams, address: Hex) {
    // 1. Check if dst chain data is available
    const dstChain = this.chainList.getChainByID(params.toChainId);
    if (!dstChain) {
      throw new Error(`Chain not supported: ${params.toChainId}`);
    }

    const dstPublicClient = createPublicClient({
      transport: http(dstChain.rpcUrls.default.http[0]),
    });

    // 2. Check if token is supported
    let approvalTx: Tx | null = null;
    if (params.tokenApproval) {
      const token = this.chainList.getTokenInfoBySymbol(
        params.toChainId,
        params.tokenApproval.token,
      );
      if (!token) {
        throw new Error(
          `Token ${params.tokenApproval.token} not supported on chain ${params.toChainId}.`,
        );
      }
      if (params.tokenApproval) {
        const spender = params.tokenApproval.spender;
        const currentAllowance = await erc20GetAllowance(
          {
            contractAddress: token.contractAddress,
            spender: params.tokenApproval.spender,
            owner: address,
          },
          dstPublicClient,
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
    }

    // 4. Encode execute tx
    const tx = {
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
      address,
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
      },
    );

    const result: ExecuteResult = {
      chainId: params.toChainId,
      explorerUrl: createExplorerTxURL(
        executeResponse.txHash,
        dstChain.blockExplorers!.default.url,
      ),
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

    const [gasUsed, gasPrice] = await Promise.all([
      dstPublicClient.estimateGas({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        account: address,
      }),
      dstPublicClient.estimateFeesPerGas(),
    ]);

    const gasUnitPrice = gasPrice.maxFeePerGas ?? gasPrice.gasPrice ?? 0n;
    if (gasUnitPrice === 0n) {
      throw new Error('could not get gas price from rpc.');
    }

    return {
      gasUsed: gasUsed,
      gasFee: gasUsed * gasUnitPrice,
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
    assets: UserAssetDatum[],
  ): Promise<{ skipBridge: boolean; tokenAmount: bigint; gasAmount: bigint }> {
    try {
      let skipBridge = true;
      let tokenAmount = requiredTokenAmount;
      let gasAmount = requiredGasAmount;
      const assetList = new UserAssets(assets);
      const { destinationAssetBalance, destinationGasBalance } = assetList.getAssetDetails(
        chain,
        tokenAddress,
      );

      const destinationTokenAmount = mulDecimals(destinationAssetBalance, tokenDecimals);
      const destinationGasAmount = mulDecimals(
        destinationGasBalance,
        chain.nativeCurrency.decimals,
      );

      logger.debug('calculateOptimalBridgeAmount', {
        destinationTokenAmount,
        requiredTokenAmount,
        destinationGasAmount,
        requiredGasAmount,
      });

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

      return {
        skipBridge,
        tokenAmount,
        gasAmount,
      };
    } catch (error) {
      logger.warn(`Failed to calculate optimal bridge amount: ${error}`);
      // Default to bridging full amount on error
      return { skipBridge: false, tokenAmount: requiredTokenAmount, gasAmount: requiredGasAmount };
    }
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
        stateOverride: overrides,
      })),
    });
  }

  private async sendTx(
    params: {
      tx: Tx;
      approvalTx: Tx | null;
      gas?: bigint;
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
    },
  ) {
    const { waitForReceipt = true, receiptTimeout = 300000, requiredConfirmations = 1 } = options;

    let approvalHash;
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
      gas: params.gas,
      gasPrice: params.gasPrice,
    });

    if (options.emit) {
      options.emit({
        name: NEXUS_EVENTS.STEP_COMPLETE,
        args: BRIDGE_STEPS.EXECUTE_TRANSACTION_SENT,
      });
    }

    let receipt;
    if (waitForReceipt) {
      receipt = await waitForTxReceipt(
        txHash,
        options.dstPublicClient,
        requiredConfirmations,
        receiptTimeout,
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

  private bridgeWrapper = async (
    params: BridgeParams,
    options?: OnEventParam,
  ): Promise<BridgeResult> => {
    const handler = this.bridge(params, options);
    const result = await handler.execute();
    return {
      explorerUrl: result?.explorerURL ?? '',
    };
  };

  private simulateBridgeWrapper = async (params: BridgeParams) => {
    try {
      const handler = this.bridge(params);
      const result = await handler.simulate();
      return result;
    } catch (e) {
      logger.debug('simulateBridgeError', { e });
      return null;
    }
  };
}

export { BridgeAndExecuteQuery };
