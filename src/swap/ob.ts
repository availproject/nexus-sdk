import {
  type Aggregator,
  type Bytes,
  ChaindataMap,
  type CurrencyID,
  liquidateSourceHoldings,
  OmniversalChainID,
  type Quote,
  Universe,
} from '@avail-project/ca-common';
import type { SigningStargateClient } from '@cosmjs/stargate';
import Decimal from 'decimal.js';
import { orderBy, retry } from 'es-toolkit';
import Long from 'long';
import type { Hex, PrivateKeyAccount, WalletClient } from 'viem';
import {
  type BridgeAsset,
  type ChainListType,
  type EoaToEphemeralCallMap,
  getLogger,
  type QueryClients,
  type RFFDepositCallMap,
  type SBCTx,
  type SourceExecution,
  SWAP_STEPS,
  type SwapStepType,
  type Tx,
} from '../commons';
import { Errors } from '../core/errors';
import { divDecimals, equalFold, minutesToMs, switchChain, waitForTxReceipt } from '../core/utils';
import { EADDRESS, SWEEPER_ADDRESS } from './constants';
import { createBridgeRFF } from './rff';
import type { SwapRoute } from './route';
import { createSafeExecuteEOASubmittedTx, createSafeExecuteTxFromCalls } from './safetx';
import { caliburExecute, checkAuthCodeSet, createSBCTxFromCalls, waitForSBCTxReceipt } from './sbc';
import {
  type Cache,
  convertTo32Bytes,
  convertToEVMAddress,
  createPermitAndTransferFromTx,
  createSweeperTxs,
  EXPECTED_CALIBUR_CODE,
  getAllowanceCacheKey,
  isEip7702DelegatedCode,
  isNativeAddress,
  type PublicClientList,
  parseQuote,
  performDestinationSwap,
  type SwapMetadata,
} from './utils';

export type SwapTxData = Quote['txData'];

type Options = {
  address: {
    cosmos: string;
    eoa: Hex;
    ephemeral: Hex;
  };
  aggregators: Aggregator[];
  cache: Cache;
  chainList: ChainListType;
  cot: {
    currencyID: CurrencyID;
    symbol: string;
  };
  destinationChainID: number;
  emitter: {
    emit: (step: SwapStepType) => void;
  };
  publicClientList: PublicClientList;
  wallet: {
    cosmos: SigningStargateClient;
    eoa: WalletClient;
    ephemeral: PrivateKeyAccount;
  };
} & QueryClients;

const logger = getLogger();

/**
 * Re-quote the given source-leg holdings with their original input amounts (so no
 * re-approval/permit is needed) and verify the combined new COT output stays within
 * `srcBuffer` of the old total. Used by SourceSwapsHandler.retryWithSlippageCheck
 * on partial source-leg retries where the bridge step has already been sized against
 * the old total — `srcBuffer` is the headroom the bridge can absorb. Wraps the
 * aggregator call in `retry` to absorb transient quote failures. Throws on no quotes
 * or buffer breach.
 *
 * NOTE: Not used by CombinedSwapHandler.requoteBothLegs. Combined batches are atomic
 * (no pre-committed bridge), so they re-quote directly and enforce a different
 * invariant (`availableCOT ≥ dst.input`) inline.
 */
const liquidateAndCheckSrcBuffer = async ({
  oldSwaps,
  holdings,
  srcBuffer,
  aggregators,
  commonCurrencyID,
  errorPrefix,
}: {
  oldSwaps: SwapRoute['source']['swaps'];
  holdings: Parameters<typeof liquidateSourceHoldings>[0]['holdings'];
  srcBuffer: Decimal;
  aggregators: Aggregator[];
  commonCurrencyID: CurrencyID;
  errorPrefix: string;
}): Promise<SwapRoute['source']['swaps']> => {
  const newSwaps = await retry(
    () => liquidateSourceHoldings({ holdings, aggregators, commonCurrencyID }),
    { retries: 2 }
  );
  if (newSwaps.length === 0) {
    throw Errors.quoteFailed(`${errorPrefix}: source re-quote returned no quotes`);
  }

  const oldTotal = oldSwaps.reduce(
    (acc, q) => acc.add(divDecimals(q.quote.output.amountRaw, q.quote.output.decimals)),
    new Decimal(0)
  );
  const newTotal = newSwaps.reduce(
    (acc, q) => acc.add(divDecimals(q.quote.output.amountRaw, q.quote.output.decimals)),
    new Decimal(0)
  );

  if (oldTotal.gt(0)) {
    const minAcceptable = Decimal.max(oldTotal.sub(srcBuffer), 0);
    logger.debug(`${errorPrefix}: source buffer check`, {
      oldTotal: oldTotal.toFixed(),
      newTotal: newTotal.toFixed(),
      srcBuffer: srcBuffer.toFixed(),
    });
    if (newTotal.lt(minAcceptable)) {
      throw Errors.slippageError(
        `${errorPrefix}: source COT output dropped from ${oldTotal.toFixed()} to ${newTotal.toFixed()} (>${srcBuffer.toFixed()} buffer)`
      );
    }
  }

  return newSwaps;
};

class BridgeHandler {
  private depositCalls: RFFDepositCallMap = {};
  private eoaToEphCalls: EoaToEphemeralCallMap = {};
  private readonly sourceExecutionsByChain: Map<number, SourceExecution>;
  private status: {
    filled: boolean;
    intentID: Long;
    promise: Promise<void>;
  } = {
    filled: true,
    intentID: Long.fromInt(0),
    promise: Promise.resolve(),
  };
  constructor(
    private readonly input: {
      amount: Decimal;
      assets: BridgeAsset[];
      chainID: number;
      decimals: number;
      recipientAddress: Hex;
      tokenAddress: `0x${string}`;
    } | null,
    private readonly options: Options,
    sourceExecutions: Record<number, SourceExecution> = {}
  ) {
    this.sourceExecutionsByChain = new Map(
      Object.entries(sourceExecutions).map(([chainID, execution]) => [Number(chainID), execution])
    );
    if (input) {
      for (const asset of input.assets) {
        const execution = this.getSourceExecution(asset.chainID);
        options.cache.addAllowanceQuery({
          chainID: asset.chainID,
          contractAddress: asset.contractAddress,
          owner: options.address.ephemeral,
          spender: options.chainList.getVaultContractAddress(asset.chainID),
        });
        options.cache.addAllowanceQuery({
          chainID: asset.chainID,
          contractAddress: asset.contractAddress,
          owner: execution.address,
          spender: SWEEPER_ADDRESS,
        });
        if (execution.mode === '7702') {
          options.cache.addSetCodeQuery({
            address: options.address.eoa,
            chainID: asset.chainID,
          });
          options.cache.addSetCodeQuery({
            address: options.address.ephemeral,
            chainID: asset.chainID,
          });
        }
      }
    }
  }

