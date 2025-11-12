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
import { bytesToBigInt, bytesToNumber, toHex } from 'viem';
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
} from '@nexus/commons';
import {
  convertAddressByUniverse,
  convertToHexAddressByUniverse,
  divDecimals,
  equalFold,
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

const PAGE_LIMIT = 100;

async function fetchMyIntents(address: string, grpcURL: string, page = 1) {
  try {
    const response = await getCosmosQueryClient(grpcURL).RequestForFundsByAddress({
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
    throw new Error('Failed to fetch intents');
  }
}

export const intentTransform = (input: RequestForFunds[], chainList: ChainListType): RFF[] => {
  return input.map((rff) => {
    const dstChainId = bytesToNumber(rff.destinationChainID);
    const dstChain = chainList.getChainByID(dstChainId);
    if (!dstChain) {
      throw Errors.chainNotFound(dstChainId);
    }
    return {
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
      expiry: rff.expiry.toNumber(),
      fulfilled: rff.fulfilled,
      id: rff.id.toNumber(),
      refunded: rff.refunded,
      sources: rff.sources.map((s) => {
        const chainId = bytesToNumber(s.chainID);
        const contractAddress = convertToHexAddressByUniverse(s.contractAddress, s.universe);
        const result = chainList.getChainAndTokenByAddress(chainId, contractAddress);
        if (!result || !result.token) {
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
    const response = await getCosmosQueryClient(grpcURL).ProtocolFees({
      Universe: Universe.FUEL,
    });
    return response;
  } catch (error) {
    logger.error('Failed to fetch protocol fees', error);
    throw new Error('Failed to fetch protocol fees');
  }
}

async function fetchSolverData(grpcURL: string) {
  try {
    const response = await getCosmosQueryClient(grpcURL).SolverDataAll({});
    return response;
  } catch (error) {
    logger.error('Failed to fetch solver data', error);
    throw new Error('Failed to fetch solver data');
  }
}

const fetchPriceOracle = async (grpcURL: string) => {
  const data = await getCosmosQueryClient(grpcURL).PriceOracleData({});
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
  throw new Error('InternalError: No price data found.');
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
      logger.error('Failed to fetch Coinbase prices', error);
      // Return cached rates if available, otherwise throw
      if (Object.keys(coinbasePrices.rates).length === 0) {
        throw new Error('Failed to fetch exchange rates and no cache available');
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

const getVSCURL = (vscDomain: string, protocol: 'https' | 'wss') => {
  return `${protocol}://${vscDomain}`;
};

let vscReq: AxiosInstance | null = null;

const getVscReq = (vscDomain: string) => {
  if (!vscReq) {
    vscReq = axios.create({
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
  }
  return vscReq;
};

export const getBalancesFromVSC = async (
  vscDomain: string,
  address: `0x${string}`,
  namespace: 'ETHEREUM' | 'FUEL' | 'TRON' = 'ETHEREUM',
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

export const getFuelBalancesForAddress = async (vscDomain: string, address: `0x${string}`) => {
  return getBalancesFromVSC(vscDomain, address, 'FUEL');
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
  msd?: (s: BridgeStepType) => void,
) => {
  const connection = connect(
    new URL('/api/v1/create-sponsored-approvals', getVSCURL(vscDomain, 'wss')).toString(),
  );

  await connection.connected();

  try {
    connection.socket.send(pack(input));

    let count = 0;
    for await (const resp of connection.source) {
      const data: CreateSponsoredApprovalResponse = unpack(resp);

      logger.debug('vscCreateSponsoredApprovals', { data });

      if ('errored' in data && data.errored) {
        throw Errors.vscError(`create-sponsored-approvals: ${data.error}`);
      }

      if ('error' in data && data.error) {
        throw Errors.vscError(`create-sponsored-approvals: ${data.error}`);
      }

      if (msd) {
        msd(
          BRIDGE_STEPS.ALLOWANCE_APPROVAL_MINED({
            id: bytesToNumber(input[data.part_idx].chain_id),
          }),
        );
      }

      count += 1;
      if (count == input.length) {
        break;
      }
    }
    return 'ok';
  } finally {
    connection.close();
  }
};

type VSCCreateRFFResponse =
  | {
      error: string;
      errored: true;
      idx: number;
      status: 26;
    }
  | {
      errored: false;
      idx: number;
      status: 16;
    }
  | { status: 255 }
  | { status: 19 };

const vscCreateRFF = async (
  vscDomain: string,
  id: Long,
  msd: (s: BridgeStepType) => void,
  expectedCollectionIndexes: number[],
) => {
  const controller = new AbortController();
  const collectionIndexes = expectedCollectionIndexes.slice();
  const receivedCollectionsACKs: number[] = [];
  await retry(
    async () => {
      const connection = connect(
        new URL('/api/v1/create-rff', getVSCURL(vscDomain, 'wss')).toString(),
      );
      try {
        await connection.connected();
        connection.socket.send(pack({ id: id.toNumber() }));
        for await (const resp of connection.source) {
          const data: VSCCreateRFFResponse = unpack(resp);

          logger.debug('vscCreateRFF:response', { data });

          switch (data.status) {
            // Will be called at the end of all calls, regardless of status
            case 255: {
              if (collectionIndexes.length === 0) {
                msd(BRIDGE_STEPS.INTENT_COLLECTION_COMPLETE);
                break;
              } else {
                logger.debug('(vsc)create-rff:collections failed', {
                  expectedCollectionIndexes,
                  receivedCollectionsACKs,
                });
                throw Errors.vscError('create-rff: some collections failed, retrying.');
              }
            }
            // Collection successful for a chain
            case 16: {
              if (collectionIndexes.includes(data.idx)) {
                receivedCollectionsACKs.push(data.idx);
                remove(collectionIndexes, (d) => d === data.idx);
              }
              msd(
                BRIDGE_STEPS.INTENT_COLLECTION(
                  receivedCollectionsACKs.length,
                  expectedCollectionIndexes.length,
                ),
              );
              break;
            }
            // When fee expires
            case 19: {
              // break out of retries
              controller.abort(Errors.rFFFeeExpired());
              // force it to rebuild intent
              throw Errors.rFFFeeExpired();
            }
            // Collection failed or is not applicable(say for native)
            default: {
              if (collectionIndexes.includes(data.idx)) {
                logger.debug(`vsc:create-rff:failed`, { data });
              } else {
                logger.debug('vsc:create-rff:expectedError:ignore', { data });
              }
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
  const response = await getCosmosQueryClient(grpcURL).RequestForFunds({
    id: intentID,
  });
  if (response.requestForFunds?.fulfilled) {
    logger.debug('intent already filled', { response });
    return 'ok';
  }

  throw new Error('not filled yet');
};

export {
  checkIntentFilled,
  fetchMyIntents,
  fetchPriceOracle,
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
