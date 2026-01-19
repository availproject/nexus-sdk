import Decimal from 'decimal.js';
import { encodePacked, type Hex, keccak256, pad, toHex } from 'viem';
import {
  type ChainListType,
  logger,
  type Source,
  SUPPORTED_CHAINS,
  TOKEN_CONTRACT_ADDRESSES,
  type VSCClient,
} from '../../../commons';
import { getLogoFromSymbol } from '../constants';
import { filterSupportedTokens } from '../swap/data';
import {
  ankrBalanceToAssets,
  getAnkrBalances,
  toFlatBalance,
  vscBalancesToAssets,
} from '../swap/utils';
import { equalFold } from '.';

export const getBalancesForSwap = async (input: {
  evmAddress: Hex;
  chainList: ChainListType;
  filterWithSupportedTokens: boolean;
  allowedSources?: Source[];
  removeSources?: Source[];
}) => {
  const ankrBalances = await getAnkrBalances(input.evmAddress, input.chainList, true);

  const assets = ankrBalanceToAssets(
    input.chainList,
    ankrBalances,
    input.filterWithSupportedTokens,
    input.allowedSources,
    input.removeSources
  );
  let balances = toFlatBalance(assets);
  logger.debug('getBalancesForSwap', {
    input,
    ankrBalances,
    assets,
    balances,
  });
  if (input.filterWithSupportedTokens) {
    balances = filterSupportedTokens(balances);
  }

  return { assets, balances };
};

export const getBalancesForBridge = async (input: {
  vscClient: VSCClient;
  evmAddress: Hex;
  tronAddress?: string;
  chainList: ChainListType;
}) => {
  const [evmBalances, tronBalances] = await Promise.all([
    input.vscClient.getEVMBalancesForAddress(input.evmAddress),
    input.tronAddress
      ? input.vscClient.getTronBalancesForAddress(input.tronAddress as Hex)
      : Promise.resolve([]),
  ]);

  const assets = vscBalancesToAssets(input.chainList, evmBalances, tronBalances);

  return segregateUSDMFromUSDC(assets, input.chainList);
};

const segregateUSDMFromUSDC = (
  assets: ReturnType<typeof vscBalancesToAssets>,
  chainList: ChainListType
) => {
  const megaethAddress = TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.MEGAETH];
  const usdcIndex = assets.findIndex((a) => equalFold(a.symbol, 'USDC'));

  if (usdcIndex === -1) {
    return assets;
  }

  const usdcAsset = assets[usdcIndex];
  const usdMBreakdown = usdcAsset.breakdown.filter(
    (b) => b.chain.id === SUPPORTED_CHAINS.MEGAETH && equalFold(b.contractAddress, megaethAddress)
  );

  if (usdMBreakdown.length === 0) {
    return assets;
  }

  const remainingBreakdown = usdcAsset.breakdown.filter(
    (b) =>
      !(b.chain.id === SUPPORTED_CHAINS.MEGAETH && equalFold(b.contractAddress, megaethAddress))
  );

  const usdMBalance = usdMBreakdown.reduce(
    (sum, b) => sum.add(new Decimal(b.balance)),
    new Decimal(0)
  );
  const usdMBalanceFiat = usdMBreakdown.reduce((sum, b) => sum + b.balanceInFiat, 0);

  const megaToken = chainList.getTokenByAddress(SUPPORTED_CHAINS.MEGAETH, megaethAddress) ?? {
    decimals: 18,
    logo: getLogoFromSymbol('USDM'),
    name: 'USDm',
    symbol: 'USDM',
  };

  const usdMAsset = {
    abstracted: usdcAsset.abstracted,
    balance: usdMBalance.toString(),
    balanceInFiat: usdMBalanceFiat,
    breakdown: usdMBreakdown,
    decimals: megaToken.decimals ?? 18,
    icon: getLogoFromSymbol('USDM'),
    symbol: 'USDM',
  };

  const updatedUSDCBalance = remainingBreakdown.reduce(
    (sum, b) => sum.add(new Decimal(b.balance)),
    new Decimal(0)
  );
  const updatedUSDCBalanceFiat = remainingBreakdown.reduce((sum, b) => sum + b.balanceInFiat, 0);

  const updatedUSDCAsset = {
    ...usdcAsset,
    balance: updatedUSDCBalance.toString(),
    balanceInFiat: updatedUSDCBalanceFiat,
    breakdown: remainingBreakdown,
  };

  const next = assets.slice(0, usdcIndex).concat(assets.slice(usdcIndex + 1));
  next.push(updatedUSDCAsset);
  next.push(usdMAsset);
  return next;
};

const getBalanceSlot = ({
  tokenSymbol,
  chainId,
  userAddress,
}: {
  tokenSymbol: string;
  chainId: number;
  userAddress: Hex;
}) => {
  const balanceSlot = getBalanceStorageSlot(tokenSymbol, chainId);

  // Calculate storage slot for user's balance: keccak256(user_address . balances_slot)
  const userBalanceSlot = keccak256(
    encodePacked(['bytes32', 'uint256'], [pad(userAddress, { size: 32 }), BigInt(balanceSlot)])
  );

  logger.debug('getBalanceSlot', {
    tokenSymbol,
    chainId,
    userAddress,
    balanceSlot: userBalanceSlot,
  });

  return userBalanceSlot;
};

export const generateStateOverride = (params: {
  tokenSymbol: string;
  tokenAddress: Hex;
  chainId: number;
  userAddress: Hex;
  amount: bigint;
}) => {
  const amountInHex = toHex(params.amount * 2n);
  // FIXME: it should estimate for any other native token also
  if (equalFold(params.tokenSymbol, 'ETH')) {
    return {
      [params.userAddress]: {
        balance: amountInHex,
      },
    };
  }
  const balanceSlot = getBalanceSlot(params);

  return {
    [params.tokenAddress]: {
      storage: {
        [balanceSlot]: pad(amountInHex, { size: 32 }),
      },
    },
    [params.userAddress]: {
      balance: toHex(100000n),
    },
  };
};

const DEFAULT_SLOT = {
  ETH: 0,
  USDC: 9,
  USDT: 2,
} as const;

function getBalanceStorageSlot(token: string, chainId: number): number {
  // Only list different from default
  const storageSlotMapping: Record<number, Record<string, number>> = {
    [SUPPORTED_CHAINS.BNB]: {
      ETH: 0,
      USDC: 1,
      USDT: 1,
    },
  };

  logger.debug('storageSlotMapping', {
    storageSlotMapping,
    chainId,
    val: storageSlotMapping[chainId],
  });
  const chainMapping = storageSlotMapping[chainId];
  if (chainMapping) {
    const slot = chainMapping[token];
    if (slot) {
      logger.info(`Using storage slot ${slot} for ${token} on chain ${chainId}`);
      return slot;
    }
  }

  logger.warn(`Unsupported chain ${chainId}, falling back to defaults`);

  return equalFold(token, 'USDC')
    ? DEFAULT_SLOT.USDC
    : equalFold(token, 'USDT')
      ? DEFAULT_SLOT.USDT
      : DEFAULT_SLOT.ETH;
}
