import {
  ArcanaVault,
  ChaindataMap,
  ERC20ABI,
  EVMVaultABI,
  MsgCreateRequestForFunds,
  OmniversalChainID,
  OmniversalRFF,
  PermitVariant,
  Universe,
} from '@arcana/ca-common';
import Decimal from 'decimal.js';
import { Account, BN, CHAIN_IDS, hexlify } from 'fuels';
import Long from 'long';
import { Hex, hexToBytes, JsonRpcAccount, maxUint256, parseSignature, toBytes, toHex } from 'viem';
import { INTENT_EXPIRY, isNativeAddress } from '../../constants';
import {
  ErrorInsufficientBalance,
  ErrorUserDeniedAllowance,
  ErrorUserDeniedIntent,
} from '../../errors';
import { getLogger } from '../../logger';
import {
  ALLOWANCE_APPROVAL_MINED,
  ALLOWANCE_APPROVAL_REQ,
  ALLOWANCE_COMPLETE,
  createSteps,
  INTENT_ACCEPTED,
  INTENT_DEPOSIT_REQ,
  INTENT_DEPOSITS_CONFIRMED,
  INTENT_FULFILLED,
  INTENT_HASH_SIGNED,
  INTENT_SUBMITTED,
} from '../../steps';
import {
  ChainListType,
  Intent,
  IRequestHandler,
  onAllowanceHookSource,
  RequestHandlerInput,
  SetAllowanceInput,
  SimulateReturnType,
  SponsoredApprovalDataArray,
  Step,
  StepInfo,
  TokenInfo,
} from '@nexus/commons';
import {
  convertGasToToken,
  convertIntent,
  convertTo32Bytes,
  convertTo32BytesHex,
  cosmosCreateRFF,
  createDepositDoubleCheckTx,
  createPublicClientWithFallback,
  createRequestEVMSignature,
  createRequestFuelSignature,
  equalFold,
  FeeStore,
  fetchPriceOracle,
  getAllowances,
  getExplorerURL,
  getFeeStore,
  getSourcesAndDestinationsForRFF,
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
} from '../../utils';
import { getBalances } from 'sdk/ca-base/swap/route';

const logger = getLogger();

abstract class BaseRequest implements IRequestHandler {
  abstract destinationUniverse: Universe;
  protected chainList: ChainListType;
  protected steps: Step[] = [];

  constructor(readonly input: RequestHandlerInput) {
    this.chainList = this.input.chainList;
  }

  buildIntent = async (sourceChains: number[] = []) => {
    console.time('process:preIntentSteps');

    console.time('preIntentSteps:API');
    const [simulation, [balances, oraclePrices, feeStore]] = await Promise.all([
      this.simulateTx(),
      Promise.all([
        getBalances({
          networkHint: this.input.options.networkConfig.NETWORK_HINT,
          vscDomain: this.input.options.networkConfig.VSC_DOMAIN,
          evmAddress: this.input.evm.address,
          chainList: this.chainList,
          fuelAddress: this.input.fuel?.address,
          isCA: true,
        }),
        fetchPriceOracle(this.input.options.networkConfig.GRPC_URL),
        getFeeStore(this.input.options.networkConfig.GRPC_URL),
      ]),
    ]);

    // if simulation is null, then the transaction is not a supported token transfer, so skip
    if (!simulation) {
      return;
    }

    console.timeEnd('preIntentSteps:API');
    logger.debug('Step 1:', {
      balances,
      feeStore,
      oraclePrices,
      simulation,
    });

    console.time('preIntentSteps: Parse');

    const { assets } = balances;
    // Step 2: parse simulation results

    const userAssets = new UserAssets(assets);
    const { amount, gas, isIntentRequired } = this.parseSimulation({
      assets: userAssets,
      simulation,
    });

    console.timeEnd('preIntentSteps: Parse');
    if (!isIntentRequired) {
      return;
    }
    console.time('preIntentSteps: CalculateGas');

    const gasInToken = convertGasToToken(
      simulation.token,
      oraclePrices,
      this.input.chain.id,
      this.input.chain.universe,
      gas,
    );
    console.timeEnd('preIntentSteps: CalculateGas');

    logger.debug('preIntent:1', {
      gasInNative: gas.toFixed(),
      gasInToken: gasInToken.toFixed(),
    });

    // Step 4: create intent
    console.time('preIntentSteps: CreateIntent');
    const intent = this.createIntent({
      amount,
      assets: userAssets,
      feeStore,
      gas,
      gasInToken,
      sourceChains,
      token: simulation.token,
    });
    console.timeEnd('preIntentSteps: CreateIntent');
    console.timeEnd('process:preIntentSteps');

    if (intent.isAvailableBalanceInsufficient) {
      throw ErrorInsufficientBalance;
    }

    return { intent, token: simulation.token };
  };

