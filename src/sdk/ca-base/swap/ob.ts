import {
  type Aggregator,
  ChaindataMap,
  type CurrencyID,
  liquidateInputHoldings,
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
  SWAP_STEPS,
  type SwapStepType,
  type Tx,
} from '../../../commons';
import { ZERO_ADDRESS } from '../constants';
import { Errors } from '../errors';
import { equalFold, minutesToMs, switchChain, waitForTxReceipt } from '../utils';
import { EADDRESS, SWEEPER_ADDRESS } from './constants';
import { createBridgeRFF } from './rff';
import type { SwapRoute } from './route';
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
  slippage: number;
  wallet: {
    cosmos: SigningStargateClient;
    eoa: WalletClient;
    ephemeral: PrivateKeyAccount;
  };
} & QueryClients;

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
    private readonly options: Options
  ) {
    if (input) {
      for (const asset of input.assets) {
        options.cache.addAllowanceQuery({
          chainID: asset.chainID,
          contractAddress: asset.contractAddress,
          owner: options.address.ephemeral,
          spender: options.chainList.getVaultContractAddress(asset.chainID),
        });
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

        await switchChain(this.options.wallet.eoa, chain);

        if (e2e) {
          const txs = await createPermitAndTransferFromTx({
            amount: e2e.amount,
            cache: this.options.cache,
            chain,
            contractAddress: e2e.tokenAddress,
            disablePermit: isEip7702DelegatedCode(
              this.options.cache.getCode({
                address: this.options.address.eoa,
                chainID: Number(c),
              })
            ),
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
              })
            ),
            chainID: chain.id,
            ephemeralAddress: this.options.address.ephemeral,
            ephemeralWallet: this.options.wallet.ephemeral,
            publicClient,
          })
        );
      }
      if (sbcTx.length) {
        const ops = await this.options.vscClient.vscSBCTx(sbcTx);
        waitingPromises.push(
          ...ops.map(([chainID, hash]) => {
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
            return wrap(
              Number(chainID),
              waitForTxReceipt(hash, this.options.publicClientList.get(chainID), 1)
            );
          })
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
}

class DestinationSwapHandler {
  private eoaToEphCalls: Tx[] = [];
  private destinationData: SwapRoute['destination'];
  constructor(
    route: SwapRoute,
    private readonly options: Options
  ) {
    this.destinationData = route.destination;
    if (this.destinationData.eoaToEphemeral) {
      options.cache.addAllowanceQuery({
        chainID: this.destinationData.chainId,
        contractAddress: this.destinationData.eoaToEphemeral.contractAddress,
        owner: options.address.eoa,
        spender: options.address.ephemeral,
      });
    }

    options.cache.addSetCodeQuery({
      address: options.address.ephemeral,
      chainID: this.destinationData.chainId,
    });

    options.cache.addSetCodeQuery({
      address: options.address.eoa,
      chainID: this.destinationData.chainId,
    });

    // COT sweeper always runs in performDestinationSwap to sweep leftover COT dust
    const cotCurrency = ChaindataMap.get(
      new OmniversalChainID(Universe.ETHEREUM, this.destinationData.chainId)
    )?.Currencies.find((c) => c.currencyID === options.cot.currencyID);
    if (cotCurrency) {
      options.cache.addAllowanceQuery({
        chainID: this.destinationData.chainId,
        contractAddress: convertToEVMAddress(cotCurrency.tokenAddress),
        owner: options.address.ephemeral,
        spender: SWEEPER_ADDRESS,
      });
    }

    // tokenSwap and gasSwap sweepers (only when destination is not COT)
    if (this.destinationData.swap.gasSwap) {
      options.cache.addNativeAllowanceQuery({
        chainID: this.destinationData.chainId,
        contractAddress: options.address.ephemeral,
        owner: options.address.ephemeral,
        spender: SWEEPER_ADDRESS,
      });
    }

    if (this.destinationData.swap.tokenSwap) {
      const outputAddress = this.destinationData.swap.tokenSwap.quote.output.contractAddress as Hex;
      if (isNativeAddress(outputAddress)) {
        options.cache.addNativeAllowanceQuery({
          chainID: this.destinationData.chainId,
          contractAddress: options.address.ephemeral,
          owner: options.address.ephemeral,
          spender: SWEEPER_ADDRESS,
        });
      } else {
        options.cache.addAllowanceQuery({
          chainID: this.destinationData.chainId,
          contractAddress: outputAddress,
          owner: options.address.ephemeral,
          spender: SWEEPER_ADDRESS,
        });
      }
    }
  }

  async createPermit() {
    if (this.destinationData.eoaToEphemeral) {
      const txs = await createPermitAndTransferFromTx({
        amount: this.destinationData.eoaToEphemeral.amount,
        cache: this.options.cache,
        chain: this.options.chainList.getChainByID(this.destinationData.chainId)!,
        contractAddress: this.destinationData.eoaToEphemeral.contractAddress,
        disablePermit: isEip7702DelegatedCode(
          this.options.cache.getCode({
            address: this.options.address.eoa,
            chainID: this.destinationData.chainId,
          })
        ),
        owner: this.options.address.eoa,
        ownerWallet: this.options.wallet.eoa,
        publicClient: this.options.publicClientList.get(this.destinationData.chainId),
        spender: this.options.address.ephemeral,
      });
      this.eoaToEphCalls = txs;
    }
  }

  // Retry only once, can't keep user waiting.
  async process(
    metadata: SwapMetadata
    // inputAmount = this.dstSwap.quote?.inputAmount,
  ) {
    const chain = this.options.chainList.getChainByID(this.destinationData.chainId);
    if (!chain) {
      throw Errors.chainNotFound(this.destinationData.chainId);
    }
    await switchChain(this.options.wallet.eoa, chain);
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
          { cause: 'SWAP_FAILED' }
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

    const { swap } = this.destinationData;

    let calls: Tx[] = [];
    let sweeperCalls: Tx[] = [];

    if (this.eoaToEphCalls.length > 0) {
      calls = calls.concat(this.eoaToEphCalls);
    }

    // Check if token swap
    if (swap.tokenSwap) {
      const tokenSwap = swap.tokenSwap;
      const parsed = parseQuote(tokenSwap, true);

      if (parsed.approval) {
        calls.push(parsed.approval);
      }
      calls.push(parsed.tx);

      sweeperCalls = sweeperCalls.concat(
        createSweeperTxs({
          cache: this.options.cache,
          chainID: this.destinationData.chainId,
          COTCurrencyID: this.options.cot.currencyID,
          receiver: this.options.address.eoa,
          sender: this.options.address.ephemeral,
          tokenAddress: tokenSwap.quote.output.contractAddress as Hex,
        })
      );
      this.options.emitter.emit(SWAP_STEPS.DESTINATION_SWAP_BATCH_TX(false));
    }

    // Check if there is gas swap
    if (swap.gasSwap) {
      const parsed = parseQuote(swap.gasSwap, true);
      if (parsed.approval) {
        calls.push(parsed.approval);
      }
      calls.push(parsed.tx);

      sweeperCalls = sweeperCalls.concat(
        createSweeperTxs({
          cache: this.options.cache,
          chainID: this.destinationData.chainId,
          COTCurrencyID: this.options.cot.currencyID,
          receiver: this.options.address.eoa,
          sender: this.options.address.ephemeral,
          tokenAddress: ZERO_ADDRESS,
        })
      );
    }

    calls = calls.concat(sweeperCalls);

    // Execute batched destination tx
    const hash = await performDestinationSwap({
      actualAddress: this.options.address.eoa,
      cache: this.options.cache,
      calls,
      chain: this.options.chainList.getChainByID(this.destinationData.chainId)!,
      chainList: this.options.chainList,
      COT: this.options.cot.currencyID,
      emitter: this.options.emitter,
      ephemeralAddress: this.options.address.ephemeral,
      ephemeralWallet: this.options.wallet.ephemeral,
      hasDestinationSwap: true,
      publicClientList: this.options.publicClientList,
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
        input_contract: convertTo32Bytes(swap.tokenSwap.quote.input.contractAddress as Hex),
        input_decimals: swap.tokenSwap.quote.input.decimals,
        output_amt: convertTo32Bytes(swap.tokenSwap.quote.output.amountRaw),
        output_contract: convertTo32Bytes(swap.tokenSwap.quote.output.contractAddress as Hex),
        output_decimals: swap.tokenSwap.quote.output.decimals,
      });
    }
    if (swap.gasSwap) {
      metadata.dst.swaps.push({
        agg: 0,
        input_amt: convertTo32Bytes(swap.gasSwap.quote.input.amountRaw),
        input_contract: convertTo32Bytes(swap.gasSwap.quote.input.contractAddress as Hex),
        input_decimals: swap.gasSwap.quote.input.decimals,
        output_amt: convertTo32Bytes(swap.gasSwap.quote.output.amountRaw),
        output_contract: convertTo32Bytes(swap.gasSwap.quote.output.contractAddress as Hex),
        output_decimals: swap.gasSwap.quote.output.decimals,
      });
    }
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
    if (!newSwap?.tokenSwap) {
      throw Errors.quoteFailed('Failed to requote destination swap.');
    }

    this.destinationData.swap = newSwap;

    logger.debug('Destination swap requoted successfully.', {});
  }
}

