import type { BridgeParams, IBridgeOptions } from '../../../commons';
import { Errors } from '../errors';
import {
  calculateMaxBridgeFee,
  getBalancesForBridge,
  getFeeStore,
  mulDecimals,
  UserAssets,
} from '../utils';

const getMaxValueForBridge = async (
  params: Omit<BridgeParams, 'amount' | 'recipient'>,
  options: Omit<IBridgeOptions, 'cosmos' | 'hooks' | 'events'>
) => {
  const token = options.chainList.getTokenInfoBySymbol(params.toChainId, params.token);
  if (!token) {
    throw Errors.tokenNotFound(params.token, params.toChainId);
  }

  const [assets, feeStore] = await Promise.all([
    getBalancesForBridge({
      vscClient: options.vscClient,
      evmAddress: options.evm.address,
      chainList: options.chainList,
      tronAddress: options.tron?.address,
    }),
    getFeeStore(options.cosmosQueryClient),
  ]);

  const userAssets = new UserAssets(assets);

  // FIXME: error in asset.find use NexusError and better messaging.
  const tokenAsset = userAssets.find(params.token);

  const { maxAmount, sourceChainIds } = calculateMaxBridgeFee({
    assets: tokenAsset.getBridgeAssets(params.toChainId),
    feeStore: feeStore,
    dst: {
      chainId: params.toChainId,
      tokenAddress: token.contractAddress,
      decimals: token.decimals,
    },
  });

  return {
    sourceChainIds,
    amountRaw: mulDecimals(maxAmount, token.decimals),
    amount: maxAmount,
    symbol: token.symbol,
  };
};

export default getMaxValueForBridge;