  async createRFFDeposits() {
    const waitingPromises: Promise<number>[] = [];
    if (Object.keys(this.depositCalls).length > 0) {
      const sbcTx: SBCTx[] = [];
      const queueDepositReceipt = ([chainID, hash]: [bigint, Hex]) => {
        const chain = this.options.chainList.getChainByID(Number(chainID));
        if (!chain) {
          throw Errors.chainNotFound(chainID);
        }
        this.options.emitter.emit(
          SWAP_STEPS.BRIDGE_DEPOSIT({
            chain,
            hash,
            explorerURL: chain.blockExplorers.default.url,
          })
        );
        waitingPromises.push(
          wrap(
            Number(chainID),
            waitForTxReceipt(hash, this.options.publicClientList.get(chainID), 1)
          )
        );
      };

      for (const c in this.depositCalls) {
        const chain = this.options.chainList.getChainByID(Number(c));
        if (!chain) {
          throw Errors.chainNotFound(Number(c));
        }
        const publicClient = this.options.publicClientList.get(c);
        const execution = this.getSourceExecution(Number(c));

        const calls = [];
        const e2e = this.eoaToEphCalls[Number(c)];
        logger.debug('Eoa->Eph and deposit calls', {
          allEoAToEphemeralCalls: this.eoaToEphCalls,
          chain: c,
          eoAToEphemeralCalls: e2e,
          rffDepositCalls: { ...this.depositCalls },
        });

        if (e2e) {
          // Mirrors the SourceSwapsHandler emit pattern so devs see a permit step for
          // COT bridge assets that need to move from EOA → source execution address,
          // not just for ERC20 source-swap inputs.
          this.options.emitter.emit(
            SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(false, this.options.cot.symbol, chain)
          );
          await switchChain(this.options.wallet.eoa, chain);
          const txs = await createPermitAndTransferFromTx({
            amount: e2e.amount,
            cache: this.options.cache,
            chain,
            contractAddress: e2e.tokenAddress,
            disablePermit:
              execution.mode === '7702' &&
              isEip7702DelegatedCode(
                this.options.cache.getCode({
                  address: this.options.address.eoa,
                  chainID: Number(c),
                })
              ),
            owner: this.options.address.eoa,
            ownerWallet: this.options.wallet.eoa,
            publicClient,
            spender: execution.address,
          });
          calls.push(...txs);
          this.options.emitter.emit(
            SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(true, this.options.cot.symbol, chain)
          );
        }
        const batchCalls = calls.concat(this.depositCalls[c].tx).concat(
          createSweeperTxs({
            cache: this.options.cache,
            chainID: chain.id,
            COTCurrencyID: this.options.cot.currencyID,
            receiver: this.options.address.eoa,
            sender: execution.address,
          })
        );
        if (execution.mode === 'safe_account') {
          queueDepositReceipt(
            await this.options.vscClient.vscCreateSafeExecuteTx(
              await createSafeExecuteTxFromCalls({
                calls: batchCalls,
                chainId: chain.id,
                ephemeralWallet: this.options.wallet.ephemeral,
                publicClient,
                safeAddress: execution.address,
              })
            )
          );
        } else {
          sbcTx.push(
            await createSBCTxFromCalls({
              cache: this.options.cache,
              calls: batchCalls,
              chainID: chain.id,
              ephemeralAddress: this.options.address.ephemeral,
              ephemeralWallet: this.options.wallet.ephemeral,
              publicClient,
            })
          );
        }
      }
      if (sbcTx.length) {
        const ops = await this.options.vscClient.vscSBCTx(sbcTx);
        for (const op of ops) {
          queueDepositReceipt(op);
        }
      }
    }
    await Promise.all(waitingPromises);
  }

  async process(
    metadata: SwapMetadata,
    inputAssets: {
      amount: Decimal;
      chainID: number;
      tokenAddress: `0x${string}`;
    }[]
  ) {
    if (this.input) {
      for (const asset of this.input.assets) {
        const updatedAsset = inputAssets.find(
          (i) => i.chainID === asset.chainID && equalFold(i.tokenAddress, asset.contractAddress)
        );
        if (updatedAsset) {
          asset.ephemeralBalance = updatedAsset.amount;
        }
      }

      const response = await createBridgeRFF({
        config: {
          vscClient: this.options.vscClient,
          cosmosQueryClient: this.options.cosmosQueryClient,
          chainList: this.options.chainList,
          cosmos: {
            address: this.options.address.cosmos,
            client: this.options.wallet.cosmos,
          },
          evm: {
            address: this.options.address.ephemeral,
            client: this.options.wallet.ephemeral,
            eoaAddress: this.options.address.eoa,
          },
          publicClientList: this.options.publicClientList,
          sourceExecutions: Object.fromEntries(this.sourceExecutionsByChain),
        },
        input: { assets: this.input.assets },
        output: this.input,
        recipientAddress: this.input.recipientAddress,
      });

      this.depositCalls = response.depositCalls;
      this.eoaToEphCalls = response.eoaToEphemeralCalls;

      const [, { createDoubleCheckTx }] = await Promise.all([
        this.createRFFDeposits(),
        response.createRFF(),
      ]);
      this.waitForFill = response.waitForFill;
      this.createDoubleCheckTx = createDoubleCheckTx;
    }

    this.status = this.waitForFill();

    if (this.status.intentID.toNumber() !== 0) {
      const dbc = this.createDoubleCheckTx;
      // we don't have to wait for this.
      (async () => {
        await retry(
          async () => {
            await dbc().then(() => {
              logger.info('double-check-returned');
              return true;
            });
          },
          { delay: 3000, retries: 3 }
        );
      })();

      metadata.rff_id = BigInt(this.status.intentID.toNumber());
      this.options.emitter.emit(SWAP_STEPS.RFF_ID(this.status.intentID.toNumber()));

      // will just resolve immediately if no CA was required
      logger.debug('Fill wait start');

      performance.mark('fill-wait-start');
      if (!this.status.filled) {
        await this.status.promise;
      }
      performance.mark('fill-wait-end');

      logger.debug('Fill wait complete');
    }
  }

  waitForFill = () => ({
    filled: true,
    intentID: Long.fromNumber(0),
    promise: Promise.resolve(),
  });

  // biome-ignore lint/suspicious/noEmptyBlockStatements: default it empty - expected & correct
  private createDoubleCheckTx = async () => {};

