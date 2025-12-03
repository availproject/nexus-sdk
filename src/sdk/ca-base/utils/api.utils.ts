import {
  Bytes,
  GrpcWebImpl,
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
  BRIDGE_STEPS,
  BridgeStepType,
  getLogger,
  FeeStoreData,
  OraclePriceResponse,
  RFF,
  SponsoredApprovalDataArray,
  UnifiedBalanceResponseData,
  ChainListType,
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

const logger = getLogger();

let cosmosQueryClient: null | QueryClientImpl = null;

const getCosmosQueryClient = (grpcURL: string) => {
  if (!cosmosQueryClient) {
    const rpc = new GrpcWebImpl(grpcURL, {});
    cosmosQueryClient = new QueryClientImpl(rpc);
  }
  return cosmosQueryClient;
};

// const PAGE_LIMIT = 100;

// async function fetchMyIntents(address: string, grpcURL: string, page = 1) {
//   try {
//     const response = await getCosmosQueryClient(grpcURL).GetRequestForFunds({
//       account: address,
//       pagination: {
//         limit: PAGE_LIMIT,
//         offset: (page - 1) * PAGE_LIMIT,
//         reverse: true,
//       },
//     });
//     return response.requestForFunds;
//   } catch (error) {
//     logger.error('Failed to fetch intents', error);
//     throw Errors.cosmosError('Failed to fetch intents');
//   }
// }

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

async function fetchProtocolFees(grpcURL: string) {
  try {
    const response = await getCosmosQueryClient(grpcURL).GetProtocolFees({});
    return response;
  } catch (error) {
    logger.error('Failed to fetch protocol fees', error);
    throw Errors.cosmosError('Failed to fetch protocol fees');
  }
}

async function fetchSolverData(grpcURL: string) {
  try {
    const response = await getCosmosQueryClient(grpcURL).GetSolverData({});
    return response;
  } catch (error) {
    logger.error('Failed to fetch solver data', error);
    throw Errors.cosmosError('Failed to fetch solver data');
  }
}

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

const getFeeStore = async (grpcURL: string) => {
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
  const [p, s] = await Promise.allSettled([fetchProtocolFees(grpcURL), fetchSolverData(grpcURL)]);
  if (p.status === 'fulfilled') {
    logger.debug('getFeeStore', {
      collection: p.value.protocolFees?.collectionFees,
      fulfilment: p.value.protocolFees?.fulfilmentFees,
      protocol: p.value.protocolFees?.feeBP,
    });
    feeData.fee.protocol.feeBP = p.value.protocolFees?.feeBP.toString(10) ?? '0';
    feeData.fee.collection =
      p.value.protocolFees?.collectionFees.map((fee) => {
        return {
          chainID: bytesToNumber(fee.chainID),
          fee: bytesToNumber(fee.fee),
          tokenAddress: convertAddressByUniverse(toHex(fee.tokenAddress), fee.universe),
          universe: fee.universe,
        };
      }) ?? [];
    feeData.fee.fulfilment =
      p.value.protocolFees?.fulfilmentFees.map((fee) => {
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
      s.value.solverData?.advertisedFees.map((s) => {
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

const getVSCURL = (vscDomain: string, protocol: 'https' | 'wss') => {
  return `${protocol}://${vscDomain}`;
};

let vscReq: AxiosInstance | null = null;

const getVscReq = (vscDomain: string) => {
  vscReq ??= axios.create({
    baseURL: new URL('/api/v1', getVSCURL(vscDomain, 'https')).toString(),
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
  return vscReq;
};

export const getBalancesFromVSC = async (
  vscDomain: string,
  address: `0x${string}`,
  namespace: 'ETHEREUM' | 'TRON' = 'ETHEREUM',
) => {
  const response = await getVscReq(vscDomain).get<{
    balances: UnifiedBalanceResponseData[];
  }>(`/get-balance/${namespace}/${address}`);
  logger.debug('getBalancesFromVSC', { response });
  return response.data.balances.filter((b) => b.errored !== true);
};

export const getEVMBalancesForAddress = async (vscDomain: string, address: `0x${string}`) => {
  return getBalancesFromVSC(vscDomain, address);
};

export const getTronBalancesForAddress = async (vscDomain: string, address: `0x${string}`) => {
  return getBalancesFromVSC(vscDomain, address, 'TRON');
};

const vscCreateFeeGrant = async (vscDomain: string, address: string) => {
  const response = await getVscReq(vscDomain).post(`/create-feegrant`, {
    cosmos_address: address,
  });
  return response;
};

const vscPublishRFF = async (vscDomain: string, id: Long) => {
  const response = await getVscReq(vscDomain).post('/publish-rff', {
    id: id.toNumber(),
  });
  logger.debug('publishRFF', { response });
  return { id };
};

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

const vscCreateSponsoredApprovals = async (
  vscDomain: string,
  input: SponsoredApprovalDataArray,
) => {
  const connection = connect(
    new URL('/api/v1/create-sponsored-approvals', getVSCURL(vscDomain, 'wss')).toString(),
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
      status: 0x10; // Success
    }
  | {
      errored: true;
      idx: number;
      status: 0x1a; // could not collect
    };

const vscCreateRFF = async (
  vscDomain: string,
  id: Long,
  msd: (s: BridgeStepType) => void,
  expectedCollections: number[],
) => {
  const controller = new AbortController();
  const pendingCollections = expectedCollections.slice();
  const completedCollections: number[] = [];
  await retry(
    async () => {
      const connection = connect(
        new URL('/api/v1/create-deposits', getVSCURL(vscDomain, 'wss')).toString(),
      );
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
                  msd(BRIDGE_STEPS.INTENT_COLLECTION_COMPLETE);
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
                if (pendingCollections.includes(data.idx)) {
                  completedCollections.push(data.idx);
                  remove(pendingCollections, (d) => d === data.idx);
                }
                msd(
                  BRIDGE_STEPS.INTENT_COLLECTION(
                    completedCollections.length,
                    expectedCollections.length,
                  ),
                );
                break;
              }

              // Collection failed or is not applicable(say for native)
              default: {
                if (pendingCollections.includes(data.idx)) {
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
};

const checkIntentFilled = async (intentID: Long, grpcURL: string) => {
  const response = await getCosmosQueryClient(grpcURL).GetRequestForFunds({
    id: intentID,
  });
  if (response.requestForFunds?.fulfilled) {
    logger.debug('intent already filled', { response });
    return 'ok';
  }

  throw Errors.internal('not filled yet');
};

export {
  checkIntentFilled,
  // fetchMyIntents,
  fetchProtocolFees,
  fetchSolverData,
  getCoinbasePrices,
  getFeeStore,
  vscCreateFeeGrant,
  vscCreateRFF,
  vscCreateSponsoredApprovals,
  vscPublishRFF,
  getVSCURL,
};
