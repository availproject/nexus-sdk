import {
  Bytes,
  createGrpcWebImpl,
  QueryClientImpl,
  RequestForFunds,
  Universe,
} from '@avail-project/ca-common';
import axios, { AxiosInstance } from 'axios';
import Decimal from 'decimal.js';
import { connect } from 'it-ws/client';
import Long from 'long';
import { pack, unpack } from 'msgpackr';
import { bytesToBigInt, bytesToNumber, Hex, toHex } from 'viem';
import {
  getLogger,
  FeeStoreData,
  OraclePriceResponse,
  RFF,
  SponsoredApprovalDataArray,
  UnifiedBalanceResponseData,
  ChainListType,
  VSCClient,
  CosmosQueryClient,
  SBCTx,
} from '../../../commons';
import {
  convertAddressByUniverse,
  convertToHexAddressByUniverse,
  divDecimals,
  equalFold,
  getExplorerURL,
  minutesToMs,
} from './common.utils';
import { Errors } from '../errors';
import { remove, retry } from 'es-toolkit';

type CreateSponsoredApprovalResponse =
  | {
      error: string;
      errored: true;
      msg: string;
      part_idx: number;
    }
  | { error: true; msg: string } // why error not same struct?
  | {
      errored: false;
      part_idx: number;
      tx_hash: Bytes;
    };

type VSCCreateRFFResponse =
  // Global
  | {
      error: true;
      errored: true;
      code: 0x13; // Fee changed
    }
  | {
      error: true;
      errored: true;
      code: 0x12; // Already deposited everything
    }
  | { status: 0xff; idx: 0; errored: false } // transmission complete, if no global error
  // Local
  | {
      errored: false;
      idx: number;
      tx_hash: Bytes;
      status: 0x10; // Success
    }
  | {
      errored: true;
      idx: number;
      status: 0x1a; // could not collect
    };

const PAGE_LIMIT = 100;
const logger = getLogger();
const decoder = new TextDecoder('utf-8');

const createCosmosQueryClient = async ({
  cosmosRestUrl,
  cosmosGrpcWebUrl,
  cosmosWsUrl,
}: {
  cosmosRestUrl: string;
  cosmosGrpcWebUrl: string;
  cosmosWsUrl: string;
}): Promise<CosmosQueryClient> => {
  // :| smh
  const rpc = await createGrpcWebImpl(cosmosGrpcWebUrl);
  const cosmosQueryClient = new QueryClientImpl(rpc);

  return {
    fetchMyIntents: async (address: string, page = 1) => {
      try {
        const response = await cosmosQueryClient.RequestForFundsByAddress({
          account: address,
          pagination: {
            limit: PAGE_LIMIT,
            offset: (page - 1) * PAGE_LIMIT,
            reverse: true,
          },
        });
        return response.requestForFunds;
      } catch (error) {
        logger.error('Failed to fetch intents', error);
        throw Errors.cosmosError('Failed to fetch intents');
      }
    },
    fetchProtocolFees: async () => {
      try {
        const response = await cosmosQueryClient.ProtocolFees({});
        return response;
      } catch (error) {
        logger.error('Failed to fetch protocol fees', error);
        throw Errors.cosmosError('Failed to fetch protocol fees');
      }
    },
    fetchSolverData: async () => {
      try {
        const response = await cosmosQueryClient.SolverDataAll({});
        return response;
      } catch (error) {
        logger.error('Failed to fetch solver data', error);
        throw Errors.cosmosError('Failed to fetch solver data');
      }
    },
    fetchPriceOracle: async () => {
      const data = await cosmosQueryClient.PriceOracleData({});
      if (data.PriceOracleData?.priceData?.length) {
        const oracleRates: OraclePriceResponse = data.PriceOracleData?.priceData.map((data) => ({
          chainId: bytesToNumber(data.chainID),
          priceUsd: new Decimal(bytesToNumber(data.price)).div(Decimal.pow(10, data.decimals)),
          tokenAddress: convertAddressByUniverse(toHex(data.tokenAddress), data.universe),
          tokensPerUsd: new Decimal(1).div(
            new Decimal(bytesToNumber(data.price)).div(Decimal.pow(10, data.decimals)),
          ),
        }));
        return oracleRates;
      }
      throw Errors.internal('No price data found.');
    },
    checkIntentFilled: async (intentID: Long) => {
      const response = await cosmosQueryClient.RequestForFunds({
        id: intentID,
      });
      if (response.requestForFunds?.fulfilled) {
        logger.debug('intent already filled', { response });
        return 'ok';
      }

      throw Errors.internal('not filled yet');
    },
    getAccount: async (address: string) => {
      await axios.get(`/cosmos/auth/v1beta1/accounts/${address}`, {
        baseURL: cosmosRestUrl,
      });
    },

    waitForCosmosFillEvent: async (intentID: Long, ac: AbortController) => {
      const connection = connect(new URL(cosmosWsUrl).toString());
      await connection.connected();

      ac.signal.addEventListener(
        'abort',
        () => {
          connection.close();
          return Promise.resolve('ok from outside');
        },
        { once: true },
      );

      const EVENT = 'xarchain.chainabstraction.RFFFulfilledEvent.id';

      try {
        connection.socket.send(
          JSON.stringify({
            id: '0',
            jsonrpc: '2.0',
            method: 'subscribe',
            params: {
              query: `${EVENT}='"${intentID}"'`,
            },
          }),
        );

        for await (const resp of connection.source) {
          logger.debug('waitForCosmosFillEvent', {
            resp,
          });
          const decodedResponse = JSON.parse(decoder.decode(resp));
          if (
            decodedResponse.result.events &&
            EVENT in decodedResponse.result.events &&
            decodedResponse.result.events[EVENT].includes(`"${intentID}"`)
          ) {
            ac.abort();
            return 'ok';
          }
        }

        throw Errors.cosmosError('waitForCosmosFillEvent: out of loop but no events');
      } finally {
        connection.close();
      }
    },
  };
};

