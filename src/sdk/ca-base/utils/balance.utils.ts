import { Environment } from '@avail-project/ca-common';
import { ChainListType, logger, SUPPORTED_CHAINS } from '../../../commons';
import { equalFold, getEVMBalancesForAddress, getTronBalancesForAddress } from '.';
import { encodePacked, Hex, keccak256, pad, toHex } from 'viem';
import { balancesToAssets, getAnkrBalances, toFlatBalance } from '../swap/utils';
import { filterSupportedTokens } from '../swap/data';

export const getBalancesForSwap = async (input: { evmAddress: Hex; chainList: ChainListType }) => {
  const assets = balancesToAssets(
    false,
    await getAnkrBalances(input.evmAddress, input.chainList, true),
    input.chainList,
  );
  let balances = toFlatBalance(assets, false);
  return { assets, balances };
};

export const getBalances = async (input: {
  evmAddress: Hex;
  chainList: ChainListType;
  removeTransferFee?: boolean;
  filter?: boolean;
  tronAddress?: string;
  isCA?: boolean;
  vscDomain: string;
  networkHint: Environment;
}) => {
  const isCA = input.isCA ?? false;
  const removeTransferFee = input.removeTransferFee ?? false;
  const filter = input.filter ?? true;

  const [ankrBalances, evmBalances, tronBalances] = await Promise.all([
    input.networkHint === Environment.FOLLY || isCA
      ? Promise.resolve([])
      : getAnkrBalances(input.evmAddress, input.chainList, removeTransferFee),
    getEVMBalancesForAddress(input.vscDomain, input.evmAddress),
    input.tronAddress
      ? getTronBalancesForAddress(input.vscDomain, input.tronAddress as Hex)
      : Promise.resolve([]),
  ]);

  const assets = balancesToAssets(isCA, ankrBalances, input.chainList, evmBalances, tronBalances);

  let balances = toFlatBalance(assets);
  if (filter) {
    balances = filterSupportedTokens(balances);
  }

  logger.debug('getBalances', {
    assets,
    balances,
    removeTransferFee,
  });

  return { assets, balances };
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
    encodePacked(['bytes32', 'uint256'], [pad(userAddress, { size: 32 }), BigInt(balanceSlot)]),
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
  const storageSlotMapping: Record<number, Record<string, number>> = {
    [SUPPORTED_CHAINS.ETHEREUM]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.BASE]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.ARBITRUM]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.OPTIMISM]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.POLYGON]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.AVALANCHE]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.SCROLL]: DEFAULT_SLOT,
    // Testnets
    [SUPPORTED_CHAINS.BASE_SEPOLIA]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]: DEFAULT_SLOT,
    [SUPPORTED_CHAINS.POLYGON_AMOY]: DEFAULT_SLOT,
  };

  const chainMapping = storageSlotMapping[chainId];
  if (chainMapping) {
    const slot = chainMapping[token];
    if (slot) {
      logger.info(`Using storage slot ${slot} for ${token} on chain ${chainId}`);
      return slot;
    }
  }

  logger.warn(`Unsupported chain ${chainId}, falling back to defaults`);

  return token === 'USDC'
    ? DEFAULT_SLOT.USDC
    : token === 'USDT'
    ? DEFAULT_SLOT.USDT
    : DEFAULT_SLOT.ETH;
}