  getPlannedSafeDepositChains(): Set<number> {
    if (!this.input) {
      return new Set();
    }

    return new Set(
      this.input.assets
        .filter((asset) => {
          if (asset.chainID === this.input?.chainID) {
            return false;
          }
          if (asset.eoaBalance.add(asset.ephemeralBalance).lte(0)) {
            return false;
          }
          return this.getSourceExecution(asset.chainID).mode === 'safe_account';
        })
        .map((asset) => asset.chainID)
    );
  }

  private getSourceExecution(chainID: number): SourceExecution {
    const execution = this.sourceExecutionsByChain.get(Number(chainID));
    if (!execution) {
      throw Errors.internal(`source execution not found for chain ${chainID}`);
    }
    return execution;
  }
}

class DestinationSwapHandler {
  private destinationData: SwapRoute['destination'];
  private eoaToDestinationAccountCalls: Tx[] = [];
  constructor(
    route: SwapRoute,
    private readonly options: Options
  ) {
    this.destinationData = route.destination;
    if (this.destinationData.eoaToDestinationAccount) {
      options.cache.addAllowanceQuery({
        chainID: this.destinationData.chainId,
        contractAddress: this.destinationData.eoaToDestinationAccount.contractAddress,
        owner: options.address.eoa,
        spender: this.destinationData.execution.address,
      });
      if (!isNativeAddress(this.destinationData.eoaToDestinationAccount.contractAddress)) {
        options.cache.addPermitQuery({
          chainID: this.destinationData.chainId,
          contractAddress: this.destinationData.eoaToDestinationAccount.contractAddress,
        });
      }
    }

    if (this.destinationData.execution.mode === '7702') {
      options.cache.addSetCodeQuery({
        address: options.address.ephemeral,
        chainID: this.destinationData.chainId,
      });

      options.cache.addSetCodeQuery({
        address: options.address.eoa,
        chainID: this.destinationData.chainId,
      });
    }

    // COT sweeper always runs in performDestinationSwap to drain leftover wrapper COT to EOA.
    // Aggregator output goes directly to the EOA (see route.ts), so we no longer pre-fetch
    // allowance for the swap output token or for native — those sweepers don't run anymore.
    const cotCurrency = ChaindataMap.get(
      new OmniversalChainID(Universe.ETHEREUM, this.destinationData.chainId)
    )?.Currencies.find((c) => c.currencyID === options.cot.currencyID);
    if (cotCurrency) {
      options.cache.addAllowanceQuery({
        chainID: this.destinationData.chainId,
        contractAddress: convertToEVMAddress(cotCurrency.tokenAddress),
        owner: this.destinationData.execution.address,
        spender: SWEEPER_ADDRESS,
      });
    }
  }

  async createPermit() {
    if (this.destinationData.execution.mode === 'direct_eoa') {
      return;
    }

    if (this.destinationData.eoaToDestinationAccount) {
      const txs = await createPermitAndTransferFromTx({
        amount: this.destinationData.eoaToDestinationAccount.amount,
        cache: this.options.cache,
        chain: this.options.chainList.getChainByID(this.destinationData.chainId)!,
        contractAddress: this.destinationData.eoaToDestinationAccount.contractAddress,
        disablePermit:
          this.destinationData.execution.mode === '7702'
            ? isEip7702DelegatedCode(
                this.options.cache.getCode({
                  address: this.options.address.eoa,
                  chainID: this.destinationData.chainId,
                })
              )
            : false,
        owner: this.options.address.eoa,
        ownerWallet: this.options.wallet.eoa,
        publicClient: this.options.publicClientList.get(this.destinationData.chainId),
        spender: this.destinationData.execution.address,
      });
      this.eoaToDestinationAccountCalls = txs;
    }
  }

  async process(metadata: SwapMetadata) {
    if (this.destinationData.execution.mode === 'direct_eoa') {
      this.options.emitter.emit(SWAP_STEPS.SWAP_COMPLETE);
      performance.mark('xcs-ops-end');
      return;
    }

    const chain = this.options.chainList.getChainByID(this.destinationData.chainId);
    if (!chain) {
      throw Errors.chainNotFound(this.destinationData.chainId);
    }
    await switchChain(this.options.wallet.eoa, chain);

    const MAX_RETRIES = 2;
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        logger.warn(
          `Destination swap failed, requoting (attempt ${attempt + 1}/${MAX_RETRIES + 1}).`,
          {
            error: (lastError as Error)?.message ?? lastError,
          }
        );
        await this.requoteIfRequired(true);
      }
      try {
        await this.executeSwap(metadata);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    logger.error('Destination swap failed after all retries, sweeping to eoa', lastError, {
      cause: 'SWAP_FAILED',
    });
    await this.sweepToEoa();
    throw lastError;
  }

  /**
   * Executes swap + sweeper steps.
   *
   * Aggregator output recipient is the user's EOA (set in route.ts), so the swap output never
   * lands at the wrapper. We don't emit per-swap sweepers here. The only sweep that still runs
   * is the leftover-COT sweep appended inside `performDestinationSwap` — that catches whatever
   * COT remains at the wrapper after the swap consumed its input. ERC20-only; works on both
   * Calibur (7702) and Safe modes.
   */
  private async executeSwap(metadata: SwapMetadata) {
    await this.requoteIfRequired(false);

    const { swap } = this.destinationData;

    let calls: Tx[] = [];

    if (this.eoaToDestinationAccountCalls.length > 0) {
      calls = calls.concat(this.eoaToDestinationAccountCalls);
    }

    // Check if token swap
    if (swap.tokenSwap) {
      const tokenSwap = swap.tokenSwap;
      const parsed = parseQuote(tokenSwap, true);

      if (parsed.approval) {
        calls.push(parsed.approval);
      }
      calls.push(parsed.tx);

      this.options.emitter.emit(SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(false));
    }

    // Check if there is gas swap
    if (swap.gasSwap) {
      const parsed = parseQuote(swap.gasSwap, true);
      if (parsed.approval) {
        calls.push(parsed.approval);
      }
      calls.push(parsed.tx);
    }

    // Execute batched destination tx
    const hash = await performDestinationSwap({
      actualAddress: this.options.address.eoa,
      cache: this.options.cache,
      calls,
      chain: this.options.chainList.getChainByID(this.destinationData.chainId)!,
      chainList: this.options.chainList,
      COT: this.options.cot.currencyID,
      destinationExecution: this.destinationData.execution,
      emitter: this.options.emitter,
      hasDestinationSwap: true,
      publicClientList: this.options.publicClientList,
      signerWallet: this.options.wallet.ephemeral,
      vscClient: this.options.vscClient,
    });

    this.options.emitter.emit(SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(true));
    this.options.emitter.emit(SWAP_STEPS.SWAP_COMPLETE);

    performance.mark('xcs-ops-end');

    logger.debug('before dst metadata', { metadata });
    metadata.dst.tx_hash = convertTo32Bytes(hash);
    if (swap.tokenSwap) {
      metadata.dst.swaps.push({
        agg: 0,
        input_amt: convertTo32Bytes(swap.tokenSwap.quote.input.amountRaw),
        input_contract: convertTo32Bytes(swap.tokenSwap.quote.input.contractAddress),
        input_decimals: swap.tokenSwap.quote.input.decimals,
        output_amt: convertTo32Bytes(swap.tokenSwap.quote.output.amountRaw),
        output_contract: convertTo32Bytes(swap.tokenSwap.quote.output.contractAddress),
        output_decimals: swap.tokenSwap.quote.output.decimals,
      });
    }
    if (swap.gasSwap) {
      metadata.dst.swaps.push({
        agg: 0,
        input_amt: convertTo32Bytes(swap.gasSwap.quote.input.amountRaw),
        input_contract: convertTo32Bytes(swap.gasSwap.quote.input.contractAddress),
        input_decimals: swap.gasSwap.quote.input.decimals,
        output_amt: convertTo32Bytes(swap.gasSwap.quote.output.amountRaw),
        output_contract: convertTo32Bytes(swap.gasSwap.quote.output.contractAddress),
        output_decimals: swap.gasSwap.quote.output.decimals,
      });
    }
  }

