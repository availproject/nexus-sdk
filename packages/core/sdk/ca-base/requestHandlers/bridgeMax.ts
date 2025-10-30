import { BridgeParams, IBridgeOptions } from '@nexus/commons';
import { getBalances, calculateMaxBridgeFee, getFeeStore, mulDecimals, UserAssets } from '../utils';
import { Errors } from '../errors';

const getMaxValueForBridge = async (
  params: Omit<BridgeParams, 'amount' | 'recipient'>,
  options: Omit<IBridgeOptions, 'cosmos' | 'hooks' | 'events'>,
) => {
  const token = options.chainList.getTokenInfoBySymbol(params.chainId, params.token);
  if (!token) {
    throw Errors.tokenNotFound(params.token, params.chainId);
  }

  const [balances, feeStore] = await Promise.all([
    getBalances({
      networkHint: options.networkConfig.NETWORK_HINT,
      vscDomain: options.networkConfig.VSC_DOMAIN,
      evmAddress: options.evm.address,
      chainList: options.chainList,
      fuelAddress: options.fuel?.address,
      tronAddress: options.tron?.address,
      isCA: true,
    }),
    getFeeStore(options.networkConfig.GRPC_URL),
  ]);

  const assets = new UserAssets(balances.assets);

  // FIXME: error in asset.find use NexusError and better messaging.
  const tokenAsset = assets.find(params.token);

  const { maxAmount } = calculateMaxBridgeFee({
    assets: tokenAsset.getBridgeAssets(params.chainId),
    feeStore: feeStore,
    dst: {
      chainId: params.chainId,
      tokenAddress: token.contractAddress,
      decimals: token.decimals,
    },
  });

  return {
    amountRaw: mulDecimals(maxAmount, token.decimals),
    amount: maxAmount,
    symbol: token.symbol,
  };
};

export default getMaxValueForBridge;
