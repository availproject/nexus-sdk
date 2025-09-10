import {
  Aggregator,
  BebopAggregator,
  BebopQuote,
  Bytes,
  Currency,
  CurrencyID,
  Holding,
  OmniversalChainID,
  Quote,
  QuoteRequestExactInput,
  Universe,
} from '@arcana/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import Decimal from 'decimal.js';
import { orderBy } from 'es-toolkit';
import Long from 'long';
import { ByteArray, Hex, PrivateKeyAccount, WalletClient } from 'viem';

import { getLogger } from '../logger';
import { equalFold, minutesToMs, waitForTxReceipt } from '../utils';
import { EADDRESS, SWEEPER_ADDRESS } from './constants';
import { getTokenDecimals } from './data';
import { createBridgeRFF } from './rff';
import { caliburExecute, checkAuthCodeSet, createSBCTxFromCalls, waitForSBCTxReceipt } from './sbc';
import {
  CREATE_PERMIT_EOA_TO_EPHEMERAL,
  CREATE_PERMIT_FOR_SOURCE_SWAP,
  DESTINATION_SWAP_BATCH_TX,
  RFF_ID,
  SOURCE_SWAP_HASH,
  SWAP_COMPLETE,
  SwapStep,
} from './steps';
import {
  BridgeAsset,
  ChainListType,
  EoaToEphemeralCallMap,
  RFFDepositCallMap,
  SBCTx,
  Tx,
} from '@nexus/commons';
import {
  bytesEqual,
  Cache,
  convertTo32Bytes,
  convertToEVMAddress,
  createPermitAndTransferFromTx,
  createSweeperTxs,
  EADDRESS_32_BYTES,
  getTxsFromQuote,
  isNativeAddress,
  performDestinationSwap,
  PublicClientList,
  SwapMetadata,
  SwapMetadataTx,
  vscSBCTx,
} from './utils';

type Options = {
  address: {
    cosmos: string;
    eoa: Hex;
    ephemeral: Hex;
  };
  cache: Cache;
  chainList: ChainListType;
  cot: {
    currencyID: CurrencyID;
    symbol: string;
  };
  destinationChainID: number;
  emitter: {
    emit: (step: SwapStep) => void;
  };
  networkConfig: {
    COSMOS_URL: string;
    GRPC_URL: string;
    VSC_DOMAIN: string;
  };
  publicClientList: PublicClientList;
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
  originalHolding: Holding;
  quote: Quote;
  req: QuoteRequestExactInput;
};

const logger = getLogger();

type DDSInput = {
  aggregator: Aggregator;
  createdAt: number;
  dstChainCOT: Currency;
  dstEOAToEphTx: {
    amount: bigint;
    contractAddress: Hex;
  } | null;
  inputAmount: Decimal;
  inputAmountWithBuffer: Decimal;
  outputAmount: bigint;
  quote: null | Quote;
  req: {
    chain: OmniversalChainID;
    inputToken: Buffer<ArrayBufferLike>;
    outputToken: ByteArray;
  };
};

class BridgeHandler {
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
    private input: {
      amount: Decimal;
      assets: BridgeAsset[];
      chainID: number;
      decimals: number;
      tokenAddress: `0x${string}`;
    } | null,
    private options: Options,
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

  async preprocess(srcSwapsHandler: SourceSwapsHandler) {
    if (this.input) {
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

      logger.debug('createBridgeRFF', {
        response,
      });

      srcSwapsHandler.setEOAToEphAndDepositCalls(
        response.eoaToEphemeralCalls,
        response.depositCalls,
      );

      const { createDoubleCheckTx } = await response.createRFF();
      this.waitForFill = response.waitForFill;
      this.createDoubleCheckTx = createDoubleCheckTx;
    }
    this.status = this.waitForFill();
  }

