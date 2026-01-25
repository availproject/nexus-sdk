import { BridgeParams, IBridgeOptions } from '../../../commons';
import { getBalances, calculateMaxBridgeFee, getFeeStore, mulDecimals, UserAssets } from '../utils';
import { Errors } from '../errors';

const getMaxValueForBridge = async (
  params: Omit<BridgeParams, 'amount' | 'recipient'>,
  options: Omit<IBridgeOptions, 'cosmos' | 'hooks' | 'events'>,
) => {
  const token = options.chainList.getTokenInfoBySymbol(params.toChainId, params.token);
  if (!token) {
    throw Errors.tokenNotFound(params.token, params.toChainId);
  }

  const [balances, feeStore] = await Promise.all([
    getBalances({
      networkHint: options.networkConfig.NETWORK_HINT,
      vscDomain: options.networkConfig.VSC_DOMAIN,
      evmAddress: options.evm.address,
      chainList: options.chainList,
      tronAddress: options.tron?.address,
      isCA: true,
      useV2Middleware: options.networkConfig.useV2Middleware,
      middlewareUrl: options.networkConfig.MIDDLEWARE_URL,
    }),
    getFeeStore(options.networkConfig.GRPC_URL),
  ]);

  const assets = new UserAssets(balances.assets);

  // FIXME: error in asset.find use NexusError and better messaging.
  const tokenAsset = assets.find(params.token);

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
