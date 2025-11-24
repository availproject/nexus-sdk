import {
  Aggregator,
  BebopAggregator,
  BebopQuote,
  Bytes,
  Currency,
  CurrencyID,
  Holding,
  liquidateInputHoldings,
  Quote,
  QuoteRequestExactInput,
  Universe,
} from '@avail-project/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import Decimal from 'decimal.js';
import { orderBy, retry } from 'es-toolkit';
import Long from 'long';
import { Hex, PrivateKeyAccount, WalletClient } from 'viem';
import { divDecimals, equalFold, minutesToMs, waitForTxReceipt } from '../utils';
import { EADDRESS, SWEEPER_ADDRESS } from './constants';
import { getTokenDecimals } from './data';
import { createBridgeRFF } from './rff';
import { caliburExecute, checkAuthCodeSet, createSBCTxFromCalls, waitForSBCTxReceipt } from './sbc';

import {
  bytesEqual,
  Cache,
  convertTo32Bytes,
  convertToEVMAddress,
  createPermitAndTransferFromTx,
  createSweeperTxs,
  EADDRESS_32_BYTES,
  EXPECTED_CALIBUR_CODE,
  getAllowanceCacheKey,
  parseQuote,
  isNativeAddress,
  performDestinationSwap,
  PublicClientList,
  SwapMetadata,
  SwapMetadataTx,
  vscSBCTx,
} from './utils';
import {
  getLogger,
  SWAP_STEPS,
  SwapStepType,
  ChainListType,
  BridgeAsset,
  EoaToEphemeralCallMap,
  RFFDepositCallMap,
  SBCTx,
  Tx,
} from '../../../commons';
import { SwapRoute } from './route';
import { Errors } from '../errors';

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
  networkConfig: {
    COSMOS_URL: string;
    GRPC_URL: string;
    VSC_DOMAIN: string;
  };
  publicClientList: PublicClientList;
  slippage: number;
  wallet: {
    cosmos: DirectSecp256k1Wallet;
    eoa: WalletClient;
    ephemeral: PrivateKeyAccount;
  };
};

type SwapInput = {
  agg: Aggregator;
  cfee: bigint;
  cur: Currency;
  originalHolding: Holding & { decimals: number; symbol: string };
  quote: Quote;
  req: QuoteRequestExactInput;
};

const logger = getLogger();

