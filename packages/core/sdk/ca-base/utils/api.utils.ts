import { Bytes, GrpcWebImpl, QueryClientImpl, RequestForFunds, Universe } from '@arcana/ca-common';
import axios, { AxiosInstance } from 'axios';
import Decimal from 'decimal.js';
import { connect } from 'it-ws';
import Long from 'long';
import { pack, unpack } from 'msgpackr';
import { bytesToBigInt, bytesToNumber, toHex } from 'viem';

import { ChainList } from './common.utils';
import { getLogger } from '../logger';
import { ALLOWANCE_APPROVAL_MINED, INTENT_COLLECTION, INTENT_COLLECTION_COMPLETE } from '../steps';
import {
  ChainListType,
  FeeStoreData,
  OraclePriceResponse,
  RFF,
  SponsoredApprovalDataArray,
  StepInfo,
  UnifiedBalanceResponseData,
} from '@nexus/commons';
import {
  balancesToAssets,
  convertAddressByUniverse,
  convertToHexAddressByUniverse,
  divDecimals,
  equalFold,
  minutesToMs,
} from './common.utils';

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
    return intentTransform(response.requestForFunds);
  } catch (error) {
    logger.error('Failed to fetch intents', error);
    throw new Error('Failed to fetch intents');
  }
}

const intentTransform = (input: RequestForFunds[]): RFF[] => {
  return input.map((rff) => ({
    deposited: rff.deposited,
    destinationChainID: bytesToNumber(rff.destinationChainID),
    destinations: rff.destinations.map((d) => ({
      tokenAddress: convertToHexAddressByUniverse(d.tokenAddress, rff.destinationUniverse),
      value: bytesToBigInt(d.value),
    })),
    destinationUniverse: Universe[rff.destinationUniverse],
    expiry: rff.expiry.toNumber(),
    fulfilled: rff.fulfilled,
    id: rff.id.toNumber(),
    refunded: rff.refunded,
    sources: rff.sources.map((s) => ({
      chainID: bytesToNumber(s.chainID),
      tokenAddress: convertToHexAddressByUniverse(s.tokenAddress, s.universe),
      universe: Universe[s.universe],
      value: bytesToBigInt(s.value),
    })),
  }));
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

const fetchBalances = async (
  vscDomain: string,
  evmAddress: `0x${string}`,
  chainList: ChainListType,
  fuelAddress?: null | string,
) => {
  const [evmBalances, fuelBalances, rates] = await Promise.allSettled([
    getEVMBalancesForAddress(vscDomain, evmAddress),
    fuelAddress
      ? getFuelBalancesForAddress(vscDomain, fuelAddress as `0x${string}`)
      : Promise.resolve([]),
    getCoinbasePrices(),
  ]);
  logger.debug('unified balances', { evmBalances, fuelBalances });

  let balances: UnifiedBalanceResponseData[] = [];

  if (evmBalances.status === 'fulfilled') {
    balances = evmBalances.value.filter((b) => b.universe === Universe.ETHEREUM);
  }

  if (fuelBalances.status === 'fulfilled') {
    balances = [...balances, ...fuelBalances.value.filter((b) => b.universe === Universe.FUEL)];
  }

  return {
    ...balancesToAssets(balances, chainList),
    rates: rates.status === 'fulfilled' ? rates.value : {},
  };
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

const getEVMBalancesForAddress = async (vscDomain: string, address: `0x${string}`) => {
  const response = await getVscReq(vscDomain).get<{
    balances: UnifiedBalanceResponseData[];
  }>(`/get-balance/ETHEREUM/${address}`);

  logger.debug('getEVMBalancesForAddress', { response });
  return response.data.balances;
};

const getFuelBalancesForAddress = async (vscDomain: string, address: `0x${string}`) => {
  const response = await getVscReq(vscDomain).get<{
    balances: UnifiedBalanceResponseData[];
  }>(`/get-balance/FUEL/${address}`);
  return response.data.balances;
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
  msd?: (s: StepInfo, data?: { [k: string]: unknown }) => void,
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
        throw new Error(data.error);
      }

      if ('error' in data && data.error) {
        throw new Error(data.msg);
      }

      if (msd) {
        msd(ALLOWANCE_APPROVAL_MINED(bytesToNumber(input[data.part_idx].chain_id)));
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
  | { status: 255 };

const vscCreateRFF = async (
  vscDomain: string,
  id: Long,
  msd: (s: StepInfo, data?: { [k: string]: unknown }) => void,
  expectedCollectionIndexes: number[],
) => {
  const receivedCollectionsACKs = [];
  const connection = connect(new URL('/api/v1/create-rff', getVSCURL(vscDomain, 'wss')).toString());
  await connection.connected();

  logger.debug('vscCreateRFF', {
    expectedCollectionIndexes,
  });

  try {
    connection.socket.send(pack({ id: id.toNumber() }));

    for await (const resp of connection.source) {
      const data: VSCCreateRFFResponse = unpack(resp);

      logger.debug('vscCreateRFF:response', { data });

      if (data.status === 255) {
        if (expectedCollectionIndexes.length === receivedCollectionsACKs.length) {
          msd(INTENT_COLLECTION_COMPLETE);
          break;
        } else {
          logger.debug('(vsc)create-rff:collections failed', {
            expectedCollectionIndexes,
            receivedCollectionsACKs,
          });
          throw new Error('(vsc)create-rff: collections failed');
        }
      } else if (data.status === 16) {
        if (expectedCollectionIndexes.includes(data.idx)) {
          receivedCollectionsACKs.push(data.idx);
        }
        msd(INTENT_COLLECTION(receivedCollectionsACKs.length), {
          confirmed: receivedCollectionsACKs.length,
          total: expectedCollectionIndexes.length,
        });
      } else {
        if (expectedCollectionIndexes.includes(data.idx)) {
          throw new Error(`(vsc)create-rff: ${data.error}`);
        } else {
          logger.debug('vscCreateRFF:ExpectedError:ignore', { data });
        }
      }
    }
  } finally {
    connection.close();
  }
};

const checkIntentFilled = async (intentID: Long, grpcURL: string) => {
  const response = await getCosmosQueryClient(grpcURL).RequestForFunds({
    id: intentID,
  });
  if (response.requestForFunds?.fulfilled) {
    return 'ok';
  }

  throw new Error('not filled yet');
};

export {
  checkIntentFilled,
  fetchBalances,
  fetchMyIntents,
  fetchPriceOracle,
  fetchProtocolFees,
  fetchSolverData,
  getCoinbasePrices,
  getFeeStore,
  getVSCURL,
  vscCreateFeeGrant,
  vscCreateRFF,
  vscCreateSponsoredApprovals,
  vscPublishRFF,
};