class SourceSwapsHandler {
  private disposableCache: { [k: string]: Tx } = {};
  private readonly swapsData: Map<number, SwapRoute['source']['swaps']>;
  constructor(
    route: SwapRoute,
    private readonly options: Options
  ) {
    this.swapsData = this.groupAndOrder(route.source.swaps);
    for (const [chainID, swapQuotes] of this.swapsData) {
      this.options.cache.addSetCodeQuery({
        address: this.options.address.ephemeral,
        chainID: Number(chainID),
      });
      this.options.cache.addSetCodeQuery({
        address: this.options.address.eoa,
        chainID: Number(chainID),
      });

      for (const sQuote of swapQuotes) {
        this.options.cache.addAllowanceQuery({
          chainID: Number(chainID),
          contractAddress: sQuote.quote.input.contractAddress as Hex,
          owner: this.options.address.eoa,
          spender: this.options.address.ephemeral,
        });

        this.options.cache.addAllowanceQuery({
          chainID: Number(chainID),
          contractAddress: sQuote.quote.input.contractAddress as Hex,
          owner: this.options.address.ephemeral,
          spender: SWEEPER_ADDRESS,
        });
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

      // 1. Source swap calls
      let amount = new Decimal(0);
      for (const swap of swaps) {
        amount = amount.add(swap.quote.output.amount);
        if (isNativeAddress(swap.quote.input.contractAddress as Hex)) {
          sbcCalls.value += swap.quote.input.amountRaw;
        } else {
          this.options.emitter.emit(
            SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(false, swap.quote.input.symbol, chain)
          );
          const allowanceCacheKey = getAllowanceCacheKey({
            chainID: chain.id,
            contractAddress: swap.quote.input.contractAddress as Hex,
            owner: this.options.address.eoa,
            spender: this.options.address.ephemeral,
          });

          // EOA --> Ephemeral transfer
          const txs = await createPermitAndTransferFromTx({
            amount: swap.quote.input.amountRaw,
            approval: this.disposableCache[allowanceCacheKey],
            cache: this.options.cache,
            chain,
            contractAddress: swap.quote.input.contractAddress as Hex,
            disablePermit: isEip7702DelegatedCode(
              this.options.cache.getCode({
                address: this.options.address.eoa,
                chainID: Number(chainID),
              })
            ),
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
            SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP(true, swap.quote.input.symbol, chain)
          );
          logger.debug('sourceSwap', {
            chainID,
            permitCalls: txs,
            quote: swap.quote,
          });
          sbcCalls.calls.push(...txs);
        }

        const parsed = parseQuote(swap, !isNativeAddress(swap.quote.txData.approvalAddress as Hex));

        if (parsed.approval) {
          sbcCalls.calls.push(parsed.approval);
        }
        sbcCalls.calls.push(parsed.tx);
      }
      if (sbcCalls.value > 0n) {
        if (
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

        await switchChain(this.options.wallet.eoa, chain);
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
            const ops = await this.options.vscClient.vscSBCTx([
              await createSBCTxFromCalls({
                cache: this.options.cache,
                calls: sbcCalls.calls,
                chainID: chain.id,
                ephemeralAddress: this.options.address.ephemeral,
                ephemeralWallet: this.options.wallet.ephemeral,
                publicClient,
              }),
            ]);
            const [opChainID, hash] = ops[0];
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
        tokenAddress: swaps[0].quote.output.contractAddress as Hex,
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
                })
              );
            }
            try {
              const ops = await this.options.vscClient.vscSBCTx(sbcTxs);
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
              input_contract: convertTo32Bytes(s.quote.input.contractAddress as Hex),
              input_decimals: s.quote.input.decimals,
              output_amt: convertTo32Bytes(s.quote.output.amountRaw),
              output_contract: convertTo32Bytes(s.quote.output.contractAddress as Hex),
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

  async retryWithSlippageCheck(metadata: SwapMetadata, failedChains: number[]) {
    let oldTotalOutputAmount = 0n;

    logger.debug('sourceSwapsHandler:retryWithSlippageCheck:0', {
      failedChains,
    });

    const quoteResponses = await retry(
      () => {
        const quoteRequests = [];
        // if it comes to retry it should be set to 0
        oldTotalOutputAmount = 0n;
        for (const fChain of failedChains) {
          const oldSwaps = this.swapsData.get(fChain);
          if (!oldSwaps) {
            logger.debug('how can old quote not be there???? we are iterating on it');
            continue;
          }
          for (const oldSwap of oldSwaps) {
            oldTotalOutputAmount += oldSwap.quote.output.amountRaw;
            logger.debug('retryWithSlippage:quoteRequests:1', {
              holding: {
                amount: oldSwap.quote.input.amountRaw,
                tokenAddress: oldSwap.quote.input.contractAddress,
              },
            });
            quoteRequests.push(
              liquidateInputHoldings(
                convertTo32Bytes(this.options.address.ephemeral),
                [
                  {
                    ...oldSwap.holding,
                    amountRaw: oldSwap.quote.input.amountRaw,
                    tokenAddress: convertTo32Bytes(oldSwap.quote.input.contractAddress as Hex),
                  },
                ],
                this.options.aggregators,
                this.options.cot.currencyID
              ).then((nq) => {
                logger.debug('retryWithSlippage:quoteRequests:2', {
                  newQuote: nq[0],
                });

                const q = nq[0];
                return q;
              })
            );
          }
        }

        return Promise.all(quoteRequests);
      },
      { retries: 2 }
    );

    logger.debug('sourceSwapsHandler:retryWithSlippageCheck:1', {
      oldTotalOutputAmount,
      quoteResponses,
    });
    let newTotalOutputAmount = 0n;
    for (const q of quoteResponses) {
      newTotalOutputAmount += q.quote.output.amountRaw;
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

const wrap = async (chainID: number, promise: Promise<unknown>) => {
  await promise;
  return chainID;
};

export { BridgeHandler, DestinationSwapHandler, SourceSwapsHandler };