export const intentTransform = (
  input: RequestForFunds[],
  explorerBaseURL: string,
  chainList: ChainListType,
): RFF[] => {
  return input.map((rff) => {
    const dstChainId = bytesToNumber(rff.destinationChainID);
    const dstChain = chainList.getChainByID(dstChainId);
    if (!dstChain) {
      throw Errors.chainNotFound(dstChainId);
    }
    return {
      explorerUrl: getExplorerURL(explorerBaseURL, rff.id),
      deposited: rff.deposited,
      destinationChain: {
        id: dstChain.id,
        name: dstChain.name,
        logo: dstChain.custom.icon,
        universe: Universe[rff.destinationUniverse],
      },
      destinations: rff.destinations.map((d) => {
        const contractAddress = convertToHexAddressByUniverse(
          d.contractAddress,
          rff.destinationUniverse,
        );
        const token = chainList.getTokenByAddress(dstChainId, contractAddress);
        if (!token) {
          throw Errors.tokenNotSupported(contractAddress, dstChainId);
        }
        const valueRaw = bytesToBigInt(d.value);
        return {
          token: {
            address: contractAddress,
            symbol: token.symbol,
            decimals: token.decimals,
          },
          valueRaw,
          value: divDecimals(valueRaw, token.decimals).toFixed(token.decimals),
        };
      }),
      fulfilledAt: rff.fulfilledAt.toNumber(),
      expiry: rff.expiry.toNumber(),
      fulfilled: rff.fulfilled,
      id: rff.id.toNumber(),
      refunded: rff.refunded,
      sources: rff.sources.map((s) => {
        const chainId = bytesToNumber(s.chainID);
        const contractAddress = convertToHexAddressByUniverse(s.contractAddress, s.universe);
        const result = chainList.getChainAndTokenByAddress(chainId, contractAddress);
        if (!result?.token) {
          throw Errors.tokenNotSupported(contractAddress, chainId);
        }
        const valueRaw = bytesToBigInt(s.value);
        return {
          chain: {
            id: result.chain.id,
            name: result.chain.name,
            logo: result.chain.custom.icon,
            universe: Universe[s.universe],
          },
          value: divDecimals(valueRaw, result.token.decimals).toFixed(result.token.decimals),
          valueRaw,
          token: {
            address: contractAddress,
            symbol: result.token.symbol,
            decimals: result.token.decimals,
          },
        };
      }),
    };
  });
};

