import {
  ArcanaVault,
  ChaindataMap,
  ERC20ABI,
  EVMVaultABI,
  OmniversalChainID,
  PermitVariant,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { Account, BN, CHAIN_IDS, hexlify } from 'fuels';
import Long from 'long';
import {
  ContractFunctionExecutionError,
  createPublicClient,
  encodeFunctionData,
  Hex,
  hexToBytes,
  JsonRpcAccount,
  maxUint256,
  parseSignature,
  toHex,
  TransactionReceipt,
  UserRejectedRequestError,
  webSocket,
} from 'viem';
import { isNativeAddress } from '../constants';
import { createSteps } from '../steps';
import {
  Intent,
  onAllowanceHookSource,
  SetAllowanceInput,
  SponsoredApprovalDataArray,
  Chain,
  TokenInfo,
  getLogger,
  IBridgeOptions,
  NEXUS_EVENTS,
  BridgeStepType,
  BRIDGE_STEPS,
} from '../../../commons';
import {
  convertGasToToken,
  convertIntent,
  convertTo32Bytes,
  cosmosCreateRFF,
  createDepositDoubleCheckTx,
  createPublicClientWithFallback,
  equalFold,
  FeeStore,
  fetchPriceOracle,
  getAllowances,
  getExplorerURL,
  getFeeStore,
  mulDecimals,
  removeIntentHashFromStore,
  signPermitForAddressAndValue,
  storeIntentHashToStore,
  switchChain,
  vscCreateRFF,
  vscCreateSponsoredApprovals,
  vscPublishRFF,
  waitForTxReceipt,
  UserAssets,
  waitForTronDepositTxConfirmation,
  waitForTronApprovalTxConfirmation,
  divDecimals,
  requestTimeout,
  cosmosFillCheck,
  waitForIntentFulfilment,
  createRFFromIntent,
  retrieveAddress,
  getBalances,
  // createDeadlineFromNow,
} from '../utils';
import { TronWeb } from 'tronweb';
import { Errors } from '../errors';
import { ERROR_CODES, NexusError } from '../nexusError';

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
  constructor(params: Params, readonly options: IBridgeOptions) {
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
    console.time('process:preIntentSteps');

    console.time('preIntentSteps:API');
    const [balances, oraclePrices, feeStore] = await Promise.all([
      getBalances({
        networkHint: this.options.networkConfig.NETWORK_HINT,
        vscDomain: this.options.networkConfig.VSC_DOMAIN,
        evmAddress: this.options.evm.address,
        chainList: this.options.chainList,
        fuelAddress: this.options.fuel?.address,
        tronAddress: this.options.tron?.address,
        isCA: true,
      }),
      fetchPriceOracle(this.options.networkConfig.GRPC_URL),
      getFeeStore(this.options.networkConfig.GRPC_URL),
    ]);

    logger.debug('Step 0: BuildIntent', {
      balances,
      oraclePrices,
      feeStore,
    });

    console.timeEnd('preIntentSteps:API');
    logger.debug('Step 1:', {
      balances,
      feeStore,
      oraclePrices,
    });

    console.time('preIntentSteps: Parse');

    const { assets } = balances;
    // Step 2: parse simulation results

    const userAssets = new UserAssets(assets);

    console.time('preIntentSteps: CalculateGas');

    const nativeAmountInDecimal = divDecimals(
      this.params.nativeAmount,
      this.params.dstChain.nativeCurrency.decimals,
    );

    const tokenAmountInDecimal = divDecimals(
      this.params.tokenAmount,
      this.params.dstToken.decimals,
    );

    const gasInToken = convertGasToToken(
      this.params.dstToken,
      oraclePrices,
      this.params.dstChain.id,
      this.params.dstChain.universe,
      nativeAmountInDecimal,
    );

    console.timeEnd('preIntentSteps: CalculateGas');

    logger.debug('preIntent:1', {
      gasInNative: nativeAmountInDecimal.toFixed(),
      gasInToken: gasInToken.toFixed(),
    });

    // Step 4: create intent
    console.time('preIntentSteps: CreateIntent');
    const intent = await this.createIntent({
      amount: tokenAmountInDecimal,
      assets: userAssets,
      feeStore,
      gas: nativeAmountInDecimal,
      gasInToken,
      sourceChains,
      token: this.params.dstToken,
    });
    console.timeEnd('preIntentSteps: CreateIntent');
    console.timeEnd('process:preIntentSteps');

    if (intent.isAvailableBalanceInsufficient) {
      throw Errors.insufficientBalance();
    }

    return intent;
  };

  private filterInsufficientAllowanceSources(
    intent: Intent,
    allowances: Awaited<ReturnType<typeof getAllowances>>,
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

  public execute = async (
    shouldRetryOnFailure = true,
  ): Promise<{ explorerURL: string; intentID: Long; intent?: any }> => {
    try {
      let intent = await this.buildIntent(this.params.sourceChains);

      const allowances = await getAllowances(intent.allSources, this.options.chainList);

      let insufficientAllowanceSources = this.filterInsufficientAllowanceSources(intent, allowances);
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

      const response = await this.processRFF(intent);
      if (response.retry) {
        logger.debug('rff fee expired, going to rebuild intent...');
        if (shouldRetryOnFailure) {
          // If fee expired go back and rebuild intent if first time
          return this.execute(false);
        } else {
          // Something else is wrong, retries probably wont fix it - so just throw
          throw Errors.rFFFeeExpired();
        }
      }

      const { explorerURL, intentID, requestHash, waitForDoubleCheckTx } = response;

      // Step 7: Wait for fill
      storeIntentHashToStore(this.options.evm.address, intentID.toNumber());
      await this.waitForFill(requestHash, intentID, waitForDoubleCheckTx);
      removeIntentHashFromStore(this.options.evm.address, intentID);

      this.markStepDone(BRIDGE_STEPS.INTENT_FULFILLED);

      if (this.params.dstChain.universe === Universe.ETHEREUM) {
        await switchChain(this.options.evm.client, this.params.dstChain);
      }

      return { explorerURL, intentID, intent };
    } catch (error) {
      throw error;
    }
  };

  private async waitForFill(
    requestHash: `0x${string}`,
    intentID: Long,
    waitForDoubleCheckTx: () => Promise<void>,
  ) {
    waitForDoubleCheckTx();

    const ac = new AbortController();
    let promisesToRace = [
      requestTimeout(3, ac),
      cosmosFillCheck(
        intentID,
        this.options.networkConfig.GRPC_URL,
        this.options.networkConfig.COSMOS_URL,
        ac,
      ),
    ];

    // Use eth_subscribe to read fill events if destination is EVM - usually the fastest
    if (this.params.dstChain.universe === Universe.ETHEREUM) {
      promisesToRace.push(
        waitForIntentFulfilment(
          createPublicClient({
            transport: webSocket(this.params.dstChain.rpcUrls.default.webSocket[0]),
          }),
          this.options.chainList.getVaultContractAddress(this.params.dstChain.id),
          requestHash,
          ac,
        ),
      );
    }
    await Promise.race(promisesToRace);
    logger.debug('Fill completed');
  }

  private async processRFF(intent: Intent): Promise<
    | { retry: true }
    | {
      retry: false;
      explorerURL: string;
      intentID: Long;
      requestHash: Hex;
      waitForDoubleCheckTx: () => any;
    }
  > {
    const { msgBasicCosmos, omniversalRFF, signatureData, sources, universes } =
      await createRFFromIntent(intent, this.options, this.params.dstChain.universe);

    this.markStepDone(BRIDGE_STEPS.INTENT_HASH_SIGNED);

    logger.debug('processRFF:3', { msgBasicCosmos });

    const intentID = await cosmosCreateRFF({
      address: this.options.cosmos.address,
      cosmosURL: this.options.networkConfig.COSMOS_URL,
      msg: msgBasicCosmos,
      wallet: this.options.cosmos.wallet,
    });

    const explorerURL = getExplorerURL(this.options.networkConfig.EXPLORER_URL, intentID);
    this.markStepDone(BRIDGE_STEPS.INTENT_SUBMITTED(explorerURL, intentID.toNumber()));

    const tokenCollections: number[] = [];
    for (const [i, s] of sources.entries()) {
      if (!isDeposit(s.universe, s.tokenAddress)) {
        tokenCollections.push(i);
      }
    }

    const evmDeposits: Promise<unknown>[] = [];
    const fuelDeposits: Promise<unknown>[] = [];
    const tronDeposits: Promise<unknown>[] = [];

    const evmSignatureData = signatureData.find((d) => d.universe === Universe.ETHEREUM);

    if (!evmSignatureData && universes.has(Universe.ETHEREUM)) {
      throw Errors.internal('ethereum in universe list but no signature data present');
    }

    const fuelSignatureData = signatureData.find((d) => d.universe === Universe.FUEL);

    if (!fuelSignatureData && universes.has(Universe.FUEL)) {
      throw Errors.internal('fuel in universe list but no signature data present');
    }

    const tronSignatureData = signatureData.find((d) => d.universe === Universe.TRON);

    if (!tronSignatureData && universes.has(Universe.TRON)) {
      throw Errors.internal('tron in universe list but no signature data present');
    }

    const doubleCheckTxs = [];

    for (const [i, s] of sources.entries()) {
      const chain = this.options.chainList.getChainByID(Number(s.chainID));
      if (!chain) {
        throw Errors.chainNotFound(s.chainID);
      }

      if (s.universe === Universe.FUEL) {
        if (!this.options.fuel) {
          throw Errors.internal('fuel is involved but no associated data');
        }

        const account = new Account(
          this.options.fuel.address,
          this.options.fuel.provider,
          this.options.fuel.connector,
        );

        const vault = new ArcanaVault(
          this.options.chainList.getVaultContractAddress(CHAIN_IDS.fuel.mainnet),
          account,
        );

        const tx = await vault.functions
          .deposit(omniversalRFF.asFuelRFF(), hexlify(fuelSignatureData!.signature), i)
          .callParams({
            forward: {
              amount: new BN(s.valueRaw.toString()),
              assetId: s.tokenAddress,
            },
          })
          .call();

        this.markStepDone(BRIDGE_STEPS.INTENT_DEPOSIT_REQUEST(i + 1, s.value, chain));

        fuelDeposits.push(
          (async function () {
            const result = await tx.waitForResult();
            logger.debug('PostIntentSubmission: Fuel deposit result', {
              result,
            });

            if (result.transactionResult.isStatusFailure) {
              throw Errors.fuelDepositFailed(result.transactionResult);
            }
          })(),
        );
      } else if (s.universe === Universe.ETHEREUM && isNativeAddress(s.universe, s.tokenAddress)) {
        await switchChain(this.options.evm.client, chain);

        const publicClient = createPublicClientWithFallback(chain);

        const { request } = await publicClient.simulateContract({
          abi: EVMVaultABI,
          account: this.options.evm.address,
          address: this.options.chainList.getVaultContractAddress(chain.id),
          args: [omniversalRFF.asEVMRFF(), toHex(evmSignatureData!.signature), BigInt(i)],
          chain: chain,
          functionName: 'deposit',
          value: s.valueRaw,
        });
        const hash = await this.options.evm.client.writeContract(request);
        this.markStepDone(BRIDGE_STEPS.INTENT_DEPOSIT_REQUEST(i + 1, s.value, chain));

        evmDeposits.push(waitForTxReceipt(hash, publicClient));
      } else if (s.universe === Universe.TRON) {
        const provider = new TronWeb({
          fullHost: chain.rpcUrls.default.grpc![0],
        });
        const vaultContractAddress = this.options.chainList.getVaultContractAddress(
          Number(s.chainID),
        );
        const txWrap = await provider.transactionBuilder.triggerSmartContract(
          TronWeb.address.fromHex(vaultContractAddress),
          '',
          {
            txLocal: true,
            input: encodeFunctionData({
              abi: EVMVaultABI,
              functionName: 'deposit',
              args: [omniversalRFF.asEVMRFF(), toHex(tronSignatureData!.signature), BigInt(i)],
            }),
          },
          [],
          TronWeb.address.fromHex(this.options.tron!.address),
        );

        const signedTx = await this.options.tron!.adapter.signTransaction(txWrap.transaction);

        logger.debug('tron deposit signTransaction result', {
          signedTx,
        });

        if (!this.options.tron!.adapter.isMobile) {
          const txResult = await provider.trx.sendRawTransaction(signedTx);

          logger.debug('tron deposit tx result', {
            txResult,
          });
          if (!txResult.result) {
            throw Errors.tronDepositFailed(txResult);
          }
        }

        tronDeposits.push(
          (async () => {
            await waitForTronDepositTxConfirmation(
              tronSignatureData!.requestHash,
              vaultContractAddress,
              provider,
              this.options.tron!.address as Hex,
            );
          })(),
        );
      }
      doubleCheckTxs.push(
        createDepositDoubleCheckTx(
          convertTo32Bytes(chain.id),
          this.options.cosmos,
          intentID,
          this.options.networkConfig,
        ),
      );
    }

    if (evmDeposits.length || fuelDeposits.length || tronDeposits.length) {
      await Promise.all([
        Promise.all(evmDeposits),
        Promise.all(tronDeposits),
        Promise.all(fuelDeposits),
      ]);
      this.markStepDone(BRIDGE_STEPS.INTENT_DEPOSITS_CONFIRMED);
    }

    logger.debug('PostIntentSubmission: Intent ID', {
      id: intentID.toNumber(),
    });

    if (tokenCollections.length > 0) {
      logger.debug('processRFF', {
        intentID: intentID.toString(),
        message: 'going to create RFF',
        tokenCollections,
      });
      try {
        await vscCreateRFF(
          this.options.networkConfig.VSC_DOMAIN,
          intentID,
          this.markStepDone,
          tokenCollections,
        );
      } catch (e) {
        logger.debug('vscCreateRFF', {
          'e instanceof NexusError?': e instanceof NexusError,
          error: e,
        });
        if (e instanceof NexusError && e.code === ERROR_CODES.RFF_FEE_EXPIRED) {
          // Send back to process again
          return { retry: true };
        }
        throw e;
      }
    } else {
      logger.debug('processRFF', {
        message: 'going to publish RFF',
      });
      await vscPublishRFF(this.options.networkConfig.VSC_DOMAIN, intentID);
    }

    const destinationSigData = signatureData.find(
      (s) => s.universe === intent.destination.universe,
    );

    if (!destinationSigData) {
      throw Errors.destinationRequestHashNotFound();
    }

    return {
      retry: false,
      explorerURL,
      intentID,
      requestHash: destinationSigData.requestHash,
      waitForDoubleCheckTx: waitForDoubleCheckTx(doubleCheckTxs),
    };
  }

  private async setAllowances(input: Array<SetAllowanceInput>) {
    const originalChain = this.params.dstChain.id;
    logger.debug('setAllowances', { originalChain, input });

    const sponsoredApprovals: SponsoredApprovalDataArray = [];
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

        if (chain.universe == Universe.ETHEREUM) {
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
              TronWeb.address.fromHex(this.options.tron?.address),
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
              provider,
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
              source.amount,
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
            }),
          );

          this.markStepDone(BRIDGE_STEPS.ALLOWANCE_APPROVAL_REQUEST(chain));

          sponsoredApprovals.push({
            address: convertTo32Bytes(account.address),
            chain_id: chainDatum.ChainID32,
            operations: [
              {
                sig_r: hexToBytes(signed.r),
                sig_s: hexToBytes(signed.s),
                sig_v: signed.yParity < 27 ? signed.yParity + 27 : signed.yParity,
                token_address: currency.tokenAddress,
                value: convertTo32Bytes(source.amount),
                variant: currency.permitVariant === PermitVariant.PolygonEMT ? 2 : 1,
              },
            ],
            universe: chainDatum.Universe,
          });
        }
      }

      if (sponsoredApprovals.length) {
        logger.debug('setAllowances:sponsoredApprovals', {
          sponsoredApprovals,
        });
        const approvalHashes = await vscCreateSponsoredApprovals(
          this.options.networkConfig.VSC_DOMAIN,
          sponsoredApprovals,
        );

        await Promise.all(
          approvalHashes.map(async (approval) => {
            const chain = this.options.chainList.getChainByID(approval.chainId);
            if (!chain) {
              throw Errors.chainNotFound(approval.chainId);
            }

            const publicClient = createPublicClientWithFallback(chain);
            await waitForTxReceipt(approval.hash, publicClient);
            BRIDGE_STEPS.ALLOWANCE_APPROVAL_MINED({
              id: approval.chainId,
            });
            return;
          }),
        );
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
    insufficientAllowanceSources?: onAllowanceHookSource[],
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
    feeStore: FeeStore;
    gas: Decimal;
    gasInToken: Decimal;
    sourceChains: number[];
    token: TokenInfo;
  }) {
    const { amount, assets, feeStore, gas, gasInToken, token } = input;
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
      token.contractAddress,
    );

    const borrow = amount;

    const protocolFee = feeStore.calculateProtocolFee(borrow);
    intent.fees.protocol = protocolFee.toFixed();

    let borrowWithFee = borrow.add(gasInToken).add(protocolFee);

    logger.debug('createIntent:0', {
      borrow: borrow.toFixed(),
      borrowWithFee: borrowWithFee.toFixed(),
      destinationBalance,
      gasInToken: gasInToken.toFixed(),
      protocolFee: protocolFee.toFixed(),
    });

    const fulfilmentFee = feeStore.calculateFulfilmentFee({
      decimals: token.decimals,
      destinationChainID: this.params.dstChain.id,
      destinationTokenAddress: token.contractAddress,
    });
    logger.debug('createIntent:1', { fulfilmentFee });

    intent.fees.fulfilment = fulfilmentFee.toFixed();

    borrowWithFee = borrowWithFee.add(fulfilmentFee);

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

      // Now collectionFee is a fixed amount - applicable to all
      const collectionFee = feeStore.calculateCollectionFee({
        decimals: assetC.decimals,
        sourceChainID: assetC.chainID,
        sourceTokenAddress: assetC.tokenContract,
      });

      intent.fees.collection = collectionFee.add(intent.fees.collection).toFixed();
      borrowWithFee = borrowWithFee.add(collectionFee);

      logger.debug('createIntent:2', { collectionFee });

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

      const solverFee = feeStore.calculateSolverFee({
        borrowAmount: borrowFromThisChain,
        decimals: assetC.decimals,
        destinationChainID: this.params.dstChain.id,
        destinationTokenAddress: token.contractAddress,
        sourceChainID: assetC.chainID,
        sourceTokenAddress: assetC.tokenContract,
      });
      intent.fees.solver = solverFee.add(intent.fees.solver).toFixed();

      logger.debug('createIntent:3', { solverFee });

      borrowWithFee = borrowWithFee.add(solverFee);

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
        `required: ${borrowWithFee.toFixed()}, available: ${accountedAmount.toFixed()}`,
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

const isDeposit = (universe: Universe, tokenAddress: Hex) => {
  if (universe === Universe.ETHEREUM) {
    return isNativeAddress(universe, tokenAddress);
  }

  return true;
};

const waitForDoubleCheckTx = (input: Array<() => Promise<void>>) => {
  return async () => {
    await Promise.allSettled(input.map((i) => i()));
  };
};

export default BridgeHandler;