  /**
   * Sweep remaining destination-account balances to EOA as a last resort fallback.
   */
  private async sweepToEoa() {
    const chain = this.options.chainList.getChainByID(this.destinationData.chainId)!;
    await performDestinationSwap({
      actualAddress: this.options.address.eoa,
      cache: this.options.cache,
      calls: createSweeperTxs({
        cache: this.options.cache,
        chainID: chain.id,
        COTCurrencyID: this.options.cot.currencyID,
        receiver: this.options.address.eoa,
        sender: this.destinationData.execution.address,
      }),
      chain,
      chainList: this.options.chainList,
      COT: this.options.cot.currencyID,
      destinationExecution: this.destinationData.execution,
      emitter: this.options.emitter,
      hasDestinationSwap: false,
      publicClientList: this.options.publicClientList,
      signerWallet: this.options.wallet.ephemeral,
      vscClient: this.options.vscClient,
    }).catch((e) => {
      logger.error('error during destination sweep', e, { cause: 'DESTINATION_SWEEP_ERROR' });
    });
  }

  /**
   * Requote if expired or invalid.
   * If `force` = true, always requote regardless of expiry check.
   */
  private async requoteIfRequired(force = false) {
    // There wasn't any quote to begin with so nothing to requote.
    // Happens when dst token is COT, just need to send from ephemeral -> EOA
    // Maybe FIXME: Bridge can directly send to EOA in these cases - save gas.
    if (!this.destinationData.swap.tokenSwap && !this.destinationData.swap.gasSwap) {
      return;
    }

    let requote = force;

    if (!force) {
      if (this.destinationData.swap.tokenSwap?.quote.expiry) {
        if (this.destinationData.swap.tokenSwap?.quote.expiry * 1000 < Date.now()) requote = true;
      } else if (Date.now() - this.destinationData.swap.creationTime > minutesToMs(0.4)) {
        requote = true;
      }
    }

    if (!requote) {
      return;
    }

    logger.debug('Requoting destination swap...');
    const newSwap = await this.destinationData.getDstSwap();
    if (!newSwap) {
      throw Errors.quoteFailed('Failed to requote destination swap.');
    }

    this.destinationData.swap = newSwap;

    logger.debug('Destination swap requoted successfully.');
  }
}

class SourceSwapsHandler {
  private disposableCache: { [k: string]: Tx } = {};
  private readonly sourceExecutionsByChain: Map<number, SourceExecution>;
  private readonly swapsData: Map<number, SwapRoute['source']['swaps']>;
  private readonly srcBuffer: Decimal;
  constructor(
    route: SwapRoute,
    private readonly options: Options
  ) {
    this.sourceExecutionsByChain = new Map(
      Object.entries(route.source.executions ?? {}).map(([chainID, execution]) => [
        Number(chainID),
        execution,
      ])
    );
    this.srcBuffer = route.source.srcBuffer ?? new Decimal(0);
    this.swapsData = this.groupAndOrder(route.source.swaps);
    for (const [chainID, swapQuotes] of this.swapsData) {
      const execution = this.getSourceExecution(chainID);
      if (execution.mode === '7702') {
        this.options.cache.addSetCodeQuery({
          address: this.options.address.ephemeral,
          chainID: Number(chainID),
        });
        this.options.cache.addSetCodeQuery({
          address: this.options.address.eoa,
          chainID: Number(chainID),
        });
      }

      for (const sQuote of swapQuotes) {
        const inputAddress = sQuote.quote.input.contractAddress;

        this.options.cache.addAllowanceQuery({
          chainID: Number(chainID),
          contractAddress: inputAddress,
          owner: this.options.address.eoa,
          spender: execution.address,
        });

        this.options.cache.addAllowanceQuery({
          chainID: Number(chainID),
          contractAddress: inputAddress,
          owner: execution.address,
          spender: SWEEPER_ADDRESS,
        });

        if (!isNativeAddress(inputAddress)) {
          this.options.cache.addPermitQuery({
            chainID: Number(chainID),
            contractAddress: inputAddress,
          });
        }
      }
    }
  }

