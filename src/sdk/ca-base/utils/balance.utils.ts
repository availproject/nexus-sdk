import { Environment } from '@avail-project/ca-common';
import { ChainListType, logger, SUPPORTED_CHAINS, UserAssetDatum } from '../../../commons';
import {
  // createPublicClientWithFallback,
  equalFold,
  getEVMBalancesForAddress,
  getFuelBalancesForAddress,
  getTronBalancesForAddress,
  minutesToMs,
} from '.';
import { encodePacked, Hex, keccak256, pad, toHex } from 'viem';
import { balancesToAssets, getAnkrBalances, toFlatBalance } from '../swap/utils';
import { filterSupportedTokens } from '../swap/data';
// import { Errors } from '../errors';

const getKeyForStorage = ({
  evmAddress,
  fuelAddress,
  tronAddress,
}: {
  evmAddress: Hex;
  fuelAddress?: string;
  tronAddress?: string;
}) => {
  let key = evmAddress;
  if (fuelAddress) {
    key += `:${fuelAddress}`;
  }
  if (tronAddress) {
    key += `:${tronAddress}`;
  }
  return key;
};

let balanceCache = {
  value: {} as { [k: string]: { data: UserAssetDatum[]; lastUpdatedAt: number } },
};

export const getBalancesForSwap = async (input: { evmAddress: Hex; chainList: ChainListType }) => {
  const assets = balancesToAssets(
    false,
    await getAnkrBalances(input.evmAddress, input.chainList, true),
    input.chainList,
  );
  let balances = toFlatBalance(assets, false);
  return balances;
};

export const getBalances = async (input: {
  evmAddress: Hex;
  chainList: ChainListType;
  removeTransferFee?: boolean;
  filter?: boolean;
  fuelAddress?: string;
  tronAddress?: string;
  isCA?: boolean;
  vscDomain: string;
  networkHint: Environment;
}) => {
  const isCA = input.isCA ?? false;
  const removeTransferFee = input.removeTransferFee ?? false;
  const filter = input.filter ?? true;

  const cacheKey = getKeyForStorage(input);
  console.log({ balanceCache });

  let cacheValue = balanceCache.value[cacheKey];
  if (!cacheValue || cacheValue.lastUpdatedAt + minutesToMs(0.5) < Date.now()) {
    const [ankrBalances, evmBalances, fuelBalances, tronBalances] = await Promise.all([
      input.networkHint === Environment.FOLLY || isCA
        ? Promise.resolve([])
        : getAnkrBalances(input.evmAddress, input.chainList, removeTransferFee),
      getEVMBalancesForAddress(input.vscDomain, input.evmAddress),
      input.fuelAddress
        ? getFuelBalancesForAddress(input.vscDomain, input.fuelAddress as `0x${string}`)
        : Promise.resolve([]),
      input.tronAddress
        ? getTronBalancesForAddress(input.vscDomain, input.tronAddress as Hex)
        : Promise.resolve([]),
    ]);

    balanceCache.value[cacheKey] = {
      data: balancesToAssets(
        isCA,
        ankrBalances,
        input.chainList,
        evmBalances,
        fuelBalances,
        tronBalances,
      ),
      lastUpdatedAt: Date.now(),
    };
  }

  const assets = balanceCache.value[cacheKey].data;

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

// export const getGasFeeFromBridgeParams = async (input: MaxBridgeParams, dstChain: Chain) => {
//   let nativeAmount = 0n;
//   if ('gas' in input && input.gas) {
//     if ('gasPrice' in input && input.gasPrice) {
//       nativeAmount = input.gas * input.gasPrice;
//     } else {
//       const pc = createPublicClientWithFallback(dstChain);
//       const estimateGasPriceResponse = await pc.estimateFeesPerGas();
//       const gasUnitPrice =
//         estimateGasPriceResponse.maxFeePerGas ?? estimateGasPriceResponse.gasPrice ?? 0n;
//       if (gasUnitPrice == 0n) {
//         throw Errors.gasPriceError({
//           chainId: dstChain.id,
//         });
//       }
//       nativeAmount = input.gas * gasUnitPrice;
//     }
//   }

//   return nativeAmount;
// };