const coinbasePrices = {
  lastUpdatedAt: 0,
  rates: {},
};

const COINBASE_UPDATE_INTERVAL = minutesToMs(1);

const getCoinbasePrices = async () => {
  if (coinbasePrices.lastUpdatedAt + COINBASE_UPDATE_INTERVAL < Date.now()) {
    try {
      const exchange = await axios.get<{
        data: { rates: Record<string, string> };
      }>('https://api.coinbase.com/v2/exchange-rates?currency=USD');
      coinbasePrices.rates = exchange.data.data.rates;
      coinbasePrices.lastUpdatedAt = Date.now();
    } catch (error) {
      logger.error('Failed to fetch Coinbase prices', error, { cause: 'INTERNAL_ERROR' });
      // Return cached rates if available, otherwise throw
      if (Object.keys(coinbasePrices.rates).length === 0) {
        throw Errors.internal('Failed to fetch exchange rates and no cache available');
      }
    }
  }
  return coinbasePrices.rates;
};

export class FeeStore {
  constructor(readonly data: FeeStoreData) {}

  public calculateCollectionFee({
    decimals,
    sourceChainID,
    sourceTokenAddress,
  }: {
    decimals: number;
    sourceChainID: number;
    sourceTokenAddress: `0x${string}`;
  }) {
    const collectionFee = this.data.fee.collection.find((f) => {
      return Number(f.chainID) === sourceChainID && equalFold(f.tokenAddress, sourceTokenAddress);
    });

    if (!collectionFee) {
      return new Decimal(0);
    }

    return divDecimals(collectionFee.fee ?? 0, decimals);
  }

  public calculateFulfilmentFee({
    decimals,
    destinationChainID,
    destinationTokenAddress,
  }: {
    decimals: number;
    destinationChainID: number;
    destinationTokenAddress: `0x${string}`;
  }) {
    const fulfilmentFeeBasis = this.data.fee.fulfilment.find((f) => {
      return (
        Number(f.chainID) === destinationChainID &&
        equalFold(f.tokenAddress, destinationTokenAddress)
      );
    });

    if (!fulfilmentFeeBasis) {
      return new Decimal(0);
    }
    return new Decimal(fulfilmentFeeBasis.fee ?? 0).div(Decimal.pow(10, decimals));
  }

  public calculateProtocolFee(borrow: Decimal) {
    const protocolFeeBasis = new Decimal(this.data.fee.protocol.feeBP ?? 0).div(Decimal.pow(10, 4));
    return borrow.mul(protocolFeeBasis);
  }

  public calculateSolverFee({
    borrowAmount,
    decimals,
    destinationChainID,
    destinationTokenAddress,
    sourceChainID,
    sourceTokenAddress,
  }: {
    borrowAmount: Decimal;
    decimals: number;
    destinationChainID: number;
    destinationTokenAddress: `0x${string}`;
    sourceChainID: number;
    sourceTokenAddress: `0x${string}`;
  }) {
    const solverFeeBP =
      this.data.solverRoutes.find((f) => {
        return (
          Number(f.sourceChainID) === sourceChainID &&
          Number(f.destinationChainID) === destinationChainID &&
          equalFold(f.sourceTokenAddress, sourceTokenAddress) &&
          equalFold(f.destinationTokenAddress, destinationTokenAddress)
        );
      })?.feeBP ?? 0;

    return new Decimal(solverFeeBP ?? 0)
      .div(Decimal.pow(10, 4))
      .mul(borrowAmount)
      .toDP(decimals, Decimal.ROUND_CEIL);
  }
}