  async process(
    metadata: SwapMetadata,
    input = this.swapsData,
    retry = true
  ): Promise<{ amount: Decimal; chainID: number; tokenAddress: `0x${string}` }[]> {
    logger.debug('sourceSwapsHandler', {
      input,
      metadata,
      retry,
    });
    const waitingPromises: Promise<number>[] = [];
    const chains: number[] = [];
    const chainHashMap = new Map<number, Hex>();
    const assets: {
      amount: Decimal;
      chainID: number;
      tokenAddress: Hex;
    }[] = [];
    for (const [chainID, swaps] of input) {
      chains.push(chainID);
      const sbcCalls = {
        calls: [] as Tx[],
        value: 0n,
      };

      const publicClient = this.options.publicClientList.get(chainID);
      const chain = this.options.chainList.getChainByID(Number(chainID));
      if (!chain) {
        throw Errors.chainNotFound(chainID);
      }
      const execution = this.getSourceExecution(chainID);

      // 1. Source swap calls
      let amount = new Decimal(0);
      for (const swap of swaps) {
        amount = amount.add(swap.quote.output.amount);
        if (isNativeAddress(swap.quote.input.contractAddress)) {
          sbcCalls.value += swap.quote.input.amountRaw;
        } else {
          this.options.emitter.emit(
            SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(false, swap.quote.input.symbol, chain)
          );
          const allowanceCacheKey = getAllowanceCacheKey({
            chainID: chain.id,
            contractAddress: swap.quote.input.contractAddress,
            owner: this.options.address.eoa,
            spender: execution.address,
          });

          // EOA --> Ephemeral transfer
          const txs = await createPermitAndTransferFromTx({
            amount: swap.quote.input.amountRaw,
            approval: this.disposableCache[allowanceCacheKey],
            cache: this.options.cache,
            chain,
            contractAddress: swap.quote.input.contractAddress,
            disablePermit:
              execution.mode === '7702' &&
              isEip7702DelegatedCode(
                this.options.cache.getCode({
                  address: this.options.address.eoa,
                  chainID: Number(chainID),
                })
              ),
            owner: this.options.address.eoa,
            ownerWallet: this.options.wallet.eoa,
            publicClient,
            spender: execution.address,
          });

          // Approval & transferFrom
          if (txs.length === 2) {
            const approvalTx = txs[0];
            this.disposableCache[allowanceCacheKey] = approvalTx;
          }

          this.options.emitter.emit(
            SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(true, swap.quote.input.symbol, chain)
          );
          logger.debug('sourceSwap', {
            chainID,
            permitCalls: txs,
            quote: swap.quote,
          });
          sbcCalls.calls.push(...txs);
        }

        const parsed = parseQuote(swap, !isNativeAddress(swap.quote.input.contractAddress));

        if (parsed.approval) {
          sbcCalls.calls.push(parsed.approval);
        }
        sbcCalls.calls.push(parsed.tx);
      }
      if (sbcCalls.value > 0n) {
        if (
          execution.mode === '7702' &&
          !(await checkAuthCodeSet(
            Number(chainID),
            this.options.address.ephemeral,
            this.options.cache
          ))
        ) {
          const ops = await this.options.vscClient.vscSBCTx([
            await createSBCTxFromCalls({
              cache: this.options.cache,
              calls: [],
              chainID: chain.id,
              ephemeralAddress: this.options.address.ephemeral,
              ephemeralWallet: this.options.wallet.ephemeral,
              publicClient,
            }),
          ]);

          logger.debug('SetAuthCodeWithoutCalls', {
            ops,
          });

          await waitForSBCTxReceipt(ops, this.options.chainList, this.options.publicClientList);

          // We know its set since we got receipt,
          // and so if we come back on retry it is already set
          this.options.cache.addSetCodeValue(
            {
              address: this.options.address.ephemeral,
              chainID: Number(chainID),
            },
            EXPECTED_CALIBUR_CODE
          );
        }

        const hash =
          execution.mode === 'safe_account'
            ? await createSafeExecuteEOASubmittedTx({
                actualAddress: this.options.address.eoa,
                calls: sbcCalls.calls,
                chain,
                eoaWallet: this.options.wallet.eoa,
                ephemeralWallet: this.options.wallet.ephemeral,
                nativeValue: sbcCalls.value,
                publicClient,
                safeAddress: execution.address,
              })
            : await (async () => {
                await switchChain(this.options.wallet.eoa, chain);
                return caliburExecute({
                  actualAddress: this.options.address.eoa,
                  actualWallet: this.options.wallet.eoa,
                  calls: sbcCalls.calls,
                  chain,
                  publicClient,
                  signerWallet: this.options.wallet.ephemeral,
                  targetAddress: execution.address,
                  value: sbcCalls.value,
                });
              })();

        this.options.emitter.emit(
          SWAP_STEPS.SOURCE_SWAP_HASH([BigInt(chain.id), hash], this.options.chainList)
        );

        chainHashMap.set(Number(chainID), hash);
        waitingPromises.push(wrap(Number(chainID), waitForTxReceipt(hash, publicClient, 1)));
      } else {
        logger.debug('sourceSwapsHandler', {
          calls: sbcCalls.calls,
        });

        waitingPromises.push(
          (async () => {
            logger.debug('waitingPromises:1');
            const [opChainID, hash] =
              execution.mode === 'safe_account'
                ? await this.options.vscClient.vscCreateSafeExecuteTx(
                    await createSafeExecuteTxFromCalls({
                      calls: sbcCalls.calls,
                      chainId: chain.id,
                      ephemeralWallet: this.options.wallet.ephemeral,
                      publicClient,
                      safeAddress: execution.address,
                    })
                  )
                : (
                    await this.options.vscClient.vscSBCTx([
                      await createSBCTxFromCalls({
                        cache: this.options.cache,
                        calls: sbcCalls.calls,
                        chainID: chain.id,
                        ephemeralAddress: this.options.address.ephemeral,
                        ephemeralWallet: this.options.wallet.ephemeral,
                        publicClient,
                      }),
                    ])
                  )[0];
            chainHashMap.set(Number(chainID), hash);
            this.options.emitter.emit(
              SWAP_STEPS.SOURCE_SWAP_HASH([opChainID, hash], this.options.chainList)
            );

            return wrap(
              Number(opChainID),
              waitForTxReceipt(hash, this.options.publicClientList.get(opChainID), 1)
            );
          })()
        );
      }

      assets.push({
        amount: amount,
        chainID: Number(chainID),
        // FIXME: ???
        tokenAddress: swaps[0].quote.output.contractAddress,
      });
    }

    // 3. Check status of all source swaps
    // Refund COT(Ephemeral -> EOA) on failure of any source swap post retry
    {
      const responses = await Promise.allSettled(waitingPromises);
      const someSrcSwapFailed = responses.some((r) => r.status === 'rejected');
      const successfulSwaps = responses.filter((r) => r.status === 'fulfilled').map((r) => r.value);

      const failedChains = chains.filter((c) => !successfulSwaps.includes(Number(c)));
      logger.debug('sourceSwapProcessResults', {
        failedChains,
        responses,
        retry,
        someSrcSwapFailed,
        successfulSwaps,
        waitingPromises,
      });
      // Sweep from all other src swap if any failed
      if (someSrcSwapFailed) {
        if (retry) {
          try {
            const response = await this.retryWithSlippageCheck(metadata, failedChains);
            return response;
          } catch (e) {
            logger.debug('src swp failed', {
              e,
              successfulSwaps,
            });

            const sbcTxs: SBCTx[] = [];
            const safeOps: Promise<[bigint, Hex]>[] = [];
            for (const chainID of successfulSwaps) {
              const execution = this.getSourceExecution(chainID);
              const calls = createSweeperTxs({
                cache: this.options.cache,
                chainID,
                COTCurrencyID: this.options.cot.currencyID,
                receiver: this.options.address.eoa,
                sender: execution.address,
              });
              if (execution.mode === 'safe_account') {
                safeOps.push(
                  this.options.vscClient.vscCreateSafeExecuteTx(
                    await createSafeExecuteTxFromCalls({
                      calls,
                      chainId: chainID,
                      ephemeralWallet: this.options.wallet.ephemeral,
                      publicClient: this.options.publicClientList.get(chainID),
                      safeAddress: execution.address,
                    })
                  )
                );
              } else {
                sbcTxs.push(
                  await createSBCTxFromCalls({
                    cache: this.options.cache,
                    calls,
                    chainID: chainID,
                    ephemeralAddress: this.options.address.ephemeral,
                    ephemeralWallet: this.options.wallet.ephemeral,
                    publicClient: this.options.publicClientList.get(chainID),
                  })
                );
              }
            }
            try {
              const ops = [
                ...(sbcTxs.length ? await this.options.vscClient.vscSBCTx(sbcTxs) : []),
                ...(await Promise.all(safeOps)),
              ];
              await waitForSBCTxReceipt(ops, this.options.chainList, this.options.publicClientList);
            } catch {
              // TODO: What to do here? Store it or something?
            }
            throw Errors.swapFailed('source swap failed');
          }
        } else {
          throw Errors.swapFailed('some source swap failed even after retry');
        }
      }

      for (const chainID of successfulSwaps) {
        const hash = chainHashMap.get(chainID);
        const swaps = input.get(chainID);
        if (hash && swaps) {
          metadata.src.push({
            chid: convertTo32Bytes(chainID),
            swaps: swaps.map((s) => ({
              agg: 0,
              input_amt: convertTo32Bytes(s.quote.input.amountRaw),
              input_contract: convertTo32Bytes(s.quote.input.contractAddress),
              input_decimals: s.quote.input.decimals,
              output_amt: convertTo32Bytes(s.quote.output.amountRaw),
              output_contract: convertTo32Bytes(s.quote.output.contractAddress),
              output_decimals: s.quote.output.decimals,
            })),
            tx_hash: convertTo32Bytes(hash),
            univ: Universe.ETHEREUM,
          });
        }
      }

      return assets;
    }
  }