  getUnallowedSources(intent: Intent, allowances: Awaited<ReturnType<typeof getAllowances>>) {
    const sources: onAllowanceHookSource[] = [];
    for (const s of intent.sources) {
      if (
        s.chainID === intent.destination.chainID ||
        isNativeAddress(s.universe, s.tokenContract)
      ) {
        continue;
      }

      const chain = this.chainList.getChainByID(s.chainID);
      if (!chain) {
        throw new Error('chain is not supported');
      }

      const token = this.chainList.getTokenByAddress(s.chainID, s.tokenContract);
      if (!token) {
        throw new Error('token is not supported');
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
            current: currentAllowance.toString(),
            minimum: requiredAllowance.toString(),
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

  abstract parseSimulation(input: { assets: UserAssets; simulation: SimulateReturnType }): {
    amount: Decimal;
    gas: Decimal;
    isIntentRequired: boolean;
  };

  process = async () => {
    const i = await this.buildIntent(this.input.options.sourceChains);
    if (!i) {
      return;
    }
    let intent = i.intent;
    const token = i.token;

    if (intent.isAvailableBalanceInsufficient) {
      throw ErrorInsufficientBalance;
    }

    // Create steps like a crazy person to create another one again
    const allowances = await getAllowances(
      intent.allSources,
      this.input.evm.address,
      this.input.chainList,
    );

    let unallowedSources = this.getUnallowedSources(intent, allowances);
    this.createExpectedSteps(intent, unallowedSources);

    let accepted = false;
    const refresh = async (sourceChains?: number[]) => {
      if (accepted) {
        logger.warn('Intent refresh called after acceptance');
        return convertIntent(intent, token, this.chainList);
      }
      const i = await this.buildIntent(sourceChains);
      intent = i!.intent;
      logger.debug('in refresh', {
        i,
        intent,
      });
      if (intent.isAvailableBalanceInsufficient) {
        throw ErrorInsufficientBalance;
      }
      unallowedSources = this.getUnallowedSources(intent, allowances);
      this.createExpectedSteps(intent, unallowedSources);

      return convertIntent(intent, token, this.chainList);
    };

    // wait for intent acceptance hook
    await new Promise((resolve, reject) => {
      const allow = () => {
        accepted = true;
        return resolve('User allowed intent');
      };

      const deny = () => {
        return reject(ErrorUserDeniedIntent);
      };

      this.input.hooks.onIntent({
        allow,
        deny,
        intent: convertIntent(intent, token, this.chainList),
        refresh,
      });
    });

    this.markStepDone(INTENT_ACCEPTED);

    console.time('process:AllowanceHook');

    // Step 5: set allowance if not set
    await this.waitForOnAllowanceHook(unallowedSources);
    console.timeEnd('process:AllowanceHook');

    // FIXME: Add showing intent again if prices change?
    // Step 6: process intent
    return await this.processIntent(intent);
  };

  async processIntent(intent: Intent) {
    logger.debug('intent', { intent });

    const { explorerURL, id, requestHash, waitForDoubleCheckTx } = await this.processRFF(intent);

    storeIntentHashToStore(this.input.evm.address, id.toNumber());
    await this.waitForFill(requestHash, id, waitForDoubleCheckTx);
    removeIntentHashFromStore(this.input.evm.address, id);

    this.markStepDone(INTENT_FULFILLED);
    return { explorerURL };
  }

  async processRFF(intent: Intent) {
    const { destinations, sources, universes } = getSourcesAndDestinationsForRFF(
      intent,
      this.input.chainList,
      this.destinationUniverse,
    );

    const parties: Array<{ address: string; universe: Universe }> = [];
    for (const universe of universes) {
      if (universe === Universe.ETHEREUM) {
        parties.push({
          address: convertTo32BytesHex(this.input.evm.address),
          universe: universe,
        });
      }

      if (universe === Universe.FUEL) {
        parties.push({
          address: convertTo32BytesHex(this.input.fuel!.address as Hex),
          universe,
        });
      }
    }

    logger.debug('processRFF:1', {
      destinations,
      parties,
      sources,
      universes,
    });

    const omniversalRff = new OmniversalRFF({
      destinationChainID: convertTo32Bytes(intent.destination.chainID),
      destinations: destinations.map((dest) => ({
        tokenAddress: toBytes(dest.tokenAddress),
        value: toBytes(dest.value),
      })),
      destinationUniverse: intent.destination.universe,
      expiry: Long.fromString((BigInt(Date.now() + INTENT_EXPIRY) / 1000n).toString()),
      nonce: window.crypto.getRandomValues(new Uint8Array(32)),
      // @ts-ignore
      signatureData: parties.map((p) => ({
        address: toBytes(p.address),
        universe: p.universe,
      })),
      // @ts-ignore
      sources: sources.map((source) => ({
        chainID: convertTo32Bytes(source.chainID),
        tokenAddress: convertTo32Bytes(source.tokenAddress),
        universe: source.universe,
        value: toBytes(source.value),
      })),
    });

    const signatureData: {
      address: Uint8Array;
      requestHash: `0x${string}`;
      signature: Uint8Array;
      universe: Universe;
    }[] = [];

    for (const universe of universes) {
      if (universe === Universe.ETHEREUM) {
        const { requestHash, signature } = await createRequestEVMSignature(
          omniversalRff.asEVMRFF(),
          this.input.evm.address,
          this.input.evm.client,
        );

        signatureData.push({
          address: convertTo32Bytes(this.input.evm.address),
          requestHash,
          signature,
          universe: Universe.ETHEREUM,
        });
      }

      if (universe === Universe.FUEL) {
        if (
          !this.input.fuel?.address ||
          !this.input.fuel?.provider ||
          !this.input.fuel?.connector
        ) {
          logger.error('universe has fuel but not expected input', {
            fuelInput: this.input.fuel,
          });
          throw new Error('universe has fuel but not expected input');
        }

        const { requestHash, signature } = await createRequestFuelSignature(
          this.input.chainList.getVaultContractAddress(CHAIN_IDS.fuel.mainnet),
          this.input.fuel.provider,
          this.input.fuel.connector,
          omniversalRff.asFuelRFF(),
        );
        signatureData.push({
          address: toBytes(this.input.fuel.address),
          requestHash,
          signature,
          universe: Universe.FUEL,
        });
      }
    }

    logger.debug('processRFF:2', { omniversalRff, signatureData });

    this.markStepDone(INTENT_HASH_SIGNED);

    const cosmosWalletAddress = (await this.input.cosmosWallet.getAccounts())[0].address;

    const msgBasicCosmos = MsgCreateRequestForFunds.create({
      destinationChainID: omniversalRff.protobufRFF.destinationChainID,
      destinations: omniversalRff.protobufRFF.destinations,
      destinationUniverse: omniversalRff.protobufRFF.destinationUniverse,
      expiry: omniversalRff.protobufRFF.expiry,
      nonce: omniversalRff.protobufRFF.nonce,
      signatureData: signatureData.map((s) => ({
        address: s.address,
        signature: s.signature,
        universe: s.universe,
      })),
      sources: omniversalRff.protobufRFF.sources,
      user: cosmosWalletAddress,
    });

    logger.debug('processRFF:3', { msgBasicCosmos });

    const intentID = await cosmosCreateRFF({
      address: cosmosWalletAddress,
      cosmosURL: this.input.options.networkConfig.COSMOS_URL,
      msg: msgBasicCosmos,
      wallet: this.input.cosmosWallet,
    });

    const explorerURL = getExplorerURL(this.input.options.networkConfig.EXPLORER_URL, intentID);
    this.markStepDone(INTENT_SUBMITTED, {
      explorerURL,
      intentID: intentID.toNumber(),
    });

    const tokenCollections = [];
    for (const [i, s] of sources.entries()) {
      if (!isNativeAddress(s.universe, s.tokenAddress)) {
        tokenCollections.push(i);
      }
    }

    const evmDeposits: Promise<void>[] = [];
    const fuelDeposits: Promise<void>[] = [];

    const evmSignatureData = signatureData.find((d) => d.universe === Universe.ETHEREUM);

    if (!evmSignatureData && universes.has(Universe.ETHEREUM)) {
      throw new Error('ethereum in universe list but no signature data present');
    }

    const fuelSignatureData = signatureData.find((d) => d.universe === Universe.FUEL);

    if (!fuelSignatureData && universes.has(Universe.FUEL)) {
      throw new Error('fuel in universe list but no signature data present');
    }

    const doubleCheckTxs = [];

    for (const [i, s] of sources.entries()) {
      const chain = this.input.chainList.getChainByID(Number(s.chainID));
      if (!chain) {
        throw new Error('chain not found');
      }

      if (s.universe === Universe.FUEL) {
        if (!this.input.fuel) {
          throw new Error('fuel is involved but no associated data');
        }

        const account = new Account(
          this.input.fuel.address,
          this.input.fuel.provider,
          this.input.fuel.connector,
        );

        const vault = new ArcanaVault(
          this.chainList.getVaultContractAddress(CHAIN_IDS.fuel.mainnet),
          account,
        );

        const tx = await vault.functions
          .deposit(omniversalRff.asFuelRFF(), hexlify(fuelSignatureData!.signature), i)
          .callParams({
            forward: {
              amount: new BN(s.value.toString()),
              assetId: s.tokenAddress,
            },
          })
          .call();

        this.markStepDone(INTENT_DEPOSIT_REQ(i + 1));

        fuelDeposits.push(
          (async function () {
            const txResult = await tx.waitForResult();
            logger.debug('PostIntentSubmission: Fuel deposit result', {
              txResult,
            });

            if (txResult.transactionResult.isStatusFailure) {
              throw new Error('fuel deposit failed');
            }
          })(),
        );
      } else if (s.universe === Universe.ETHEREUM && isNativeAddress(s.universe, s.tokenAddress)) {
        const chain = this.input.chainList.getChainByID(Number(s.chainID));
        if (!chain) {
          throw new Error('chain not found');
        }

        await switchChain(this.input.evm.client, chain);

        const publicClient = createPublicClientWithFallback(chain);

        const { request } = await publicClient.simulateContract({
          abi: EVMVaultABI,
          account: this.input.evm.address,
          address: this.input.chainList.getVaultContractAddress(chain.id),
          args: [omniversalRff.asEVMRFF(), toHex(evmSignatureData!.signature), BigInt(i)],
          chain: chain,
          functionName: 'deposit',
          value: s.value,
        });
        const hash = await this.input.evm.client.writeContract(request);
        this.markStepDone(INTENT_DEPOSIT_REQ(i + 1));

        evmDeposits.push(waitForTxReceipt(hash, publicClient));
      }
      doubleCheckTxs.push(
        createDepositDoubleCheckTx(
          convertTo32Bytes(chain.id),
          {
            address: cosmosWalletAddress,
            wallet: this.input.cosmosWallet,
          },
          intentID,
          this.input.options.networkConfig,
        ),
      );
    }

    if (evmDeposits.length || fuelDeposits.length) {
      await Promise.all([Promise.all(evmDeposits), Promise.all(fuelDeposits)]);
      this.markStepDone(INTENT_DEPOSITS_CONFIRMED);
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
      await vscCreateRFF(
        this.input.options.networkConfig.VSC_DOMAIN,
        intentID,
        this.markStepDone,
        tokenCollections,
      );
    } else {
      logger.debug('processRFF', {
        message: 'going to publish RFF',
      });
      await vscPublishRFF(this.input.options.networkConfig.VSC_DOMAIN, intentID);
    }

    const destinationSigData = signatureData.find(
      (s) => s.universe === intent.destination.universe,
    );

    if (!destinationSigData) {
      throw new Error('requestHash not found for destination');
    }

    return {
      explorerURL,
      id: intentID,
      requestHash: destinationSigData.requestHash,
      waitForDoubleCheckTx: waitForDoubleCheckTx(doubleCheckTxs),
    };
  }

  async setAllowances(input: Array<SetAllowanceInput>) {
    const originalChain = this.input.chain.id;
    logger.debug('setAllowances', { originalChain });

    const sponsoredApprovalParams: SponsoredApprovalDataArray = [];
    try {
      for (const source of input) {
        logger.debug('setAllowances', { originalChain });
        const chain = this.chainList.getChainByID(source.chainID);
        if (!chain) {
          throw new Error('chain not supported');
        }

        const publicClient = createPublicClientWithFallback(chain);

        const vc = this.input.chainList.getVaultContractAddress(chain.id);

        const chainId = new OmniversalChainID(Universe.ETHEREUM, source.chainID);
        const chainDatum = ChaindataMap.get(chainId);
        if (!chainDatum) {
          throw new Error('Chain data not found');
        }
        const currency = chainDatum.CurrencyMap.get(convertTo32Bytes(source.tokenContract));
        if (!currency) {
          throw new Error('Currency not found');
        }
        logger.info('setAllowances switching to ', { chain });
        await switchChain(this.input.evm.client, chain);
        logger.info('setAllowances switched to ', {
          originalChain,
          switchedTo: await this.input.evm.client?.getChainId(),
          chain,
        });
        if (currency.permitVariant === PermitVariant.Unsupported) {
          const h = await this.input.evm.client.writeContract({
            abi: ERC20ABI,
            account: this.input.evm.address,
            address: source.tokenContract,
            args: [vc, BigInt(source.amount)],
            chain,
            functionName: 'approve',
          });

          this.markStepDone(ALLOWANCE_APPROVAL_REQ(source.chainID));

          await publicClient.waitForTransactionReceipt({
            hash: h,
          });

          this.markStepDone(ALLOWANCE_APPROVAL_MINED(source.chainID));
        } else {
          const account: JsonRpcAccount = {
            address: this.input.evm.address,
            type: 'json-rpc',
          };

          const signed = parseSignature(
            await signPermitForAddressAndValue(
              currency,
              this.input.evm.client,
              publicClient,
              account,
              vc,
              source.amount,
            ),
          );

          this.markStepDone(ALLOWANCE_APPROVAL_REQ(source.chainID));

          sponsoredApprovalParams.push({
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

      if (sponsoredApprovalParams.length) {
        logger.debug('setAllowances:sponsoredApprovals', {
          sponsoredApprovalParams,
        });
        await vscCreateSponsoredApprovals(
          this.input.options.networkConfig.VSC_DOMAIN,
          sponsoredApprovalParams,
          this.markStepDone,
        );
      }
    } catch (e) {
      console.error('Error setting allowances', e);
      throw ErrorUserDeniedAllowance;
    } finally {
      if (this.input.chain.universe === Universe.ETHEREUM) {
        await switchChain(this.input.evm.client, this.input.chain);
      }
      this.markStepDone(ALLOWANCE_COMPLETE);
    }
  }

  abstract simulateTx(): Promise<undefined | SimulateReturnType>;

  abstract waitForFill(
    requestHash: `0x${string}`,
    intentID: Long,
    waitForDoubleCheckTx: () => Promise<void>,
  ): Promise<void>;

  async waitForOnAllowanceHook(sources: onAllowanceHookSource[]): Promise<boolean> {
    if (sources.length === 0) {
      return false;
    }

    await new Promise((resolve, reject) => {
      const allow = (allowances: Array<'max' | 'min' | bigint | string>) => {
        if (sources.length !== allowances.length) {
          return reject(
            new Error(
              `invalid input length for allow(). expected: ${sources.length} got: ${allowances.length}`,
            ),
          );
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
            amount = BigInt(source.allowance.minimum);
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
        return reject(ErrorUserDeniedAllowance);
      };

      this.input.hooks.onAllowance({
        allow,
        deny,
        sources,
      });
    });
    return true;
  }

  protected createExpectedSteps(intent: Intent, unallowedSources?: onAllowanceHookSource[]) {
    this.steps = createSteps(intent, this.chainList, unallowedSources);

    this.input.options.emit('expected_steps', this.steps);
    logger.debug('ExpectedSteps', this.steps);
  }

  protected createIntent(input: {
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
        chainID: this.input.chain.id,
        decimals: token.decimals,
        gas: 0n,
        tokenContract: token.contractAddress,
        universe: this.destinationUniverse,
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
    };

    const asset = assets.find(token.symbol);
    if (!asset) {
      throw new Error(`Asset ${token.symbol} not found in UserAssets`);
    }

    const allSources = asset.iterate(feeStore).map((v) => ({ ...v, amount: v.balance }));

    intent.allSources = allSources;

    const destinationBalance = asset.getBalanceOnChain(this.input.chain.id, token.contractAddress);

    let borrow = new Decimal(0);
    if (this.input.options.bridge) {
      borrow = amount;
    } else {
      if (amount.greaterThan(destinationBalance)) {
        borrow = amount.minus(destinationBalance);
      }
      if (destinationBalance !== '0') {
        intent.sources.push({
          amount: amount.greaterThan(destinationBalance) ? new Decimal(destinationBalance) : amount,
          chainID: this.input.chain.id,
          tokenContract: token.contractAddress,
          universe: this.destinationUniverse,
        });
      }
    }

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
      destinationChainID: this.input.chain.id,
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

      if (assetC.chainID === this.input.chain.id) {
        continue;
      }

      if (assetC.chainID === CHAIN_IDS.fuel.mainnet) {
        const fuelChain = this.chainList.getChainByID(CHAIN_IDS.fuel.mainnet);
        const baseAssetBalanceOnFuel = assets.getNativeBalance(fuelChain!);
        if (new Decimal(baseAssetBalanceOnFuel).lessThan('0.000_003')) {
          logger.debug('fuel base asset balance is lesser than min expected deposit fee, so skip', {
            current: baseAssetBalanceOnFuel,
            minimum: '0.000_003',
          });
          continue;
        }
      }

      if (!isNativeAddress(assetC.universe, assetC.tokenContract)) {
        const collectionFee = feeStore.calculateCollectionFee({
          decimals: assetC.decimals,
          sourceChainID: assetC.chainID,
          sourceTokenAddress: assetC.tokenContract,
        });

        intent.fees.collection = collectionFee.add(intent.fees.collection).toFixed();

        borrowWithFee = borrowWithFee.add(collectionFee);

        logger.debug('createIntent:2', { collectionFee });
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

      const solverFee = feeStore.calculateSolverFee({
        borrowAmount: borrowFromThisChain,
        decimals: assetC.decimals,
        destinationChainID: this.input.chain.id,
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
      });

      accountedAmount = accountedAmount.add(borrowFromThisChain);
    }

    intent.destination.amount = borrow;

    if (accountedAmount.lt(borrowWithFee)) {
      intent.isAvailableBalanceInsufficient = true;
    }

    if (!gas.equals(0)) {
      intent.destination.gas = mulDecimals(gas, this.input.chain.nativeCurrency.decimals);
    }

    logger.debug('createIntent:4', { intent });

    return intent;
  }

  protected markStepDone = (step: StepInfo, data?: { [k: string]: unknown }) => {
    const s = this.steps.find((s) => s.typeID === step.typeID);
    if (s) {
      this.input.options.emit('step_complete', {
        ...s,
        ...(data ? { data } : {}),
      });
    }
  };
}

const waitForDoubleCheckTx = (input: Array<() => Promise<void>>) => {
  return async () => {
    await Promise.allSettled(input.map((i) => i()));
  };
};

export default BaseRequest;