const getFeeStore = async (grpcClient: Awaited<ReturnType<typeof createCosmosQueryClient>>) => {
  const feeData: FeeStoreData = {
    fee: {
      collection: [],
      fulfilment: [],
      protocol: {
        feeBP: '0',
      },
    },
    solverRoutes: [],
  };
  const [p, s] = await Promise.allSettled([
    grpcClient.fetchProtocolFees(),
    grpcClient.fetchSolverData(),
  ]);
  if (p.status === 'fulfilled') {
    logger.debug('getFeeStore', {
      collection: p.value.ProtocolFees?.collectionFees,
      fulfilment: p.value.ProtocolFees?.fulfilmentFees,
      protocol: p.value.ProtocolFees?.feeBP,
    });
    feeData.fee.protocol.feeBP = p.value.ProtocolFees?.feeBP.toString(10) ?? '0';
    feeData.fee.collection =
      p.value.ProtocolFees?.collectionFees.map((fee) => {
        return {
          chainID: bytesToNumber(fee.chainID),
          fee: bytesToNumber(fee.fee),
          tokenAddress: convertAddressByUniverse(toHex(fee.tokenAddress), fee.universe),
          universe: fee.universe,
        };
      }) ?? [];
    feeData.fee.fulfilment =
      p.value.ProtocolFees?.fulfilmentFees.map((fee) => {
        return {
          chainID: bytesToNumber(fee.chainID),
          fee: bytesToNumber(fee.fee),
          tokenAddress: convertAddressByUniverse(toHex(fee.tokenAddress), fee.universe),
          universe: fee.universe,
        };
      }) ?? [];
  }
  if (s.status === 'fulfilled') {
    feeData.solverRoutes =
      s.value.solverData[0]?.advertisedFees.map((s) => {
        return {
          destinationChainID: bytesToNumber(s.destinationChainID),
          destinationTokenAddress: convertAddressByUniverse(
            toHex(s.destinationTokenAddress),
            s.destinationUniverse,
          ),
          destinationUniverse: s.destinationUniverse,
          feeBP: s.feeBP,
          sourceChainID: bytesToNumber(s.sourceChainID),
          sourceTokenAddress: convertAddressByUniverse(
            toHex(s.sourceTokenAddress),
            s.sourceUniverse,
          ),
          sourceUniverse: s.sourceUniverse,
        };
      }) || [];
  }
  return new FeeStore(feeData);
};

