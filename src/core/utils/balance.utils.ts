import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { encodePacked, type Hex, keccak256, pad, toHex } from 'viem';
import {
  type AnkrAsset,
  type AnkrBalance,
  type ChainListType,
  logger,
  type OraclePriceResponse,
  type Source,
  SUPPORTED_CHAINS,
  type VSCClient,
} from '../../commons';
import {
  ankrBalanceToAssets,
  fetchTransferFees,
  getTokenSymbol,
  toFlatBalance,
  vscBalancesToAssets,
} from '../../swap/utils';
import { ZERO_ADDRESS } from '../constants';
import { equalFold } from '.';

const deductTransferFees = (
  balances: AnkrBalance[],
  feeByChainID: Map<number, Decimal>
): AnkrBalance[] =>
  balances.map((balance) => {
    if (!equalFold(balance.tokenAddress, ZERO_ADDRESS)) return balance;
    const transferFee = feeByChainID.get(balance.chainID);
    if (!transferFee) return balance;
    const adjusted = new Decimal(balance.balance).gt(transferFee)
      ? Decimal.sub(balance.balance, transferFee).toFixed(
          balance.tokenData.decimals,
          Decimal.ROUND_FLOOR
        )
      : '0';
    return { ...balance, balance: adjusted };
  });

// vservice /swap-balances returns Ankr-shaped assets already merged across ankr + multicall
// chains. Map them into the existing AnkrBalance shape so the downstream pipeline
// (ankrBalanceToAssets, toFlatBalance) is unchanged.
const swapAssetsToAnkrBalances = (assets: AnkrAsset[]): AnkrBalance[] => {
  const out: AnkrBalance[] = [];
  for (const asset of assets) {
    const chainID = Number.parseInt(asset.blockchain, 10);
    if (!Number.isFinite(chainID)) continue;
    out.push({
      balance: asset.balance,
      balanceUSD: asset.balanceUsd,
      chainID,
      tokenAddress: (asset.tokenType === 'ERC20' ? asset.contractAddress : ZERO_ADDRESS) as Hex,
      tokenData: {
        decimals: asset.tokenDecimals,
        icon: asset.thumbnail,
        name: asset.tokenName,
        symbol: getTokenSymbol(asset.tokenSymbol),
      },
      universe: Universe.ETHEREUM,
    });
  }
  return out;
};

export const getBalancesForSwap = async (input: {
  evmAddress: Hex;
  chainList: ChainListType;
  vscClient: VSCClient;
  filterWithSupportedTokens: boolean;
  /** Unused since vservice provides USD pricing; kept for API stability. */
  oraclePrices?: OraclePriceResponse | Promise<OraclePriceResponse>;
  allowedSources?: Source[];
  removeSources?: Source[];
}) => {
  const swapSupportedChains = input.chainList.chains.filter(
    (chain) =>
      chain.universe === Universe.ETHEREUM && (chain.ankrName !== '' || chain.swapSupported)
  );

  const [swapAssets, transferFeesByChain] = await Promise.all([
    input.vscClient.getSwapBalances(input.evmAddress),
    fetchTransferFees(swapSupportedChains),
  ]);

  const mergedBalances = deductTransferFees(
    swapAssetsToAnkrBalances(swapAssets),
    transferFeesByChain
  );

  const assets = ankrBalanceToAssets(
    input.chainList,
    mergedBalances,
    input.filterWithSupportedTokens,
    input.allowedSources,
    input.removeSources
  );
  const balances = toFlatBalance(assets);

  logger.debug('getBalancesForSwap', {
    input: { evmAddress: input.evmAddress, filter: input.filterWithSupportedTokens },
    swapAssetCount: swapAssets.length,
    mergedBalanceCount: mergedBalances.length,
    assetCount: assets.length,
    balanceCount: balances.length,
  });

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

  return assets;
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
  if (equalFold(params.tokenAddress, ZERO_ADDRESS)) {
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