class BridgeHandler {
  private depositCalls: RFFDepositCallMap = {};
  private eoaToEphCalls: EoaToEphemeralCallMap = {};
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
      tokenAddress: `0x${string}`;
    } | null,
    private readonly options: Options,
  ) {
    if (input) {
      for (const asset of input.assets) {
        options.cache.addAllowanceQuery({
          chainID: asset.chainID,
          contractAddress: asset.contractAddress,
          owner: options.address.ephemeral,
          spender: options.chainList.getVaultContractAddress(asset.chainID),
        });
      }
    }
  }

  async createRFFDeposits() {
    const waitingPromises = [];
    if (Object.keys(this.depositCalls).length > 0) {
      const sbcTx: SBCTx[] = [];
      for (const c in this.depositCalls) {
        const chain = this.options.chainList.getChainByID(Number(c));
        if (!chain) {
          throw Errors.chainNotFound(Number(c));
        }
        const publicClient = this.options.publicClientList.get(c);

        const calls = [];
        const e2e = this.eoaToEphCalls[Number(c)];
        logger.debug('Eoa->Eph and deposit calls', {
          allEoAToEphemeralCalls: this.eoaToEphCalls,
          chain: c,
          eoAToEphemeralCalls: e2e,
          rffDepositCalls: { ...this.depositCalls },
        });

        await this.options.wallet.eoa.switchChain({
          id: Number(c),
        });

        if (e2e) {
          await this.options.wallet.eoa.switchChain({ id: chain.id });
          const txs = await createPermitAndTransferFromTx({
            amount: e2e.amount,
            cache: this.options.cache,
            chain,
            contractAddress: e2e.tokenAddress,
            owner: this.options.address.eoa,
            ownerWallet: this.options.wallet.eoa,
            publicClient,
            spender: this.options.address.ephemeral,
          });
          calls.push(...txs);
        }
        sbcTx.push(
          await createSBCTxFromCalls({
            cache: this.options.cache,
            calls: calls.concat(this.depositCalls[c].tx).concat(
              createSweeperTxs({
                cache: this.options.cache,
                chainID: chain.id,
                COTCurrencyID: this.options.cot.currencyID,
                receiver: this.options.address.eoa,
                sender: this.options.address.ephemeral,
              }),
            ),
            chainID: chain.id,
            ephemeralAddress: this.options.address.ephemeral,
            ephemeralWallet: this.options.wallet.ephemeral,
            publicClient,
          }),
        );
      }
      if (sbcTx.length) {
        const ops = await vscSBCTx(sbcTx, this.options.networkConfig.VSC_DOMAIN);
        ops.forEach((op) => {
          this.options.emitter.emit(SWAP_STEPS.SOURCE_SWAP_HASH(op, this.options.chainList));
        });
        waitingPromises.push(
          ...ops.map(([chainID, hash]) =>
            wrap(
              Number(chainID),
              waitForTxReceipt(hash, this.options.publicClientList.get(chainID), 2),
            ),
          ),
        );
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
    }[],
  ) {
    if (this.input) {
      for (const asset of this.input.assets) {
        const updatedAsset = inputAssets.find(
          (i) => i.chainID === asset.chainID && equalFold(i.tokenAddress, asset.contractAddress),
        );
        if (updatedAsset) {
          asset.ephemeralBalance = updatedAsset.amount;
        }
      }

      const response = await createBridgeRFF({
        config: {
          chainList: this.options.chainList,
          cosmos: {
            address: this.options.address.cosmos,
            wallet: this.options.wallet.cosmos,
          },
          evm: {
            address: this.options.address.ephemeral,
            client: this.options.wallet.ephemeral,
            eoaAddress: this.options.address.eoa,
          },
          network: {
            COSMOS_URL: this.options.networkConfig.COSMOS_URL,
            GRPC_URL: this.options.networkConfig.GRPC_URL,
          },
        },
        input: { assets: this.input.assets },
        output: this.input,
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

    if (this.status.intentID.toNumber() != 0) {
      await retry(
        async () => {
          await this.createDoubleCheckTx().then(() => {
            logger.info('double-check-returned');
            return true;
          });
        },
        { delay: 3000, retries: 3 },
      );

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

  private createDoubleCheckTx = async () => {};
}

class DestinationSwapHandler {
  private eoaToEphCalls: Tx[] = [];
  constructor(
    private data: SwapRoute['destination'],
    private readonly dstTokenInfo: {
      contractAddress: `0x${string}`;
      decimals: number;
      symbol: string;
    },
    private readonly dst: {
      amount?: bigint;
      chainID: number;
      token: `0x${string}`;
    },
    private readonly options: Options,
  ) {
    if (data.swap.dstEOAToEphTx) {
      options.cache.addAllowanceQuery({
        chainID: dst.chainID,
        contractAddress: data.swap.dstEOAToEphTx.contractAddress,
        owner: options.address.eoa,
        spender: options.address.ephemeral,
      });
    }

    options.cache.addSetCodeQuery({
      address: options.address.ephemeral,
      chainID: dst.chainID,
    });

    logger.debug('dstSwapHandler:constructor', {
      isNativeAddress: isNativeAddress(dst.token),
    });
    if (isNativeAddress(dst.token)) {
      options.cache.addNativeAllowanceQuery({
        chainID: dst.chainID,
        contractAddress: options.address.ephemeral,
        owner: SWEEPER_ADDRESS,
        spender: SWEEPER_ADDRESS,
      });
    }

    options.cache.addAllowanceQuery({
      chainID: dst.chainID,
      contractAddress: convertToEVMAddress(data.swap.req.inputToken),
      owner: options.address.ephemeral,
      spender: SWEEPER_ADDRESS,
    });
  }

  async createPermit() {
    if (this.data.swap.dstEOAToEphTx) {
      const txs = await createPermitAndTransferFromTx({
        amount: this.data.swap.dstEOAToEphTx.amount,
        cache: this.options.cache,
        chain: this.options.chainList.getChainByID(this.dst.chainID)!,
        contractAddress: this.data.swap.dstEOAToEphTx.contractAddress,
        owner: this.options.address.eoa,
        ownerWallet: this.options.wallet.eoa,
        publicClient: this.options.publicClientList.get(this.dst.chainID),
        spender: this.options.address.ephemeral,
      });
      this.eoaToEphCalls = txs;
    }
  }

  // Retry only once, can't keep user waiting.
  async process(
    metadata: SwapMetadata,
    // inputAmount = this.dstSwap.quote?.inputAmount,
  ) {
    await this.options.wallet.eoa.switchChain({
      id: Number(this.options.destinationChainID),
    });
    try {
      await this.executeSwap(metadata);
    } catch (error) {
      logger.warn('Destination swap failed, attempting single requote & retry.', {
        error: (error as Error)?.message ?? error,
      });

      await this.requoteIfRequired(true);
      try {
        await this.executeSwap(metadata);
      } catch (retryError) {
        logger.error(
          'Destination swap failed even after retry.',
          {
            error: (retryError as Error)?.message ?? retryError,
          },
          { cause: 'SWAP_FAILED' },
        );
        throw retryError;
      }
    }
  }

  /**
   * Executes swap + sweeper steps
   */
  private async executeSwap(metadata: SwapMetadata) {
    await this.requoteIfRequired(false);

    const { swap } = this.data;

    let calls: Tx[] = [];

    if (this.eoaToEphCalls.length > 0) {
      calls = calls.concat(this.eoaToEphCalls);
    }

    if (swap.quote) {
      const quote = parseQuote(
        {
          agg: swap.aggregator,
          originalHolding: swap.originalHolding,
          quote: swap.quote,
          req: swap.req,
        },
        true,
      );

      if (quote.swap.approval) {
        calls.push(quote.swap.approval);
      }
      calls.push(quote.swap.tx);

      logger.debug('swap:destinationCalls', {
        destinationCalls: calls,
      });

      metadata.dst.swaps.push({
        agg: 0,
        input_amt: convertTo32Bytes(quote.input.amount),
        input_contract: swap.req.inputToken,
        input_decimals: swap.dstChainCOT.decimals,
        output_amt: convertTo32Bytes(this.dst.amount ?? 0),
        output_contract: convertTo32Bytes(this.dst.token),
        output_decimals: this.dstTokenInfo.decimals,
      });

      this.options.emitter.emit(SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(false));
    }

    // Add sweeper tx
    calls = calls.concat(
      createSweeperTxs({
        cache: this.options.cache,
        chainID: this.dst.chainID,
        COTCurrencyID: this.options.cot.currencyID,
        receiver: this.options.address.eoa,
        sender: this.options.address.ephemeral,
        tokenAddress: this.dst.token,
      }),
    );

    // Execute batched destination tx
    const hash = await performDestinationSwap({
      actualAddress: this.options.address.eoa,
      cache: this.options.cache,
      calls,
      chain: this.options.chainList.getChainByID(this.dst.chainID)!,
      chainList: this.options.chainList,
      COT: this.options.cot.currencyID,
      emitter: this.options.emitter,
      ephemeralAddress: this.options.address.ephemeral,
      ephemeralWallet: this.options.wallet.ephemeral,
      hasDestinationSwap: true,
      publicClientList: this.options.publicClientList,
      vscDomain: this.options.networkConfig.VSC_DOMAIN,
    });

    this.options.emitter.emit(SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(true));
    this.options.emitter.emit(SWAP_STEPS.SWAP_COMPLETE);

    performance.mark('xcs-ops-end');

    logger.debug('before dst metadata', { metadata });
    metadata.dst.tx_hash = convertTo32Bytes(hash);
  }

  /**
   * Requote if expired or invalid.
   * If `force` = true, always requote regardless of expiry check.
   */
  private async requoteIfRequired(force = false) {
    // There wasn't any quote to begin with so nothing to requote.
    // Happens when dst token is COT, just need to send from ephemeral -> EOA
    // Maybe FIXME: Bridge can directly send to EOA in these cases - save gas.
    if (!this.data.swap.quote) {
      return;
    }

    const { swap } = this.data;
    let requote = force;

    if (!force) {
      if (swap.aggregator instanceof BebopAggregator) {
        const quote = swap.quote as BebopQuote;
        if (quote.originalResponse.quote.expiry * 1000 < Date.now()) requote = true;
      } else if (Date.now() - swap.creationTime > minutesToMs(0.4)) {
        requote = true;
      }
    }

    if (!requote) {
      return;
    }

    logger.debug('Requoting destination swap...');
    const newSwap = await this.data.fetchDestinationSwapDetails();
    if (!newSwap.quote) {
      throw Errors.quoteFailed('Failed to requote destination swap.');
    }

    const isExactIn = this.data.type === 'EXACT_IN';
    logger.debug('destinationSwap Requote', {
      isExactIn,
      'newSwap.min': newSwap.inputAmount.min.toFixed(),
      'newSwap.max': newSwap.inputAmount.max.toFixed(),
      'swap.min': swap.inputAmount.min.toFixed(),
      'swap.max': swap.inputAmount.max.toFixed(),
    });

    // EXACT_IN:  min and max are same and input doesnt change so dont check here,
    // In source swap failure cases it might have an issue. FIXME
    // EXACT_OUT: min is the actual amount required so as long as it is within the range
    // of previous [max, min] it should be executable.
    if (
      !isExactIn &&
      !(
        newSwap.inputAmount.min.gte(swap.inputAmount.min) &&
        newSwap.inputAmount.min.lte(swap.inputAmount.max)
      )
    ) {
      const rate = swap.inputAmount.min.toNumber();
      const tolerance = swap.inputAmount.min.toNumber() - swap.inputAmount.max.toNumber();
      throw Errors.ratesChangedBeyondTolerance(rate, tolerance);
    }

    this.data = {
      type: this.data.type,
      swap: newSwap,
      fetchDestinationSwapDetails: this.data.fetchDestinationSwapDetails,
    };

    logger.debug('Destination swap requoted successfully.', {
      before: swap.inputAmount.min.toFixed(),
      after: newSwap.inputAmount.min.toFixed(),
    });
  }
}

class SourceSwapsHandler {
  private disposableCache: { [k: string]: Tx } = {};
  private readonly swapsData: Map<bigint, SwapInput[]>;
  constructor(data: SwapRoute['source'], private readonly options: Options) {
    this.swapsData = this.groupAndOrder(data.swaps);
    for (const [chainID, swapQuotes] of this.iterate(this.swapsData)) {
      this.options.cache.addSetCodeQuery({
        address: this.options.address.ephemeral,
        chainID: Number(chainID),
      });

      for (const sQuote of swapQuotes) {
        this.options.cache.addAllowanceQuery({
          chainID: Number(chainID),
          contractAddress: convertToEVMAddress(sQuote.input.req.inputToken),
          owner: this.options.address.eoa,
          spender: this.options.address.ephemeral,
        });

        this.options.cache.addAllowanceQuery({
          chainID: Number(chainID),
          contractAddress: convertToEVMAddress(sQuote.input.req.inputToken),
          owner: this.options.address.ephemeral,
          spender: SWEEPER_ADDRESS,
        });
      }
    }
  }

  getQuotesAndMetadata(input: Swap[]) {
    const quotes: {
      input: {
        amount: bigint;
        token: Bytes;
        decimals: number;
        symbol: string;
      };
      output: { amount: bigint; token: Bytes };
      swap: { approval: Tx | null; tx: Tx };
    }[] = [];
    const metadata: SwapMetadataTx['swaps'] = [];

    for (const quoteData of input) {
      const td = quoteData.getParsedQuote();
      const md = quoteData.getMetadata();

      metadata.push(md);
      quotes.push(td);
    }

    return { metadata, quotes };
  }

  *iterate(input: Map<bigint, SwapInput[]>) {
    for (const [chainID, swaps] of input) {
      const d = swaps.map((swap) => new Swap(swap));
      yield [chainID, d] as const;
    }
  }

  async process(
    metadata: SwapMetadata,
    input = this.swapsData,
    retry = true,
  ): Promise<{ amount: Decimal; chainID: number; tokenAddress: `0x${string}` }[]> {
    logger.debug('sourceSwapsHandler', {
      input,
      metadata,
      retry,
    });
    const waitingPromises: Promise<number>[] = [];
    const chains: bigint[] = [];
    const assets: {
      amount: Decimal;
      chainID: number;
      tokenAddress: Hex;
    }[] = [];
    for (const [chainID, swapQuotes] of this.iterate(input)) {
      chains.push(chainID);
      const sbcCalls = {
        calls: [] as Tx[],
        value: 0n,
      };

      const metadataTx: SwapMetadataTx = {
        chid: convertTo32Bytes(chainID),
        swaps: [],
        tx_hash: new Uint8Array(),
        univ: Universe.ETHEREUM,
      };
      const { metadata: mtd, quotes } = this.getQuotesAndMetadata(swapQuotes);
      const publicClient = this.options.publicClientList.get(chainID);
      const chain = this.options.chainList.getChainByID(Number(chainID));
      if (!chain) {
        throw Errors.chainNotFound(chainID);
      }

      metadataTx.swaps = metadataTx.swaps.concat(mtd);

      // 1. Source swap calls
      let amount = 0n;
      {
        for (const quote of quotes) {
          amount += quote.output.amount;
          if (isNativeAddress(convertToEVMAddress(quote.input.token))) {
            sbcCalls.value += quote.input.amount;
          } else {
            this.options.emitter.emit(
              SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(false, quote.input.symbol, chain),
            );
            const allowanceCacheKey = getAllowanceCacheKey({
              chainID: chain.id,
              contractAddress: convertToEVMAddress(quote.input.token),
              owner: this.options.address.eoa,
              spender: this.options.address.ephemeral,
            });

            const txs = await createPermitAndTransferFromTx({
              amount: quote.input.amount,
              approval: this.disposableCache[allowanceCacheKey],
              cache: this.options.cache,
              chain,
              contractAddress: convertToEVMAddress(quote.input.token),
              owner: this.options.address.eoa,
              ownerWallet: this.options.wallet.eoa,
              publicClient,
              spender: this.options.address.ephemeral,
            });

            // Approval & transferFrom
            if (txs.length === 2) {
              const approvalTx = txs[0];
              this.disposableCache[allowanceCacheKey] = approvalTx;
            }

            this.options.emitter.emit(
              SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(true, quote.input.symbol, chain),
            );
            logger.debug('sourceSwap', {
              chainID,
              permitCalls: txs,
              quote,
            });
            sbcCalls.calls.push(...txs);
          }

          if (quote.swap.approval) {
            sbcCalls.calls.push(quote.swap.approval);
          }
          sbcCalls.calls.push(quote.swap.tx);
        }
      }

      // 2. Create batched calls
      {
        if (sbcCalls.value > 0n) {
          if (
            !(await checkAuthCodeSet(
              Number(chainID),
              this.options.address.ephemeral,
              this.options.cache,
            ))
          ) {
            const ops = await vscSBCTx(
              [
                await createSBCTxFromCalls({
                  cache: this.options.cache,
                  calls: [],
                  chainID: chain.id,
                  ephemeralAddress: this.options.address.ephemeral,
                  ephemeralWallet: this.options.wallet.ephemeral,
                  publicClient,
                }),
              ],
              this.options.networkConfig.VSC_DOMAIN,
            );

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
              EXPECTED_CALIBUR_CODE,
            );
          }

          await this.options.wallet.eoa.switchChain({ id: Number(chainID) });
          /*
           * EOA creates & sends tx {
             to: ephemeralAddress (we check above it its delegated to calibur), 
             value: sbcCalls.value,
             data: SignUsingEphemeral(AggregatorTx(approval(iff non native is involved) and swap))
           }
           */
          const hash = await caliburExecute({
            actualAddress: this.options.address.eoa,
            actualWallet: this.options.wallet.eoa,
            calls: sbcCalls.calls,
            chain,
            ephemeralAddress: this.options.address.ephemeral,
            ephemeralWallet: this.options.wallet.ephemeral,
            value: sbcCalls.value,
          });
          metadataTx.tx_hash = convertTo32Bytes(hash);
          this.options.emitter.emit(
            SWAP_STEPS.SOURCE_SWAP_HASH([BigInt(chain.id), hash], this.options.chainList),
          );

          waitingPromises.push(wrap(Number(chainID), waitForTxReceipt(hash, publicClient, 2)));
        } else {
          logger.debug('sourceSwapsHandler', {
            calls: sbcCalls.calls,
          });

          waitingPromises.push(
            (async () => {
              logger.debug('waitingPromises:1');
              const ops = await vscSBCTx(
                [
                  await createSBCTxFromCalls({
                    cache: this.options.cache,
                    calls: sbcCalls.calls,
                    chainID: chain.id,
                    ephemeralAddress: this.options.address.ephemeral,
                    ephemeralWallet: this.options.wallet.ephemeral,
                    publicClient,
                  }),
                ],
                this.options.networkConfig.VSC_DOMAIN,
              );
              const [chainID, hash] = ops[0];
              metadataTx.tx_hash = convertTo32Bytes(hash);

              this.options.emitter.emit(
                SWAP_STEPS.SOURCE_SWAP_HASH([chainID, hash], this.options.chainList),
              );

              return wrap(
                Number(chainID),
                waitForTxReceipt(hash, this.options.publicClientList.get(chainID), 2),
              );
            })(),
          );
        }
      }

      assets.push({
        amount: divDecimals(
          amount,
          getTokenDecimals(Number(chainID), quotes[0].output.token).decimals,
        ),
        chainID: Number(chainID),
        tokenAddress: convertToEVMAddress(quotes[0].output.token),
      });

      metadata.src.push(metadataTx);
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
            for (const chainID of successfulSwaps) {
              sbcTxs.push(
                await createSBCTxFromCalls({
                  cache: this.options.cache,
                  calls: createSweeperTxs({
                    cache: this.options.cache,
                    chainID,
                    COTCurrencyID: this.options.cot.currencyID,
                    receiver: this.options.address.eoa,
                    sender: this.options.address.ephemeral,
                  }),
                  chainID: chainID,
                  ephemeralAddress: this.options.address.ephemeral,
                  ephemeralWallet: this.options.wallet.ephemeral,
                  publicClient: this.options.publicClientList.get(chainID),
                }),
              );
            }
            try {
              const ops = await vscSBCTx(sbcTxs, this.options.networkConfig.VSC_DOMAIN);
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

      return assets;
    }
  }

  async retryWithSlippageCheck(metadata: SwapMetadata, failedChains: bigint[]) {
    let oldTotalOutputAmount = 0n;

    logger.debug('sourceSwapsHandler:retryWithSlippageCheck:0', {
      failedChains,
    });

    const quoteResponses = await retry(() => {
      const quoteRequests = [];
      // if it comes to retry it should be set to 0
      oldTotalOutputAmount = 0n;
      for (const fChain of failedChains) {
        const oldQuotes = this.swapsData.get(fChain);
        if (!oldQuotes) {
          logger.debug('how can old quote not be there???? we are iterating on it');
          continue;
        }
        for (const oq of oldQuotes) {
          oldTotalOutputAmount += oq.quote.outputAmountMinimum;
          logger.debug('retryWithSlippage:quoteRequests:1', {
            holding: {
              amount: oq.quote.inputAmount,
              tokenAddress: oq.req.inputToken,
            },
          });
          quoteRequests.push(
            liquidateInputHoldings(
              oq.req.userAddress,
              [
                {
                  ...oq.originalHolding,
                  amount: oq.quote.inputAmount,
                  tokenAddress: oq.req.inputToken,
                },
              ],
              this.options.aggregators,
              [],
              oq.cur.currencyID,
            ).then((nq) => {
              logger.debug('retryWithSlippage:quoteRequests:2', {
                returnData: {},
              });

              const q = nq.quotes[0];
              return {
                ...q,
                originalHolding: {
                  ...q.originalHolding,
                  decimals: oq.originalHolding.decimals,
                  symbol: oq.originalHolding.symbol,
                },
              };
            }),
          );
        }
      }

      return Promise.all(quoteRequests);
    }, 2);

    logger.debug('sourceSwapsHandler:retryWithSlippageCheck:1', {
      oldTotalOutputAmount,
      quoteResponses,
    });
    let newTotalOutputAmount = 0n;
    for (const q of quoteResponses) {
      newTotalOutputAmount += q.quote.outputAmountMinimum;
    }

    const diff = oldTotalOutputAmount - newTotalOutputAmount;
    if (diff > 0) {
      if (
        !this.isSwapQuoteValid({
          newAmount: newTotalOutputAmount,
          oldAmount: oldTotalOutputAmount,
          slippage: this.options.slippage,
        })
      ) {
        throw Errors.slippageError('source swap retry slippage exceeded max');
      }
    }

    logger.debug('sourceSwapsHandler:retryWithSlippageCheck:2', {
      diff,
      newTotalOutputAmount,
      oldTotalOutputAmount,
    });

    return this.process(metadata, this.groupAndOrder(quoteResponses), false);
  }

  private groupAndOrder(input: SwapInput[]) {
    return Map.groupBy(
      orderBy(
        input,
        [
          (s) =>
            // if native currency is involved move it up
            equalFold(convertToEVMAddress(s.req.inputToken), EADDRESS) ? -1 : 1,
        ],
        ['asc'],
      ),
      (s) => s.req.chain.chainID,
    );
  }

  private isSwapQuoteValid({
    newAmount,
    oldAmount,
    slippage,
  }: {
    newAmount: bigint;
    oldAmount: bigint;
    slippage: number;
  }) {
    const minAcceptable = Decimal.mul(oldAmount, Decimal.sub(1, slippage));
    logger.debug('isSwapQuoteValid', {
      minAcceptable: minAcceptable.toFixed(),
      newAmount,
      oldAmount,
    });
    return new Decimal(newAmount).gte(minAcceptable);
  }
}

class Swap {
  constructor(public input: SwapInput) {}

  getMetadata() {
    const txs = this.getParsedQuote();

    const { decimals: outputDecimals } = getTokenDecimals(
      Number(this.input.req.chain.chainID),
      this.input.req.outputToken,
    );

    return {
      agg: 1,
      input_amt: convertTo32Bytes(this.input.req.inputAmount),
      input_contract: this.input.req.inputToken,
      input_decimals: txs.input.decimals,
      output_amt: convertTo32Bytes(txs.input.amount),
      output_contract: this.input.req.outputToken,
      output_decimals: outputDecimals,
    };
  }

  getParsedQuote() {
    const data = parseQuote(this.input, !bytesEqual(EADDRESS_32_BYTES, this.input.req.inputToken));
    return { ...data, output: { ...data.output, token: this.input.req.outputToken } };
  }
}

const wrap = async (chainID: number, promise: Promise<unknown>) => {
  await promise;
  return chainID;
};

export { BridgeHandler, DestinationSwapHandler, SourceSwapsHandler, Swap };