const createVSCClient = ({ vscWsUrl, vscUrl }: { vscWsUrl: string; vscUrl: string }): VSCClient => {
  const instance = axios.create({
    baseURL: new URL('/api/v1', vscUrl).toString(),
    headers: {
      Accept: 'application/msgpack',
    },
    responseType: 'arraybuffer',
    transformRequest: [
      function (data, headers) {
        if (['get', 'head'].includes((this.method as string).toLowerCase())) return;
        headers['Content-Type'] = 'application/msgpack';
        return pack(data);
      },
    ],
    transformResponse: [(data) => unpack(data)],
  });

  return {
    getEVMBalancesForAddress: async (address: `0x${string}`) => {
      return getBalancesFromVSC(instance, address);
    },
    getTronBalancesForAddress: async (address: `0x${string}`) => {
      return getBalancesFromVSC(instance, address, 'TRON');
    },
    vscCreateFeeGrant: async (address: string) => {
      const response = await instance.post(`/create-feegrant`, {
        cosmos_address: address,
      });
      return response;
    },
    vscPublishRFF: async (id: Long) => {
      const response = await instance.post('/publish-rff', {
        id: id.toNumber(),
      });
      logger.debug('publishRFF', { response });
      return { id };
    },
    vscCreateSponsoredApprovals: async (input: SponsoredApprovalDataArray) => {
      const connection = connect(
        new URL('/api/v1/create-sponsored-approvals', vscWsUrl).toString(),
      );

      await connection.connected();

      const approvalHashes: { chainId: number; hash: Hex }[] = [];

      try {
        connection.socket.send(pack(input));

        for await (const resp of connection.source) {
          const data: CreateSponsoredApprovalResponse = unpack(resp);

          logger.debug('vscCreateSponsoredApprovals', { data });

          if ('errored' in data && data.errored) {
            throw Errors.vscError(
              `failed to create sponsored approvals: ${data.msg ?? 'Backend sent failure.'}`,
            );
          }

          if ('error' in data && data.error) {
            throw Errors.vscError(
              `failed to create sponsored approvals: ${data.msg ?? 'Backend sent failure.'}`,
            );
          }

          const inputData = input[data.part_idx];

          approvalHashes.push({
            chainId: bytesToNumber(inputData.chain_id),
            hash: toHex(data.tx_hash),
          });

          if (approvalHashes.length == input.length) {
            break;
          }
        }

        return approvalHashes;
      } finally {
        connection.close();
      }
    },
    vscCreateRFF: async (
      id: Long,
      msd: (s: { current: number; total: number; txHash: Hex; chainId: number }) => void,
      expectedCollections: { index: number; chainId: number }[],
    ) => {
      const controller = new AbortController();
      const pendingCollections = expectedCollections.slice();
      const completedCollections: number[] = [];
      await retry(
        async () => {
          const connection = connect(new URL('/api/v1/create-rff', vscWsUrl).toString());
          try {
            await connection.connected();
            connection.socket.send(pack({ id: id.toNumber() }));
            responseLoop: for await (const resp of connection.source) {
              const data: VSCCreateRFFResponse = unpack(resp);

              logger.debug('vscCreateRFF:response', { data });
              if ('idx' in data) {
                // local msg
                switch (data.status) {
                  // Will be called at the end of all calls, regardless of status
                  case 0xff: {
                    if (pendingCollections.length === 0) {
                      break responseLoop;
                    } else {
                      logger.debug('(vsc)create-rff:collections failed', {
                        expectedCollections,
                        completedCollections,
                      });
                      throw Errors.vscError(
                        `create-rff: collections failed. expected = ${expectedCollections}, got = ${completedCollections}`,
                      );
                    }
                  }
                  // Collection successful for a chain
                  case 0x10: {
                    const pendingCollection = pendingCollections.find(
                      (pc) => pc.index === data.idx,
                    );
                    if (pendingCollection) {
                      completedCollections.push(data.idx);
                      remove(pendingCollections, (d) => d.index === data.idx);
                      msd({
                        current: completedCollections.length,
                        total: expectedCollections.length,
                        txHash: toHex(data.tx_hash),
                        chainId: pendingCollection.chainId,
                      });
                    }
                    break;
                  }

                  // Collection failed or is not applicable(say for native)
                  default: {
                    if (pendingCollections.find((pc) => pc.index === data.idx)) {
                      logger.debug(`vsc:create-rff:failed`, { data });
                    } else {
                      logger.debug('vsc:create-rff:expectedError:ignore', { data });
                    }
                  }
                }
              } else {
                if (data.code === 0x13) {
                  controller.abort(Errors.rFFFeeExpired());
                  throw Errors.rFFFeeExpired();
                } else if (data.code === 0x12) {
                  break;
                } else {
                  throw Errors.vscError('create-rff: unhandled error', data);
                }
              }
            }
          } finally {
            connection.close();
          }
        },
        {
          retries: 3,
          signal: controller.signal,
        },
      );
    },
    vscSBCTx: async (input: SBCTx[]) => {
      const ops: [bigint, Hex][] = [];
      const connection = connect(new URL('/api/v1/create-sbc-tx', vscWsUrl).toString());

      try {
        await connection.connected();
        connection.socket.send(pack(input));
        let count = 0;
        for await (const response of connection.source) {
          const data: {
            errored: boolean;
            part_idx: number;
            tx_hash: Uint8Array;
          } = unpack(response);

          logger.debug('vscSBCTx', { data });

          if (data.errored) {
            throw Errors.internal('Error in VSC SBC Tx');
          }

          ops.push([bytesToBigInt(input[data.part_idx].chain_id), toHex(data.tx_hash)]);

          count += 1;

          if (count === input.length) {
            break;
          }
        }
      } finally {
        await connection.close();
      }
      return ops;
    },
  };
};

export const getBalancesFromVSC = async (
  instance: AxiosInstance,
  address: `0x${string}`,
  namespace: 'ETHEREUM' | 'TRON' = 'ETHEREUM',
) => {
  const response = await instance.get<{
    balances: UnifiedBalanceResponseData[];
  }>(`/get-balance/${namespace}/${address}`);
  logger.debug('getBalancesFromVSC', { address, namespace, response });
  return response.data.balances.filter((b) => b.errored !== true);
};

export { getCoinbasePrices, getFeeStore, createCosmosQueryClient, createVSCClient };