  async process(metadata: SwapMetadata) {
    if (!this.status.filled) {
      this.createDoubleCheckTx().then(() => {
        logger.info('double-check-returned');
      });
    }

    if (this.status.intentID.toNumber() != 0) {
      metadata.rff_id = BigInt(this.status.intentID.toNumber());
      this.options.emitter.emit(RFF_ID(this.status.intentID.toNumber()));

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
  private destinationCalls: Tx[] = [];
  constructor(
    private dstSwap: { getDDS: () => Promise<DDSInput> } & DDSInput,
    private dstTokenInfo: {
      contractAddress: `0x${string}`;
      decimals: number;
      symbol: string;
    },
    private dst: {
      amount?: bigint;
      chainID: number;
      token: `0x${string}`;
    },
    private options: Options,
  ) {
    if (dstSwap.dstEOAToEphTx) {
      options.cache.addAllowanceQuery({
        chainID: dst.chainID,
        contractAddress: dstSwap.dstEOAToEphTx.contractAddress,
        owner: options.address.eoa,
        spender: options.address.ephemeral,
      });
    }

    options.cache.addSetCodeQuery({
      address: options.address.ephemeral,
      chainID: dst.chainID,
    });

    options.cache.addAllowanceQuery({
      chainID: dst.chainID,
      contractAddress: convertToEVMAddress(dstSwap.req.inputToken),
      owner: options.address.ephemeral,
      spender: SWEEPER_ADDRESS,
    });
  }

  async createPermit() {
    if (this.dstSwap.dstEOAToEphTx) {
      const txs = await createPermitAndTransferFromTx({
        amount: this.dstSwap.dstEOAToEphTx.amount,
        cache: this.options.cache,
        chainID: this.dst.chainID,
        contractAddress: this.dstSwap.dstEOAToEphTx.contractAddress,
        owner: this.options.address.eoa,
        ownerWallet: this.options.wallet.eoa,
        publicClient: this.options.publicClientList.get(this.dst.chainID),
        spender: this.options.address.ephemeral,
      });
      this.destinationCalls = this.destinationCalls.concat(txs);
    }
  }

  // FIXME: Need to add retry and reqoute
  async process(metadata: SwapMetadata) {
    await this.options.wallet.eoa.switchChain({
      id: Number(this.options.destinationChainID),
    });

    let hasDestinationSwap = false;
    if (this.dstSwap.quote) {
      hasDestinationSwap = true;
      let requoteDS = false;
      if (this.dstSwap.aggregator instanceof BebopAggregator) {
        const quote = this.dstSwap.quote as BebopQuote;
        if (quote.originalResponse.quote.expiry * 1000 < Date.now()) {
          logger.debug('DDS: BEBOP', {
            expiry: quote.originalResponse.quote.expiry * 1000,
            now: Date.now(),
          });
          requoteDS = true;
        }
      } else if (Date.now() - this.dstSwap.createdAt > minutesToMs(0.4)) {
        requoteDS = true;
      }

      if (requoteDS) {
        const requotedDS = await this.dstSwap.getDDS();
        if (!requotedDS.quote) {
          throw new Error('could not requote DS');
        }
        logger.debug('reqoutedDstSwap', {
          inputAmountWithBuffer: this.dstSwap.inputAmountWithBuffer.toFixed(),
          newInputAmount: requotedDS.inputAmount.toFixed(),
        });
        const isExactIn = this.dst.amount == undefined;
        if (!isExactIn && requotedDS.inputAmount.gt(this.dstSwap.inputAmountWithBuffer)) {
          throw new Error(
            `Rates changed for destination swap and could not be filled even with buffer. Before: ${this.dstSwap.inputAmountWithBuffer.toFixed()} ,After: ${requotedDS.inputAmount.toFixed()}`,
          );
        }

        this.dstSwap = { ...requotedDS, getDDS: this.dstSwap.getDDS };
      }

      const txs = getTxsFromQuote(
        this.dstSwap.aggregator,
        this.dstSwap.quote!,
        this.dstSwap.req.inputToken,
        true,
      );

      if (txs.approval) {
        this.destinationCalls.push(txs.approval);
      }

      this.destinationCalls.push(txs.swap);

      logger.debug('swap:destinationCalls', {
        destinationCalls: this.destinationCalls,
      });

      metadata.dst.swaps.push({
        agg: 0,
        input_amt: txs.inputToken,
        input_contract: this.dstSwap.req.inputToken,
        input_decimals: this.dstSwap.dstChainCOT.decimals,
        output_amt: convertTo32Bytes(this.dst.amount ?? 0),
        output_contract: convertTo32Bytes(this.dst.token),
        output_decimals: this.dstTokenInfo.decimals,
      });
    }

    if (hasDestinationSwap) {
      this.options.emitter.emit(DESTINATION_SWAP_BATCH_TX(false));
    }

    // Destination swap batched tx to VSC and waiting for receipt (sweep after)
    const hash = await performDestinationSwap({
      actualAddress: this.options.address.eoa,
      cache: this.options.cache,
      calls: this.destinationCalls,
      chain: this.options.chainList.getChainByID(this.dst.chainID)!,
      chainList: this.options.chainList,
      COT: this.options.cot.currencyID,
      emitter: this.options.emitter,
      ephemeralAddress: this.options.address.ephemeral,
      ephemeralWallet: this.options.wallet.ephemeral,
      hasDestinationSwap,
      publicClientList: this.options.publicClientList,
      vscDomain: this.options.networkConfig.VSC_DOMAIN,
    });

    if (hasDestinationSwap) {
      this.options.emitter.emit(DESTINATION_SWAP_BATCH_TX(true));
    }

    this.options.emitter.emit(SWAP_COMPLETE);
    performance.mark('xcs-ops-end');

    logger.debug('before dst metadata', {
      metadata,
    });

    metadata.dst.tx_hash = convertTo32Bytes(hash);
  }
}

class SourceSwapsHandler {
  private eoaToEphCalls: EoaToEphemeralCallMap = {};
  private rFFDepositCalls: RFFDepositCallMap = {};
  private swaps: Map<bigint, SwapInput[]>;
  constructor(
    quotes: SwapInput[],
    private options: Options,
  ) {
    this.swaps = Map.groupBy(
      orderBy(
        quotes,
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

  getSwapsAndMetadata(input: Swap[]) {
    const swaps: {
      amount: bigint;
      approval: null | Tx;
      inputToken: Bytes;
      swap: {
        data: Hex;
        to: Hex;
        value: bigint;
      };
    }[] = [];
    const metadata: SwapMetadataTx['swaps'] = [];

    for (const swap of input) {
      const td = swap.getTxsData();
      const md = swap.getMetadata();

      metadata.push(md);
      swaps.push(td);
    }

    return { metadata, swaps };
  }

  // FIXME: Need to add retry and reqoute
  async process(metadata: SwapMetadata) {
    const waitingPromises: Promise<number>[] = [];
    for (const [chainID, swapQuotes] of this) {
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
      const { metadata: mtd, swaps } = this.getSwapsAndMetadata(swapQuotes);
      const publicClient = this.options.publicClientList.get(chainID);
      const chain = this.options.chainList.getChainByID(Number(chainID));
      if (!chain) {
        throw new Error(`chain not found: ${chainID}`);
      }

      metadataTx.swaps = metadataTx.swaps.concat(mtd);

      // 1. Already existing USDC (EOA -> ephemeral)
      {
        const calls = this.eoaToEphCalls[Number(chainID)];
        if (calls) {
          this.options.emitter.emit(
            CREATE_PERMIT_EOA_TO_EPHEMERAL(false, this.options.cot.symbol, chain),
          );
          const txs = await createPermitAndTransferFromTx({
            amount: calls.amount,
            cache: this.options.cache,
            chainID: Number(chainID),
            contractAddress: calls.tokenAddress,
            owner: this.options.address.eoa,
            ownerWallet: this.options.wallet.eoa,
            publicClient,
            spender: this.options.address.ephemeral,
          });
          this.options.emitter.emit(
            CREATE_PERMIT_EOA_TO_EPHEMERAL(true, this.options.cot.symbol, chain),
          );

          sbcCalls.calls.push(...txs);
          delete this.eoaToEphCalls[Number(chainID)];
        }
      }

      // 2. Source swap calls
      {
        for (const swap of swaps) {
          const { symbol } = getTokenDecimals(Number(chainID), swap.inputToken);
          if (isNativeAddress(convertToEVMAddress(swap.inputToken))) {
            sbcCalls.value += swap.amount;
          } else {
            this.options.emitter.emit(CREATE_PERMIT_FOR_SOURCE_SWAP(false, symbol, chain));

            const txs = await createPermitAndTransferFromTx({
              amount: swap.amount,
              cache: this.options.cache,
              chainID: Number(chainID),
              contractAddress: convertToEVMAddress(swap.inputToken),
              owner: this.options.address.eoa,
              ownerWallet: this.options.wallet.eoa,
              publicClient,
              spender: this.options.address.ephemeral,
            });

            this.options.emitter.emit(CREATE_PERMIT_FOR_SOURCE_SWAP(true, symbol, chain));
            logger.debug('sourceSwap', {
              chainID,
              permitCalls: txs,
              swap,
            });
            sbcCalls.calls.push(...txs);
          }

          if (swap.approval) {
            sbcCalls.calls.push(swap.approval);
          }
          sbcCalls.calls.push(swap.swap);
        }
      }

      // 3. RFF deposit calls
      {
        if (this.rFFDepositCalls[Number(chainID)]) {
          logger.debug('rffDepositCalls', {
            chainID,
            depositCalls: this.rFFDepositCalls[Number(chainID)],
            swaps,
          });
          sbcCalls.calls.push(...this.rFFDepositCalls[Number(chainID)].tx);
          delete this.rFFDepositCalls[Number(chainID)];
          // Only sweep when involved in RFF - we only want to sweep dust
          sbcCalls.calls.push(
            ...createSweeperTxs({
              cache: this.options.cache,
              chainID: Number(chainID),
              COT: this.options.cot.currencyID,
              receiver: this.options.address.eoa,
              sender: this.options.address.ephemeral,
            }),
          );
        }
      }

      // 4. Create batched calls
      {
        if (sbcCalls.value > 0n) {
          // createSBCTx also does the same check, remove duplicate
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
          }

          //   logger.debug("SourceSwapTime", {
          //     creation: sourceSwapCreationTime,
          //     current: Date.now(),
          //     "difference(s)": (Date.now() - sourceSwapCreationTime) / 1000,
          //   });
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
            SOURCE_SWAP_HASH([BigInt(chain.id), hash], this.options.chainList),
          );

          waitingPromises.push(wrap(Number(chainID), waitForTxReceipt(hash, publicClient, 2)));
        } else {
          //   logger.debug("SourceSwapTime", {
          //     creation: sourceSwapCreationTime,
          //     current: Date.now(),
          //     "difference(s)": (Date.now() - sourceSwapCreationTime) / 1000,
          //   });

          waitingPromises.push(
            (async () => {
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

              this.options.emitter.emit(SOURCE_SWAP_HASH([chainID, hash], this.options.chainList));

              return wrap(
                Number(chainID),
                waitForTxReceipt(hash, this.options.publicClientList.get(chainID), 2),
              );
            })(),
          );
        }
      }

      metadata.src.push(metadataTx);
    }

    // 5. Add RFF deposits for chains not involved in swap
    {
      if (Object.keys(this.rFFDepositCalls).length > 0) {
        const sbcTx: SBCTx[] = [];

        for (const c in this.rFFDepositCalls) {
          const chain = this.options.chainList.getChainByID(Number(c));
          if (!chain) {
            throw new Error('chain not found');
          }
          const publicClient = this.options.publicClientList.get(c);

          const calls = [];
          const e2e = this.eoaToEphCalls[Number(c)];
          logger.debug('RFF deposit calls leftover', {
            allEoAToEphemeralCalls: this.eoaToEphCalls,
            chain: c,
            eoAToEphemeralCalls: e2e,
            rffDepositCalls: { ...this.rFFDepositCalls },
          });

          await this.options.wallet.eoa.switchChain({
            id: Number(c),
          });

          if (e2e) {
            const txs = await createPermitAndTransferFromTx({
              amount: e2e.amount,
              cache: this.options.cache,
              chainID: chain.id,
              contractAddress: e2e.tokenAddress,
              owner: this.options.address.eoa,
              ownerWallet: this.options.wallet.eoa,
              publicClient,
              spender: this.options.address.ephemeral,
            });
            calls.push(...txs);
          }
          logger.debug('LeftoverSBC', {
            chainID: c,
            e2e,
            totalCalls: calls.concat(this.rFFDepositCalls[c].tx),
          });
          sbcTx.push(
            await createSBCTxFromCalls({
              cache: this.options.cache,
              calls: calls.concat(this.rFFDepositCalls[c].tx),
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
            this.options.emitter.emit(SOURCE_SWAP_HASH(op, this.options.chainList));
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
    }

    // 6. Check status of all source swaps
    // Refund COT(Ephemeral -> EOA) on failure of any source swap
    {
      const responses = await Promise.allSettled(waitingPromises);
      const someSrcSwapFailed = responses.some((r) => r.status === 'rejected');

      // Sweep from all other src swap if any failed
      if (someSrcSwapFailed) {
        const successfulSwaps = responses
          .filter((r) => r.status === 'fulfilled')
          .map((r) => r.value);

        logger.debug('src swp failed', {
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
                COT: this.options.cot.currencyID,
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
        // TODO: More specific with chain ids?
        throw new Error('some source swap failed');
      }
    }
  }

  setEOAToEphAndDepositCalls(
    eoaToEphCalls: EoaToEphemeralCallMap,
    rFFDepositCalls: RFFDepositCallMap,
  ) {
    this.eoaToEphCalls = eoaToEphCalls;
    this.rFFDepositCalls = rFFDepositCalls;
    for (const [chainID, swapQuotes] of this) {
      const e2e = eoaToEphCalls[Number(chainID)];
      if (e2e) {
        this.options.cache.addAllowanceQuery({
          chainID: Number(chainID),
          contractAddress: e2e.tokenAddress,
          owner: this.options.address.eoa,
          spender: this.options.address.ephemeral,
        });
      }

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

  *[Symbol.iterator]() {
    for (const [chainID, swaps] of this.swaps.entries()) {
      const d = swaps.map((swap) => new Swap(swap));
      yield [chainID, d] as const;
    }
  }
}

class Swap {
  txs: {
    amount: bigint;
    approval: null | Tx;
    inputToken: Bytes;
    swap: {
      data: Hex;
      to: Hex;
      value: bigint;
    };
  } | null = null;
  constructor(public input: SwapInput) {}

  getMetadata() {
    if (!this.txs) {
      this.getTxsData();
    }
    const { decimals: inputDecimals } = getTokenDecimals(
      Number(this.input.req.chain.chainID),
      this.input.req.inputToken,
    );

    const { decimals: outputDecimals } = getTokenDecimals(
      Number(this.input.req.chain.chainID),
      this.input.req.outputToken,
    );
    return {
      agg: 1,
      input_amt: convertTo32Bytes(this.input.req.inputAmount),
      input_contract: this.input.req.inputToken,
      input_decimals: inputDecimals,
      output_amt: convertTo32Bytes(this.txs!.amount),
      output_contract: this.input.req.outputToken,
      output_decimals: outputDecimals,
    };
  }

  getTxsData() {
    if (!this.txs) {
      this.txs = getTxsFromQuote(
        this.input.agg,
        this.input.quote,
        this.input.req.inputToken,
        !bytesEqual(EADDRESS_32_BYTES, this.input.req.inputToken),
      );
    }

    return this.txs;
  }
}
class SwapGroup {
  requoted = true;
  constructor(
    public swaps: Swap[],
    public chainID: number,
  ) {}

  execute() {
    // Requote
    // Execute
  }

  requote() {}
}

const wrap = async (chainID: number, promise: Promise<unknown>) => {
  await promise;
  return chainID;
};

export { BridgeHandler, DestinationSwapHandler, SourceSwapsHandler, Swap };