  // Re-quote source legs on the failed chains via the shared `liquidateAndCheckSrcBuffer`
  // helper, then re-enter `process`. The buffer (sized as `min(2%, $1)` of
  // bridgeOutputWithFees for EXACT_OUT, `min(0.5%, $1)` of swapCombinedBalance for
  // EXACT_IN) is the headroom the bridge step has — re-quote drops larger than that
  // would underflow the bridge's input requirement.
  async retryWithSlippageCheck(metadata: SwapMetadata, failedChains: number[]) {
    const oldSwaps: SwapRoute['source']['swaps'] = [];
    const holdings: Parameters<typeof liquidateSourceHoldings>[0]['holdings'] = [];
    for (const fChain of failedChains) {
      const chainSwaps = this.swapsData.get(fChain);
      if (!chainSwaps) {
        logger.debug('how can old quote not be there???? we are iterating on it');
        continue;
      }
      const swapAddress = convertTo32Bytes(this.getSourceExecution(fChain).address);
      for (const oldSwap of chainSwaps) {
        oldSwaps.push(oldSwap);
        holdings.push({
          ...oldSwap.holding,
          amountRaw: oldSwap.quote.input.amountRaw,
          tokenAddress: convertTo32Bytes(oldSwap.quote.input.contractAddress),
          takerAddress: swapAddress,
          receiverAddress: swapAddress,
        });
      }
    }

    const quoteResponses = await liquidateAndCheckSrcBuffer({
      oldSwaps,
      holdings,
      srcBuffer: this.srcBuffer,
      aggregators: this.options.aggregators,
      commonCurrencyID: this.options.cot.currencyID,
      errorPrefix: 'source swap retry',
    });

    return this.process(metadata, this.groupAndOrder(quoteResponses), false);
  }

  getPlannedSafeChains(): Set<number> {
    return new Set(
      [...this.swapsData.keys()].filter(
        (chainID) => this.getSourceExecution(chainID).mode === 'safe_account'
      )
    );
  }

  private getSourceExecution(chainID: number): SourceExecution {
    const execution = this.sourceExecutionsByChain.get(Number(chainID));
    if (!execution) {
      throw Errors.internal(`source execution not found for chain ${chainID}`);
    }
    return execution;
  }

  private groupAndOrder(input: SwapRoute['source']['swaps']) {
    return Map.groupBy(
      orderBy(
        input,
        [
          (s) =>
            // if native currency is involved move it up
            equalFold(s.quote.input.contractAddress, EADDRESS) ? -1 : 1,
        ],
        ['asc']
      ),
      (s) => s.chainID
    );
  }
}

const wrap = async (chainID: number, promise: Promise<unknown>) => {
  await promise;
  return chainID;
};

const COMBINED_MAX_RETRIES = 2;

/**
 * Executes a same-chain same-wrapper source+destination swap atomically as ONE batched
 * transaction. Used when `route.combined === true`.
 *
 * Layout (in order):
 *   [src: permit/transferFrom EOA→wrapper for each ERC20 source]
 *   [src: aggregator approval + swap calldata for each source quote]
 *   [dst: permit/transferFrom EOA→wrapper for any pre-existing dst-chain COT, if set]
 *   [dst: aggregator approval + swap calldata for tokenSwap and gasSwap]
 *   [sweep COT dust → EOA]
 *
 * On revert, re-quotes both legs and retries up to {@link COMBINED_MAX_RETRIES} times. The
 * batch is atomic: a partial failure reverts everything and the user's input stays at the EOA.
 */
class CombinedSwapHandler {
  constructor(
    private route: SwapRoute,
    private readonly options: Options
  ) {}

  async process(metadata: SwapMetadata): Promise<void> {
    const chain = this.options.chainList.getChainByID(this.route.destination.chainId);
    if (!chain) {
      throw Errors.chainNotFound(this.route.destination.chainId);
    }
    const execution = this.route.destination.execution;
    if (execution.mode === 'direct_eoa') {
      throw Errors.internal('CombinedSwapHandler called with direct_eoa execution');
    }

    await switchChain(this.options.wallet.eoa, chain);

    let lastError: unknown;
    for (let attempt = 0; attempt <= COMBINED_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        logger.warn('combined swap retry', { attempt });
        await this.requoteBothLegs();
      }
      try {
        const { calls, nativeValue } = await this.buildBatch(chain);
        const hash = await this.submitBatch({
          calls,
          chain,
          execution,
          nativeValue,
        });
        this.emitHashes(hash, chain);
        this.recordMetadata(metadata, hash);
        return;
      } catch (error) {
        lastError = error;
        logger.warn('combined swap attempt failed', {
          attempt,
          error: (error as Error)?.message ?? String(error),
        });
      }
    }

