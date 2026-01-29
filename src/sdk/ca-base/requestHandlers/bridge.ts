import {
  ChaindataMap,
  ERC20ABI,
  EVMVaultABI,
  OmniversalChainID,
  PermitVariant,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { TronWeb } from 'tronweb';
import {
  ContractFunctionExecutionError,
  createPublicClient,
  type Hex,
  type JsonRpcAccount,
  maxUint256,
  parseSignature,
  type TransactionReceipt,
  toHex,
  UserRejectedRequestError,
  webSocket,
} from 'viem';
import {
  BRIDGE_STEPS,
  type BridgeStepType,
  type Chain,
  getLogger,
  type IBridgeOptions,
  type Intent,
  NEXUS_EVENTS,
  type onAllowanceHookSource,
  type ReadableIntent,
  type SetAllowanceInput,
  type SourceTxs,
  type TokenInfo,
  type V2ApprovalsByChain,
} from '../../../commons';
import { isNativeAddress } from '../constants';
import { Errors } from '../errors';
import { createSteps } from '../steps';
import {
  convertIntent,
  convertTo32Bytes,
  createExplorerTxURL,
  createPublicClientWithFallback,
  createV2RequestFromIntent,
  divDecimals,
  equalFold,
  getAllowances,
  getBalancesForBridge,
  getExplorerURL,
  mulDecimals,
  requestTimeout,
  retrieveAddress,
  signPermitForAddressAndValue,
  switchChain,
  UserAssets,
  waitForIntentFulfilment,
  waitForTronApprovalTxConfirmation,
  waitForTxReceipt,
} from '../utils';

type Params = {
  recipient?: Hex;
  dstChain: Chain;
  dstToken: TokenInfo;
  tokenAmount: bigint;
  nativeAmount: bigint;
  sourceChains: number[];
};

const logger = getLogger();

class BridgeHandler {
  protected steps: BridgeStepType[] = [];
  protected params: Required<Params>;
  constructor(
    params: Params,
    readonly options: IBridgeOptions
  ) {
    this.params = {
      ...params,
      recipient: params.recipient ?? retrieveAddress(params.dstChain.universe, options),
    };
    console.log({ params: this.params, options });
  }

  public async simulate() {
    const intent = await this.buildIntent(this.params.sourceChains);
    return {
      intent: convertIntent(intent, this.params.dstToken, this.options.chainList),
      token: this.params.dstToken,
    };
  }

  private readonly buildIntent = async (sourceChains: number[] = []) => {
    // Promise.all because there will be fees + oracle API ?
    const [assets] = await Promise.all([
      getBalancesForBridge({
        middlewareClient: this.options.middlewareClient,
        evmAddress: this.options.evm.address,
        chainList: this.options.chainList,
      }),
    ]);

    logger.debug('Step 0: BuildIntent', {
      assets,
    });

    // Step 2: parse simulation results
    const userAssets = new UserAssets(assets);

    console.time('preIntentSteps: CalculateGas');

    const tokenAmountInDecimal = divDecimals(
      this.params.tokenAmount,
      this.params.dstToken.decimals
    );

    // Step 4: create intent
    const intent = await this.createIntent({
      amount: tokenAmountInDecimal,
      assets: userAssets,
      gas: new Decimal(0),
      gasInToken: new Decimal(0),
      sourceChains,
      token: this.params.dstToken,
    });

    return intent;
  };

  private filterInsufficientAllowanceSources(
    intent: Intent,
    allowances: Awaited<ReturnType<typeof getAllowances>>
  ) {
    const sources: onAllowanceHookSource[] = [];
    for (const s of intent.sources) {
      if (
        s.chainID === intent.destination.chainID ||
        isNativeAddress(s.universe, s.tokenContract)
      ) {
        continue;
      }

      const chain = this.options.chainList.getChainByID(s.chainID);
      if (!chain) {
        throw Errors.chainNotFound(s.chainID);
      }

      const token = this.options.chainList.getTokenByAddress(s.chainID, s.tokenContract);
      if (!token) {
        throw Errors.tokenNotSupported(s.tokenContract, s.chainID);
      }

      const requiredAllowance = mulDecimals(s.amount, token.decimals);
      const currentAllowance = allowances[s.chainID] ?? 0n;

      logger.debug('getUnallowedSources:1', {
        currentAllowance: currentAllowance.toString(),
        requiredAllowance: requiredAllowance.toString(),
        token,
      });

      if (requiredAllowance > currentAllowance) {
        const d = {
          allowance: {
            current: divDecimals(allowances[s.chainID], token.decimals).toFixed(token.decimals),
            currentRaw: currentAllowance,
            minimum: s.amount.toFixed(token.decimals),
            minimumRaw: requiredAllowance,
          },
          chain: {
            id: chain.id,
            logo: chain.custom.icon,
            name: chain.name,
          },
          token: {
            contractAddress: token.contractAddress,
            decimals: token.decimals,
            logo: token.logo || '',
            name: token.name,
            symbol: token.symbol,
          },
        };
        sources.push(d);
      }
    }
    return sources;
  }

  public execute = async (): Promise<{
    explorerURL: string;
    intent: ReadableIntent;
    sourceTxs: SourceTxs;
  }> => {
    try {
      let intent = await this.buildIntent(this.params.sourceChains);

      const allowances = await getAllowances(intent.allSources, this.options.chainList);

      let insufficientAllowanceSources = this.filterInsufficientAllowanceSources(
        intent,
        allowances
      );
      this.createExpectedSteps(intent, insufficientAllowanceSources);

      let accepted = false;
      const refresh = async (sourceChains?: number[]) => {
        if (accepted) {
          logger.warn('Intent refresh called after acceptance');
          return convertIntent(intent, this.params.dstToken, this.options.chainList);
        }

        intent = await this.buildIntent(sourceChains);
        if (intent.isAvailableBalanceInsufficient) {
          throw Errors.insufficientBalance();
        }
        insufficientAllowanceSources = this.filterInsufficientAllowanceSources(intent, allowances);
        this.createExpectedSteps(intent, insufficientAllowanceSources);

        return convertIntent(intent, this.params.dstToken, this.options.chainList);
      };

      // wait for intent acceptance hook
      await new Promise((resolve, reject) => {
        const allow = () => {
          accepted = true;
          return resolve('User allowed intent');
        };

        const deny = () => {
          return reject(Errors.userDeniedIntent());
        };

        this.options.hooks.onIntent({
          allow,
          deny,
          intent: convertIntent(intent, this.params.dstToken, this.options.chainList),
          refresh,
        });
      });

      this.markStepDone(BRIDGE_STEPS.INTENT_ACCEPTED);

      console.time('process:AllowanceHook');

      // Step 5: set allowance if not set
      await this.waitForOnAllowanceHook(insufficientAllowanceSources);
      console.timeEnd('process:AllowanceHook');

      // Step 6: Process intent
      logger.debug('intent', { intent });

      const { explorerURL, requestHash, sourceTxs } = await this.processRFF(intent);

      // Step 7: Wait for fill
      await this.waitForFill(requestHash);

      this.markStepDone(BRIDGE_STEPS.INTENT_FULFILLED);

      if (this.params.dstChain.universe === Universe.ETHEREUM) {
        await switchChain(this.options.evm.client, this.params.dstChain);
      }

      return {
        explorerURL,
        intent: convertIntent(intent, this.params.dstToken, this.options.chainList),
        sourceTxs,
      };
    } catch (error) {
      logger.error('bridge: execute error', error);
      throw error;
    }
  };

  private async waitForFill(requestHash: `0x${string}`) {
    const ac = new AbortController();
    const promisesToRace = [requestTimeout(3, ac)];

    // Use eth_subscribe to read fill events if destination is EVM - usually the fastest
    if (this.params.dstChain.universe === Universe.ETHEREUM) {
      promisesToRace.push(
        waitForIntentFulfilment(
          createPublicClient({
            transport: webSocket(this.params.dstChain.rpcUrls.default.webSocket[0]),
          }),
          this.options.chainList.getVaultContractAddress(this.params.dstChain.id),
          requestHash,
          ac
        )
      );
    }
    await Promise.race(promisesToRace);
    logger.debug('Fill completed');
  }

  private async processRFF(
    intent: Intent
  ): Promise<{ explorerURL: string; requestHash: Hex; sourceTxs: SourceTxs }> {
    const { v2Request, request, signature } = await createV2RequestFromIntent(
      intent,
      this.options,
      this.params.dstChain.universe
    );

    this.markStepDone(BRIDGE_STEPS.INTENT_HASH_SIGNED);

    logger.debug('processRFF:3', { request });

    const createRFFResponse = await this.options.middlewareClient.submitRFF({
      request: v2Request,
      signature,
    });

    const explorerURL = getExplorerURL(
      this.options.intentExplorerUrl,
      createRFFResponse.request_hash
    );
    this.markStepDone(BRIDGE_STEPS.INTENT_SUBMITTED(explorerURL, createRFFResponse.request_hash));

    const sourceTxs: {
      chain: {
        id: number;
        name: string;
        logo: string;
      };
      hash: Hex;
      explorerUrl: string;
    }[] = [];

    const evmDeposits: Promise<unknown>[] = [];

    for (const [i, s] of request.sources.entries()) {
      const chain = this.options.chainList.getChainByID(Number(s.chainID));
      if (!chain) {
        throw Errors.chainNotFound(s.chainID);
      }

      if (s.universe === Universe.ETHEREUM && isNativeAddress(s.universe, s.contractAddress)) {
        await switchChain(this.options.evm.client, chain);

        const publicClient = createPublicClientWithFallback(chain);

        const result = await publicClient.simulateContract({
          abi: EVMVaultABI,
          account: this.options.evm.address,
          address: this.options.chainList.getVaultContractAddress(chain.id),
          args: [request, signature, BigInt(i)],
          chain: chain,
          functionName: 'deposit',
          value: s.value,
        });
        const hash = await this.options.evm.client.writeContract(result.request);
        this.markStepDone(BRIDGE_STEPS.INTENT_DEPOSIT_REQUEST(i + 1, new Decimal(s.value), chain));
        sourceTxs.push({
          chain: {
            id: chain.id,
            name: chain.name,
            logo: chain.custom.icon,
          },
          hash,
          explorerUrl: createExplorerTxURL(hash, chain.blockExplorers!.default.url),
        });
        evmDeposits.push(waitForTxReceipt(hash, publicClient));
      }
    }
    if (evmDeposits.length) {
      await Promise.all([...evmDeposits]);
      this.markStepDone(BRIDGE_STEPS.INTENT_DEPOSITS_CONFIRMED);
    }

    logger.debug('PostIntentSubmission: Intent ID', {
      id: createRFFResponse.request_hash,
    });

    return {
      explorerURL,
      sourceTxs,
      requestHash: createRFFResponse.request_hash,
    };
  }

  private async setAllowances(input: Array<SetAllowanceInput>) {
    const originalChain = this.params.dstChain.id;
    logger.debug('setAllowances', { originalChain, input });

    const sponsoredApprovals: V2ApprovalsByChain = {};
    const unsponsoredApprovals: Promise<TransactionReceipt>[] = [];
    try {
      for (const source of input) {
        const chain = this.options.chainList.getChainByID(source.chainID);
        if (!chain) {
          throw Errors.chainNotFound(source.chainID);
        }

        const publicClient = createPublicClientWithFallback(chain);

        const vc = this.options.chainList.getVaultContractAddress(chain.id);

        const chainId = new OmniversalChainID(chain.universe, source.chainID);
        const chainDatum = ChaindataMap.get(chainId);
        if (!chainDatum) {
          throw Errors.internal('Chain data not found', {
            chainId: source.chainID,
            universe: chain.universe,
          });
        }

        const currency = chainDatum.CurrencyMap.get(convertTo32Bytes(source.tokenContract));
        if (!currency) {
          throw Errors.internal('currency not found', {
            chainId: source.chainID,
            tokenContractAddress: source.tokenContract,
          });
        }

        if (chain.universe === Universe.ETHEREUM) {
          logger.debug(`Switching chain to ${chain.id}`);

          await switchChain(this.options.evm.client, chain);
        }

        if (currency.permitVariant === PermitVariant.Unsupported || chain.id === 1) {
          if (chain.universe === Universe.ETHEREUM) {
            const h = await this.options.evm.client
              .writeContract({
                abi: ERC20ABI,
                account: this.options.evm.address,
                address: source.tokenContract,
                args: [vc, BigInt(source.amount)],
                chain,
                functionName: 'approve',
              })
              .catch((e) => {
                if (e instanceof ContractFunctionExecutionError) {
                  const isUserRejectedRequestError =
                    e.walk((e) => e instanceof UserRejectedRequestError) instanceof
                    UserRejectedRequestError;
                  if (isUserRejectedRequestError) {
                    throw Errors.userRejectedAllowance();
                  }
                }
                throw e;
              });

            this.markStepDone(BRIDGE_STEPS.ALLOWANCE_APPROVAL_REQUEST(chain));

            unsponsoredApprovals.push(waitForTxReceipt(h, publicClient));
          } else if (chain.universe === Universe.TRON) {
            if (!this.options.tron) {
              throw Errors.internal('Tron is available in sources but has no adapter/provider');
            }

            const provider = new TronWeb({
              fullHost: chain.rpcUrls.default.grpc![0],
            });
            const tx = await provider.transactionBuilder.triggerSmartContract(
              TronWeb.address.fromHex(source.tokenContract),
              'approve(address,uint256)',
              {
                txLocal: true,
              },
              [
                { type: 'address', value: TronWeb.address.fromHex(vc) },
                { type: 'uint256', value: source.amount.toString() },
              ],
              TronWeb.address.fromHex(this.options.tron?.address)
            );
            const signedTx = await this.options.tron.adapter.signTransaction(tx.transaction);
            logger.debug('tron approval signTransaction result', {
              signedTx,
            });

            if (!this.options.tron.adapter.isMobile) {
              const txResult = await provider.trx.sendRawTransaction(signedTx);

              logger.debug('tron tx result', {
                txResult,
              });
              if (!txResult.result) {
                throw Errors.tronApprovalFailed(txResult);
              }
            }

            await waitForTronApprovalTxConfirmation(
              source.amount,
              this.options.tron.address as Hex,
              vc,
              source.tokenContract,
              provider
            );
          }

          this.markStepDone(BRIDGE_STEPS.ALLOWANCE_APPROVAL_MINED(chain));
        } else {
          const account: JsonRpcAccount = {
            address: this.options.evm.address,
            type: 'json-rpc',
          };

          const signed = parseSignature(
            await signPermitForAddressAndValue(
              currency,
              this.options.evm.client,
              publicClient,
              account,
              vc,
              source.amount
            ).catch((e) => {
              if (e instanceof ContractFunctionExecutionError) {
                const isUserRejectedRequestError =
                  e.walk((e) => e instanceof UserRejectedRequestError) instanceof
                  UserRejectedRequestError;
                if (isUserRejectedRequestError) {
                  throw Errors.userRejectedAllowance();
                }
              }
              throw e;
            })
          );

          this.markStepDone(BRIDGE_STEPS.ALLOWANCE_APPROVAL_REQUEST(chain));

          sponsoredApprovals[chain.id] = [
            {
              address: account.address,
              ops: [
                {
                  signature: {
                    v: signed.yParity < 27 ? signed.yParity + 27 : signed.yParity,
                    r: signed.r,
                    s: signed.s,
                  },
                  tokenAddress: source.tokenContract,
                  value: toHex(source.amount),
                  variant: currency.permitVariant === PermitVariant.PolygonEMT ? 2 : 1,
                },
              ],
            },
          ];
        }
      }

      if (Object.keys(sponsoredApprovals).length) {
        logger.debug('setAllowances:sponsoredApprovals', {
          sponsoredApprovals,
        });
        const approvalResponse =
          await this.options.middlewareClient.createApprovals(sponsoredApprovals);
        logger.debug('sponsoredApprovals', {
          approvalResponse,
        });
      }
      if (unsponsoredApprovals.length) {
        await Promise.all(unsponsoredApprovals);
      }
      this.markStepDone(BRIDGE_STEPS.ALLOWANCE_COMPLETE);
    } catch (e) {
      logger.error('Error setting allowances', e, { cause: 'ALLOWANCE_SETTING_ERROR' });
      throw e;
    } finally {
      if (this.params.dstChain.universe === Universe.ETHEREUM) {
        await switchChain(this.options.evm.client, this.params.dstChain);
      }
    }
  }

  private async waitForOnAllowanceHook(sources: onAllowanceHookSource[]): Promise<boolean> {
    if (sources.length === 0) {
      return false;
    }

    await new Promise((resolve, reject) => {
      const allow = (allowances: Array<'max' | 'min' | bigint | string>) => {
        if (sources.length !== allowances.length) {
          return reject(Errors.invalidAllowance(sources.length, allowances.length));
        }

        logger.debug('CA:BaseRequest:Allowances', {
          allowances,
          sources,
        });
        const val: Array<SetAllowanceInput> = [];
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i];
          const allowance = allowances[i];
          let amount = 0n;
          if (typeof allowance === 'string' && equalFold(allowance, 'max')) {
            amount = maxUint256;
          } else if (typeof allowance === 'string' && equalFold(allowance, 'min')) {
            amount = source.allowance.minimumRaw;
          } else if (typeof allowance === 'string') {
            amount = mulDecimals(allowance, source.token.decimals);
          } else {
            amount = allowance;
          }
          val.push({
            amount,
            chainID: source.chain.id,
            tokenContract: source.token.contractAddress,
          });
        }
        this.setAllowances(val).then(resolve).catch(reject);
      };

      const deny = () => {
        return reject(Errors.userRejectedAllowance());
      };

      this.options.hooks.onAllowance({
        allow,
        deny,
        sources,
      });
    });

    return true;
  }

  private createExpectedSteps(
    intent: Intent,
    insufficientAllowanceSources?: onAllowanceHookSource[]
  ) {
    this.steps = createSteps(intent, this.options.chainList, insufficientAllowanceSources);
    if (this.options.emit) {
      this.options.emit({ name: NEXUS_EVENTS.STEPS_LIST, args: this.steps });
    }
    logger.debug('BridgeSteps', this.steps);
  }

  private async createIntent(input: {
    amount: Decimal;
    assets: UserAssets;
    gas: Decimal;
    gasInToken: Decimal;
    sourceChains: number[];
    token: TokenInfo;
  }) {
    const { amount, assets, gas, gasInToken, token } = input;
    const intent: Intent = {
      allSources: [],
      destination: {
        amount: new Decimal('0'),
        chainID: this.params.dstChain.id,
        decimals: token.decimals,
        gas: 0n,
        tokenContract: token.contractAddress,
        universe: this.params.dstChain.universe,
      },
      fees: {
        caGas: '0',
        collection: '0',
        fulfilment: '0',
        gasSupplied: input.gasInToken.toFixed(),
        protocol: '0',
        solver: '0',
      },
      isAvailableBalanceInsufficient: false,
      sources: [],
      recipientAddress: this.params.recipient,
    };

    const asset = assets.find(token.symbol);
    if (!asset) {
      throw Errors.assetNotFound(token.symbol);
    }

    const allSources = (await asset.iterate(this.options.chainList)).map((v) => {
      const chain = this.options.chainList.getChainByID(v.chainID);
      if (!chain) {
        throw Errors.chainNotFound(v.chainID);
      }

      return { ...v, amount: v.balance, holderAddress: retrieveAddress(v.universe, this.options) };
    });

    intent.allSources = allSources;

    const destinationBalance = asset.getBalanceOnChain(
      this.params.dstChain.id,
      token.contractAddress
    );

    const borrow = amount;

    const borrowWithFee = borrow.add(gasInToken);

    logger.debug('createIntent:0', {
      borrow: borrow.toFixed(),
      borrowWithFee: borrowWithFee.toFixed(),
      destinationBalance,
      gasInToken: gasInToken.toFixed(),
    });

    let accountedAmount = new Decimal(0);

    const allowedSources = allSources.filter((b) => {
      if (input.sourceChains.length === 0) {
        return true;
      }
      return input.sourceChains.includes(b.chainID);
    });

    logger.debug('createIntent:1.1', { allowedSources });

    for (const assetC of allowedSources) {
      if (accountedAmount.greaterThanOrEqualTo(borrowWithFee)) {
        break;
      }

      if (assetC.chainID === this.params.dstChain.id) {
        continue;
      }

      const unaccountedAmount = borrowWithFee.minus(accountedAmount);

      let borrowFromThisChain = new Decimal(assetC.balance).lessThanOrEqualTo(unaccountedAmount)
        ? new Decimal(assetC.balance)
        : unaccountedAmount;

      logger.debug('createIntent:2.1', {
        accountedAmount: accountedAmount.toFixed(),
        asset: assetC,
        balance: assetC.balance.toFixed(),
        borrowFromThisChain: borrowFromThisChain.toFixed(),
        unaccountedAmount: unaccountedAmount.toFixed(),
      });

      const unaccountedBalance = borrowWithFee.minus(accountedAmount);

      borrowFromThisChain = new Decimal(assetC.balance).lessThanOrEqualTo(unaccountedBalance)
        ? new Decimal(assetC.balance)
        : unaccountedBalance;

      intent.sources.push({
        amount: borrowFromThisChain,
        chainID: assetC.chainID,
        tokenContract: assetC.tokenContract,
        universe: assetC.universe,
        holderAddress: assetC.holderAddress,
      });

      accountedAmount = accountedAmount.add(borrowFromThisChain);
    }

    intent.destination.amount = borrow;

    if (accountedAmount.lt(borrowWithFee)) {
      throw Errors.insufficientBalance(
        `required: ${borrowWithFee.toFixed()} ${
          token.symbol
        }, available: ${accountedAmount.toFixed()} ${token.symbol}`
      );
    }

    if (!gas.equals(0)) {
      intent.destination.gas = mulDecimals(gas, this.params.dstChain.nativeCurrency.decimals);
    }

    logger.debug('createIntent:4', { intent });

    return intent;
  }

  private readonly markStepDone = (step: BridgeStepType) => {
    if (this.options.emit) {
      const s = this.steps.find((s) => s.typeID === step.typeID);
      if (s) {
        this.options.emit({
          name: NEXUS_EVENTS.STEP_COMPLETE,
          args: step,
        });
      }
    }
  };
}

export default BridgeHandler;
