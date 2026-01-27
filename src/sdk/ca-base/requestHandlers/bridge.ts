import { ChaindataMap, OmniversalChainID, PermitVariant, Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import {
  ContractFunctionExecutionError,
  Hex,
  hexToBytes,
  JsonRpcAccount,
  maxUint256,
  parseSignature,
  UserRejectedRequestError,
} from 'viem';
import { isNativeAddress } from '../constants';
import { createSteps } from '../steps';
import {
  Intent,
  onAllowanceHookSource,
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
  createPublicClientWithFallback,
  FeeStore,
  fetchPriceOracle,
  getAllowances,
  getFeeStore,
  mulDecimals,
  signPermitForAddressAndValue,
  switchChain,
  UserAssets,
  divDecimals,
  retrieveAddress,
  getBalances,
  createV2RequestFromIntent,
  getStatekeeperClient,
} from '../utils';
import { submitRffToMiddleware, createApprovalsViaMiddleware } from '../utils/middleware.utils';
import type { V2MiddlewareRffPayload, V2ApprovalsByChain } from '../../../commons';
import { Errors } from '../errors';

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
    readonly options: IBridgeOptions,
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
    console.time('process:preIntentSteps');

    console.time('preIntentSteps:API');
    const [balances, oraclePrices, feeStore] = await Promise.all([
      getBalances({
        networkHint: this.options.networkConfig.NETWORK_HINT,
        vscDomain: this.options.networkConfig.VSC_DOMAIN,
        evmAddress: this.options.evm.address,
        chainList: this.options.chainList,
        tronAddress: this.options.tron?.address,
        isCA: true,
        useV2Middleware: this.options.networkConfig.useV2Middleware,
        middlewareUrl: this.options.networkConfig.MIDDLEWARE_URL,
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

  /**
   * Execute bridge via middleware
   * This is the main execution path that uses the V2 middleware for approvals and RFF submission
   */
  public execute = async (): Promise<{ explorerURL: string; requestHash: Hex }> => {
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

    // Step 5: Create approvals via middleware
    await this.createApprovalsViaMiddleware(intent);

    // Step 6: Submit intent via middleware
    const requestHash = await this.processRFFv2Middleware(intent, this.markStepDone);

    const explorerURL = `${this.options.networkConfig.EXPLORER_URL}/rff/${requestHash}`;
    this.markStepDone(BRIDGE_STEPS.INTENT_SUBMITTED(explorerURL, 0));

    // Mark collection as complete - middleware handles this internally
    this.markStepDone(BRIDGE_STEPS.INTENT_COLLECTION_COMPLETE);

    // Step 7: Wait for fill using v2 polling
    await this.waitForFillV2(requestHash);

    this.markStepDone(BRIDGE_STEPS.INTENT_FULFILLED);

    if (this.params.dstChain.universe === Universe.ETHEREUM) {
      await switchChain(this.options.evm.client, this.params.dstChain);
    }

    return { explorerURL, requestHash };
  };

  /**
   * Process RFF using v2 Middleware
   * This submits RFFs via the middleware instead of directly to statekeeper
   */
  private async processRFFv2Middleware(
    intent: Intent,
    msd: (step: BridgeStepType) => void,
  ): Promise<Hex> {
    console.log('[NEXUS-SDK] processRFFv2Middleware: Creating RFF request from intent...');
    const { request, signature } = await createV2RequestFromIntent(
      intent,
      this.options,
      this.params.dstChain.universe,
    );

    console.log('[NEXUS-SDK] processRFFv2Middleware: RFF request created, signing...');
    msd(BRIDGE_STEPS.INTENT_HASH_SIGNED);

    const payload: V2MiddlewareRffPayload = { request, signature };
    console.log('[NEXUS-SDK] processRFFv2Middleware: Submitting RFF to middleware...');
    const response = await submitRffToMiddleware(
      this.options.networkConfig.MIDDLEWARE_URL,
      payload,
    );

    console.log('[NEXUS-SDK] ========================================');
    console.log('[NEXUS-SDK] RFF SUBMITTED SUCCESSFULLY');
    console.log('[NEXUS-SDK] Request Hash:', response.request_hash);
    console.log('[NEXUS-SDK] ========================================');

    logger.debug('processRFFv2Middleware', { requestHash: response.request_hash });
    return response.request_hash;
  }

  /**
   * Convert internal sponsored approval format to middleware format
   */
  private convertToMiddlewareApprovals(
    sponsoredApprovals: SponsoredApprovalDataArray,
  ): V2ApprovalsByChain {
    const result: V2ApprovalsByChain = {};

    for (const approval of sponsoredApprovals) {
      const chainId = Number(
        BigInt(
          '0x' +
            Array.from(approval.chain_id)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join(''),
        ),
      );
      const address = `0x${Array.from(approval.address)
        .slice(-20)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}` as Hex;

      if (!result[chainId]) {
        result[chainId] = [];
      }

      const ops = approval.operations.map((op) => ({
        tokenAddress: `0x${Array.from(op.token_address)
          .slice(-20)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')}` as Hex,
        variant: op.variant as 1 | 2,
        value: op.value
          ? (`0x${Array.from(op.value)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')}` as Hex)
          : null,
        signature: {
          v: op.sig_v,
          r: `0x${Array.from(op.sig_r)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')}` as Hex,
          s: `0x${Array.from(op.sig_s)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')}` as Hex,
        },
      }));

      result[chainId].push({ address, ops });
    }

    return result;
  }

  /**
   * Create approvals via middleware
   */
  private async createApprovalsViaMiddleware(intent: Intent) {
    console.log('[NEXUS-SDK] createApprovalsViaMiddleware - intent.sources:', intent.sources);
    const sponsoredApprovals = await this.buildSponsoredApprovals(intent);
    console.log('[NEXUS-SDK] sponsoredApprovals built:', sponsoredApprovals.length, 'items');
    const middlewareApprovals = this.convertToMiddlewareApprovals(sponsoredApprovals);
    console.log('[NEXUS-SDK] middlewareApprovals:', JSON.stringify(middlewareApprovals));

    // If no approvals needed, skip the WebSocket call
    if (Object.keys(middlewareApprovals).length === 0) {
      console.log('[NEXUS-SDK] No approvals needed, skipping middleware call');
      return [];
    }

    const results = await createApprovalsViaMiddleware(
      this.options.networkConfig.MIDDLEWARE_URL,
      middlewareApprovals,
    );

    for (const result of results) {
      if (result.errored) {
        throw Errors.internal(`Approval failed on chain ${result.chainId}: ${result.message}`);
      }
    }

    return results.map((r) => ({ chainId: r.chainId, hash: r.txHash! }));
  }

  /**
   * Build sponsored approvals from intent
   */
  private async buildSponsoredApprovals(intent: Intent): Promise<SponsoredApprovalDataArray> {
    console.log('[NEXUS-SDK] buildSponsoredApprovals - sources:', intent.sources.length);
    console.log('[NEXUS-SDK] destination chainID:', intent.destination.chainID);

    // Get all allowances at once to check against
    const allowances = await getAllowances(intent.allSources, this.options.chainList);
    console.log('[NEXUS-SDK] allowances:', allowances);
    const sponsoredApprovals: SponsoredApprovalDataArray = [];

    for (const source of intent.sources) {
      console.log('[NEXUS-SDK] Processing source:', {
        chainID: source.chainID,
        tokenContract: source.tokenContract,
        amount: source.amount.toString(),
      });

      if (source.chainID === intent.destination.chainID) {
        console.log('[NEXUS-SDK] Skipping: source is destination chain');
        continue;
      }

      if (isNativeAddress(source.universe, source.tokenContract)) {
        console.log('[NEXUS-SDK] Skipping: native token');
        continue;
      }

      const chain = this.options.chainList.getChainByID(source.chainID);
      if (!chain) {
        throw Errors.chainNotFound(source.chainID);
      }

      const token = this.options.chainList.getTokenByAddress(source.chainID, source.tokenContract);
      if (!token) {
        throw Errors.tokenNotSupported(source.tokenContract, source.chainID);
      }

      // --- Start of new allowance check ---
      const requiredAllowance = mulDecimals(source.amount, token.decimals);
      const currentAllowance = allowances[source.chainID] ?? 0n;

      console.log('[NEXUS-SDK] Allowance check:', {
        chainId: chain.id,
        token: token.symbol,
        requiredAllowance: requiredAllowance.toString(),
        currentAllowance: currentAllowance.toString(),
        needsApproval: requiredAllowance > currentAllowance,
      });

      if (requiredAllowance <= currentAllowance) {
        console.log('[NEXUS-SDK] Skipping: allowance already sufficient');
        logger.debug(
          `Allowance sufficient for ${token.symbol} on chain ${chain.id}, skipping approval.`,
        );
        continue; // Skip this source if allowance is already sufficient
      }
      // --- End of new allowance check ---

      const publicClient = createPublicClientWithFallback(chain);
      const vc = this.options.chainList.getVaultContractAddress(chain.id);

      const chainId = new OmniversalChainID(chain.universe, source.chainID);
      console.log('[NEXUS-SDK] Looking up chainDatum for:', {
        universe: chain.universe,
        chainID: source.chainID,
      });
      const chainDatum = ChaindataMap.get(chainId);
      if (!chainDatum) {
        console.log('[NEXUS-SDK] ERROR: Chain data not found in ChaindataMap');
        throw Errors.internal('Chain data not found', {
          chainId: source.chainID,
          universe: chain.universe,
        });
      }
      console.log(
        '[NEXUS-SDK] chainDatum found, looking up currency for:',
        convertTo32Bytes(source.tokenContract),
      );

      const currency = chainDatum.CurrencyMap.get(convertTo32Bytes(source.tokenContract));
      if (!currency) {
        console.log('[NEXUS-SDK] ERROR: Currency not found in CurrencyMap');
        throw Errors.internal('currency not found', {
          chainId: source.chainID,
          tokenContractAddress: source.tokenContract,
        });
      }

      // Only create permit-based approvals for middleware
      console.log('[NEXUS-SDK] Permit check:', {
        chainId: chain.id,
        tokenSymbol: token.symbol,
        permitVariant: currency.permitVariant,
        permitVariantName: PermitVariant[currency.permitVariant],
        isUnsupported: currency.permitVariant === PermitVariant.Unsupported,
        isEthMainnet: chain.id === 1,
        willCreatePermit: currency.permitVariant !== PermitVariant.Unsupported && chain.id !== 1,
      });

      if (currency.permitVariant !== PermitVariant.Unsupported && chain.id !== 1) {
        console.log('[NEXUS-SDK] Creating permit for chain', chain.id);
        if (chain.universe === Universe.ETHEREUM) {
          console.log('[NEXUS-SDK] Switching chain to', chain.id);
          await switchChain(this.options.evm.client, chain);
        }

        const account: JsonRpcAccount = {
          address: this.options.evm.address,
          type: 'json-rpc',
        };

        console.log('[NEXUS-SDK] Signing permit for:', {
          account: account.address,
          spender: vc,
          value: 'maxUint256',
        });

        const signed = parseSignature(
          await signPermitForAddressAndValue(
            currency,
            this.options.evm.client,
            publicClient,
            account,
            vc,
            maxUint256,
          ).catch((e) => {
            console.log('[NEXUS-SDK] signPermitForAddressAndValue error:', e);
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

        console.log('[NEXUS-SDK] Permit signed successfully:', {
          r: signed.r,
          s: signed.s,
          yParity: signed.yParity,
        });

        this.markStepDone(BRIDGE_STEPS.ALLOWANCE_APPROVAL_REQUEST(chain));

        console.log('[NEXUS-SDK] Adding sponsored approval for chain', chain.id);
        sponsoredApprovals.push({
          address: convertTo32Bytes(account.address),
          chain_id: chainDatum.ChainID32,
          operations: [
            {
              sig_r: hexToBytes(signed.r),
              sig_s: hexToBytes(signed.s),
              sig_v: signed.yParity < 27 ? signed.yParity + 27 : signed.yParity,
              token_address: currency.tokenAddress,
              value: convertTo32Bytes(maxUint256),
              variant: currency.permitVariant === PermitVariant.PolygonEMT ? 2 : 1,
            },
          ],
          universe: chainDatum.Universe,
        });
      } else {
        console.log('[NEXUS-SDK] Skipping permit: unsupported or Ethereum mainnet');
      }
    }

    console.log(
      '[NEXUS-SDK] buildSponsoredApprovals complete:',
      sponsoredApprovals.length,
      'approvals',
    );
    return sponsoredApprovals;
  }

  /**
   * Wait for RFF fulfillment using v2 Statekeeper API
   */
  private async waitForFillV2(requestHash: Hex): Promise<void> {
    const statekeeperClient = getStatekeeperClient(this.options.networkConfig.STATEKEEPER_URL);

    console.log('[NEXUS-SDK] ========================================');
    console.log('[NEXUS-SDK] WAITING FOR RFF FULFILLMENT');
    console.log('[NEXUS-SDK] Request Hash:', requestHash);
    console.log('[NEXUS-SDK] Statekeeper URL:', this.options.networkConfig.STATEKEEPER_URL);
    console.log('[NEXUS-SDK] ========================================');

    logger.debug('waitForFillV2: Waiting for fulfillment', { requestHash });

    // Poll statekeeper until RFF is fulfilled or expired
    const rff = await statekeeperClient.waitForStatus(
      requestHash,
      ['fulfilled', 'expired'],
      5 * 60 * 1000, // 5 minute timeout
      2000, // Poll every 2 seconds
    );

    if (rff.status === 'expired') {
      console.log('[NEXUS-SDK] RFF EXPIRED:', requestHash);
      throw Errors.internal(`RFF ${requestHash} expired before fulfillment`);
    }

    console.log('[NEXUS-SDK] ========================================');
    console.log('[NEXUS-SDK] RFF FULFILLED!');
    console.log('[NEXUS-SDK] Request Hash:', requestHash);
    console.log('[NEXUS-SDK] Final Status:', rff.status);
    console.log('[NEXUS-SDK] ========================================');

    logger.debug('waitForFillV2: RFF fulfilled', { requestHash, rff });
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
    console.log('[NEXUS-SDK] createIntent: allowedSources count:', allowedSources.length);
    console.log('[NEXUS-SDK] createIntent: sourceChains filter:', input.sourceChains);
    console.log('[NEXUS-SDK] createIntent: destination chainId:', this.params.dstChain.id);

    for (const assetC of allowedSources) {
      console.log('[NEXUS-SDK] createIntent: processing asset:', {
        chainID: assetC.chainID,
        balance: assetC.balance,
        tokenContract: assetC.tokenContract,
      });
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

      console.log('[NEXUS-SDK] createIntent: ADDING source to intent:', {
        chainID: assetC.chainID,
        amount: borrowFromThisChain.toFixed(),
        tokenContract: assetC.tokenContract,
      });

      intent.sources.push({
        amount: borrowFromThisChain,
        chainID: assetC.chainID,
        tokenContract: assetC.tokenContract,
        universe: assetC.universe,
        holderAddress: assetC.holderAddress,
      });

      accountedAmount = accountedAmount.add(borrowFromThisChain);
    }

    console.log('[NEXUS-SDK] createIntent: final sources count:', intent.sources.length);

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

export default BridgeHandler;
