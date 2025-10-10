import { Universe } from '@arcana/ca-common';
import {
  Account,
  Address,
  AssembleTxParams,
  AssembleTxResponse,
  bn,
  BN,
  CoinTransactionRequestOutput,
  FakeResources,
  Provider as FuelProvider,
  hexlify,
  OutputType,
  Provider,
  ProviderOptions,
  randomBytes,
  Resource,
  TransactionRequest,
  UTXO_ID_LEN,
} from 'fuels';

import { FUEL_BASE_ASSET_ID, FUEL_NETWORK_URL } from '../../constants';
import { getLogger } from '../../logger';
import { Chain, UserAssetDatum } from '@nexus/commons';
import { equalFold, mulDecimals } from '../../utils';

const logger = getLogger();

const getFuelProvider = (
  getBalances: () => Promise<UserAssetDatum[]>,
  address: string,
  chain: Chain,
): Provider => {
  return new (class Provider extends FuelProvider {
    constructor(url: string, options?: ProviderOptions) {
      super(url, { ...options, resourceCacheTTL: -1 });
    }

    async assembleTx<T extends TransactionRequest>(
      params: AssembleTxParams<T>,
    ): Promise<AssembleTxResponse<T>> {
      const { request } = params;
      logger.debug('ffProvider', {
        request,
      });
      const addr = new Address(address);

      const balances = await getBalances();
      const assetIdsOnFuel = chain.custom.knownTokens.map((c) => c.contractAddress);

      const outputAssetList: CoinTransactionRequestOutput[] = request.outputs.filter(
        (o) => o.type === OutputType.Coin,
      );

      const allAssetSupported = outputAssetList.every((a) =>
        assetIdsOnFuel.includes(hexlify(a.assetId) as `0x${string}`),
      );

      logger.debug('FuelProvide:1', {
        allAssetSupported,
        assetIdsOnFuel,
        outputAssetList,
      });

      if (!allAssetSupported) {
        return super.assembleTx({
          ...params,
          feePayerAccount: new Account(addr),
          request,
        });
      }

      const al = [];
      for (const a of assetIdsOnFuel) {
        if (!outputAssetList.map((al) => al.assetId).includes(a) && a !== FUEL_BASE_ASSET_ID) {
          continue;
        }
        const asset = balances.find((asset) =>
          asset.breakdown.find(
            (b) => equalFold(b.contractAddress, hexlify(a)) && b.universe === Universe.FUEL,
          ),
        );

        const chainAsset = asset?.breakdown.find(
          (b) => equalFold(b.contractAddress, hexlify(a)) && b.universe === Universe.FUEL,
        );

        logger.debug('FuelProvider:2', {
          asset,
          chainAsset,
        });

        if (asset && chainAsset) {
          const decimals = equalFold(FUEL_BASE_ASSET_ID, chainAsset.contractAddress)
            ? 9
            : asset.decimals;

          const amount = new BN(mulDecimals(asset.balance, decimals).toString());

          logger.debug('FuelProvider:3', {
            amount,
            assetId: hexlify(a),
          });

          al.push({
            amount,
            assetId: hexlify(a),
          });
        }
      }

      request.addResources(generateFakeResources(al, new Address(address)));

      const { accountCoinQuantities, ...rest } = params;

      logger.debug('FuelProvider:4', {
        accountCoinQuantities,
        params: { ...params },
        request,
        rest,
      });

      const response = await super.assembleTx({
        ...rest,
        request,
      });

      logger.debug('FuelProvider:4', {
        accountCoinQuantities,
        params: { ...params },
        request,
        response,
      });
      return response as AssembleTxResponse<T>;
    }
  })(FUEL_NETWORK_URL);
};

const generateFakeResources = (coins: FakeResources[], address: Address): Array<Resource> => {
  return coins.map((coin) => ({
    blockCreated: bn(1),
    id: hexlify(randomBytes(UTXO_ID_LEN)),
    owner: address,
    txCreatedIdx: bn(1),
    ...coin,
  }));
};

export { getFuelProvider };