    throw lastError;
  }

  private async buildBatch(chain: import('../commons').Chain): Promise<{
    calls: Tx[];
    nativeValue: bigint;
  }> {
    const calls: Tx[] = [];
    let nativeValue = 0n;
    const execAddr = this.route.destination.execution.address;
    const publicClient = this.options.publicClientList.get(chain.id);

    const disablePermit = (): boolean => {
      if (this.route.destination.execution.mode !== '7702') return false;
      return isEip7702DelegatedCode(
        this.options.cache.getCode({
          address: this.options.address.eoa,
          chainID: chain.id,
        })
      );
    };

    for (const swap of this.route.source.swaps) {
      const inputAddress = swap.quote.input.contractAddress;
      if (isNativeAddress(inputAddress)) {
        nativeValue += swap.quote.input.amountRaw;
      } else {
        const txs = await createPermitAndTransferFromTx({
          amount: swap.quote.input.amountRaw,
          cache: this.options.cache,
          chain,
          contractAddress: inputAddress,
          disablePermit: disablePermit(),
          owner: this.options.address.eoa,
          ownerWallet: this.options.wallet.eoa,
          publicClient,
          spender: execAddr,
        });
        calls.push(...txs);
      }
      const parsed = parseQuote(swap, !isNativeAddress(inputAddress));
      if (parsed.approval) calls.push(parsed.approval);
      calls.push(parsed.tx);
    }

    if (this.route.destination.eoaToDestinationAccount) {
      const txs = await createPermitAndTransferFromTx({
        amount: this.route.destination.eoaToDestinationAccount.amount,
        cache: this.options.cache,
        chain,
        contractAddress: this.route.destination.eoaToDestinationAccount.contractAddress,
        disablePermit: disablePermit(),
        owner: this.options.address.eoa,
        ownerWallet: this.options.wallet.eoa,
        publicClient,
        spender: execAddr,
      });
      calls.push(...txs);
    }

    const dstSwap = this.route.destination.swap;
    if (dstSwap.tokenSwap) {
      const parsed = parseQuote(dstSwap.tokenSwap, true);
      if (parsed.approval) calls.push(parsed.approval);
      calls.push(parsed.tx);
    }
    if (dstSwap.gasSwap) {
      const parsed = parseQuote(dstSwap.gasSwap, true);
      if (parsed.approval) calls.push(parsed.approval);
      calls.push(parsed.tx);
    }

    calls.push(
      ...createSweeperTxs({
        cache: this.options.cache,
        chainID: chain.id,
        COTCurrencyID: this.options.cot.currencyID,
        receiver: this.options.address.eoa,
        sender: execAddr,
      })
    );

    return { calls, nativeValue };
  }

  private async submitBatch({
    calls,
    chain,
    execution,
    nativeValue,
  }: {
    calls: Tx[];
    chain: import('../commons').Chain;
    execution: SwapRoute['destination']['execution'];
    nativeValue: bigint;
  }): Promise<Hex> {
    const publicClient = this.options.publicClientList.get(chain.id);

    if (execution.mode === 'safe_account') {
      if (nativeValue > 0n) {
        const hash = await createSafeExecuteEOASubmittedTx({
          actualAddress: this.options.address.eoa,
          calls,
          chain,
          ephemeralWallet: this.options.wallet.ephemeral,
          eoaWallet: this.options.wallet.eoa,
          nativeValue,
          publicClient,
          safeAddress: execution.address,
        });
        await waitForTxReceipt(hash, publicClient, 1);
        return hash;
      }
      const [, hash] = await this.options.vscClient.vscCreateSafeExecuteTx(
        await createSafeExecuteTxFromCalls({
          calls,
          chainId: chain.id,
          ephemeralWallet: this.options.wallet.ephemeral,
          publicClient,
          safeAddress: execution.address,
        })
      );
      await waitForTxReceipt(hash, publicClient, 1);
      return hash;
    }

    // 7702 / Calibur mode
    if (nativeValue > 0n) {
      if (!(await checkAuthCodeSet(chain.id, this.options.address.ephemeral, this.options.cache))) {
        const ops = await this.options.vscClient.vscSBCTx([
          await createSBCTxFromCalls({
            cache: this.options.cache,
            calls: [],
            chainID: chain.id,
            ephemeralAddress: this.options.address.ephemeral,
            ephemeralWallet: this.options.wallet.ephemeral,
            publicClient,
          }),
        ]);
        await waitForSBCTxReceipt(ops, this.options.chainList, this.options.publicClientList);
        this.options.cache.addSetCodeValue(
          {
            address: this.options.address.ephemeral,
            chainID: chain.id,
          },
          EXPECTED_CALIBUR_CODE
        );
      }
      const hash = await caliburExecute({
        actualAddress: this.options.address.eoa,
        actualWallet: this.options.wallet.eoa,
        calls,
        chain,
        publicClient,
        signerWallet: this.options.wallet.ephemeral,
        targetAddress: execution.address,
        value: nativeValue,
      });
      await waitForTxReceipt(hash, publicClient, 1);
      return hash;
    }

    const ops = await this.options.vscClient.vscSBCTx([
      await createSBCTxFromCalls({
        cache: this.options.cache,
        calls,
        chainID: chain.id,
        ephemeralAddress: execution.address,
        ephemeralWallet: this.options.wallet.ephemeral,
        publicClient,
      }),
    ]);
    await waitForSBCTxReceipt(ops, this.options.chainList, this.options.publicClientList);
    return ops[0][1];
  }

  private async requoteBothLegs(): Promise<void> {
    const holdings = this.route.source.swaps.map((swap) => {
      const execution = this.route.source.executions[Number(swap.chainID)];
      if (!execution) {
        throw Errors.internal(`combined retry: source execution missing for chain ${swap.chainID}`);
      }
      const swapAddress = convertTo32Bytes(execution.address);
      return {
        chainID: swap.holding.chainID,
        tokenAddress: swap.holding.tokenAddress,
        amountRaw: swap.quote.input.amountRaw,
        takerAddress: swapAddress as Bytes,
        receiverAddress: swapAddress as Bytes,
      };
    });

    // Combined batches are atomic on a single wrapper: src outputs land at the wrapper that
    // dst pulls from, all in one tx. The bridge-style buffer check (newTotal < oldTotal -
    // srcBuffer) doesn't apply — nothing was pre-committed for old totals to anchor against.
    // Likewise the dst rate guard (`ratesChangedBeyondTolerance` against `originalMax`)
    // protects bridge flows whose budget was fixed when the bridge was sent; here both legs
    // re-quote together inside the retry, so we pass `skipRateGuard: true`.
    //
    // The only invariant that matters is `availableCOT ≥ sum(dst.input)`, where
    // `availableCOT = sum(src.output) + eoaToDestinationAccount.amount` (the EOA-held dst-COT
    // term contributes when `buildBatch` permits/transfers it to the wrapper before the dst
    // swap pulls; see the check below). If that holds, the atomic batch funds itself; any
    // surplus sweeps back to the EOA via the existing sweeper appended in `buildBatch`.
    const requoteSource = async (): Promise<SwapRoute['source']['swaps']> => {
      const newSwaps = await retry(
        () =>
          liquidateSourceHoldings({
            holdings,
            aggregators: this.route.extras.aggregators,
            commonCurrencyID: this.options.cot.currencyID,
          }),
        { retries: 2 }
      );
      if (newSwaps.length === 0) {
        throw Errors.quoteFailed('combined retry: source re-quote returned no quotes');
      }
      return newSwaps;
    };

    let newDstSwap: SwapRoute['destination']['swap'];
    let newSrcSwaps: SwapRoute['source']['swaps'];
    if (this.route.type === 'EXACT_OUT') {
      const dstSwap = await this.route.destination.getDstSwap({ skipRateGuard: true });
      if (!dstSwap) {
        throw Errors.quoteFailed('combined retry: getDstSwap returned null');
      }
      newDstSwap = dstSwap;
      newSrcSwaps = await requoteSource();
    } else {
      newSrcSwaps = await requoteSource();
      const dstSwap = await this.route.destination.getDstSwap({ skipRateGuard: true });
      if (!dstSwap) {
        throw Errors.quoteFailed('combined retry: getDstSwap returned null');
      }
      newDstSwap = dstSwap;
    }

    // Sole invariant: COT available at the wrapper covers dst COT input within the same
    // atomic batch. Both contributions land/pull at the same wrapper, so decimals match —
    // raw bigint compare is safe.
    //
    // Available COT at the wrapper:
    //   1. sum of src swap outputs (each swap deposits its COT output at the wrapper)
    //   2. plus `eoaToDestinationAccount.amount` when set (pre-existing dst-chain COT that
    //      `buildBatch` permits/transfers from the EOA to the wrapper before the dst swap).
    //      Only counted when its token matches the dst swap's input token (the COT).
    const srcOutputTotal = newSrcSwaps.reduce((acc, q) => acc + q.quote.output.amountRaw, 0n);
    const dstInputContract =
      newDstSwap.tokenSwap?.quote.input.contractAddress ??
      newDstSwap.gasSwap?.quote.input.contractAddress;
    const eoaContribution =
      this.route.destination.eoaToDestinationAccount &&
      dstInputContract &&
      equalFold(this.route.destination.eoaToDestinationAccount.contractAddress, dstInputContract)
        ? this.route.destination.eoaToDestinationAccount.amount
        : 0n;
    const availableCOT = srcOutputTotal + eoaContribution;
    const dstInputTotal =
      (newDstSwap.tokenSwap?.quote.input.amountRaw ?? 0n) +
      (newDstSwap.gasSwap?.quote.input.amountRaw ?? 0n);

    logger.debug('combined retry: available COT vs dst input', {
      srcOutputTotal: srcOutputTotal.toString(),
      eoaContribution: eoaContribution.toString(),
      availableCOT: availableCOT.toString(),
      dstInputTotal: dstInputTotal.toString(),
    });

    if (availableCOT < dstInputTotal) {
      throw Errors.slippageError(
        `combined retry: source output ${srcOutputTotal} (+ EOA→dst ${eoaContribution}) cannot fund destination input ${dstInputTotal}`
      );
    }

    this.route.source.swaps = newSrcSwaps;
    this.route.destination.swap = newDstSwap;
  }

  private emitHashes(hash: Hex, chain: import('../commons').Chain): void {
    this.options.emitter.emit(
      SWAP_STEPS.SOURCE_SWAP_HASH([BigInt(chain.id), hash], this.options.chainList)
    );
    this.options.emitter.emit(
      SWAP_STEPS.DESTINATION_SWAP_HASH([BigInt(chain.id), hash], this.options.chainList)
    );
    this.options.emitter.emit(SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(true));
    this.options.emitter.emit(SWAP_STEPS.SWAP_COMPLETE);
  }

  private recordMetadata(metadata: SwapMetadata, hash: Hex): void {
    const chainId = this.route.destination.chainId;
    const hashBytes = convertTo32Bytes(hash);
    metadata.dst.tx_hash = hashBytes;
    metadata.dst.chid = convertTo32Bytes(chainId);
    metadata.dst.univ = Universe.ETHEREUM;
    const dstSwap = this.route.destination.swap;
    if (dstSwap.tokenSwap) {
      metadata.dst.swaps.push({
        agg: 0,
        input_amt: convertTo32Bytes(dstSwap.tokenSwap.quote.input.amountRaw),
        input_contract: convertTo32Bytes(dstSwap.tokenSwap.quote.input.contractAddress),
        input_decimals: dstSwap.tokenSwap.quote.input.decimals,
        output_amt: convertTo32Bytes(dstSwap.tokenSwap.quote.output.amountRaw),
        output_contract: convertTo32Bytes(dstSwap.tokenSwap.quote.output.contractAddress),
        output_decimals: dstSwap.tokenSwap.quote.output.decimals,
      });
    }
    if (dstSwap.gasSwap) {
      metadata.dst.swaps.push({
        agg: 0,
        input_amt: convertTo32Bytes(dstSwap.gasSwap.quote.input.amountRaw),
        input_contract: convertTo32Bytes(dstSwap.gasSwap.quote.input.contractAddress),
        input_decimals: dstSwap.gasSwap.quote.input.decimals,
        output_amt: convertTo32Bytes(dstSwap.gasSwap.quote.output.amountRaw),
        output_contract: convertTo32Bytes(dstSwap.gasSwap.quote.output.contractAddress),
        output_decimals: dstSwap.gasSwap.quote.output.decimals,
      });
    }
    metadata.src.push({
      chid: convertTo32Bytes(chainId),
      swaps: this.route.source.swaps.map((s) => ({
        agg: 0,
        input_amt: convertTo32Bytes(s.quote.input.amountRaw),
        input_contract: convertTo32Bytes(s.quote.input.contractAddress),
        input_decimals: s.quote.input.decimals,
        output_amt: convertTo32Bytes(s.quote.output.amountRaw),
        output_contract: convertTo32Bytes(s.quote.output.contractAddress),
        output_decimals: s.quote.output.decimals,
      })),
      tx_hash: hashBytes,
      univ: Universe.ETHEREUM,
    });
  }
}

export { BridgeHandler, CombinedSwapHandler, DestinationSwapHandler, SourceSwapsHandler };
