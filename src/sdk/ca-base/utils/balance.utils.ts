import Decimal from 'decimal.js';
import { bytesToNumber, encodePacked, type Hex, keccak256, pad, toHex } from 'viem';
import {
  type ChainListType,
  logger,
  SUPPORTED_CHAINS,
  type UnifiedBalanceResponseData,
  type UserAssetDatum,
} from '../../../commons';
import { getLogoFromSymbol } from '../constants';
import { convertAddressByUniverse, type createMiddlewareClient, equalFold } from '.';

export const getBalancesForBridge = async (input: {
  middlewareClient: ReturnType<typeof createMiddlewareClient>;
  evmAddress: Hex;
  // tronAddress?: string;
  chainList: ChainListType;
}) => {
  const [evmBalances] = await Promise.all([
    input.middlewareClient.getBalances(input.evmAddress, 0),
  ]);

  const assets = vscBalancesToAssets(input.chainList, evmBalances, []);

  return assets;
};

export const vscBalancesToAssets = (
  chainList: ChainListType,
  evmBalances: UnifiedBalanceResponseData[] = [],
  tronBalances: UnifiedBalanceResponseData[] = []
) => {
  const assets: UserAssetDatum[] = [];
  const vscBalances = evmBalances.concat(tronBalances);

  logger.debug('balanceToAssets', {
    evmBalances,
    tronBalances,
  });
  for (const balance of vscBalances) {
    for (const currency of balance.currencies) {
      const chain = chainList.getChainByID(bytesToNumber(balance.chain_id));
      if (!chain) {
        continue;
      }
      const tokenAddress = convertAddressByUniverse(
        toHex(currency.token_address),
        balance.universe
      );
      const token = chainList.getTokenByAddress(chain.id, tokenAddress);
      const decimals = token ? token.decimals : chain.nativeCurrency.decimals;

      if (token) {
        const asset = assets.find((s) => equalFold(s.symbol, token.symbol));
        if (asset) {
          asset.balance = new Decimal(asset.balance).add(currency.balance).toFixed();
          asset.balanceInFiat = new Decimal(asset.balanceInFiat)
            .add(currency.value)
            .toDecimalPlaces(2)
            .toNumber();
          asset.breakdown.push({
            balance: currency.balance,
            balanceInFiat: new Decimal(currency.value).toDecimalPlaces(2).toNumber(),
            chain: {
              id: bytesToNumber(balance.chain_id),
              logo: chain.custom.icon,
              name: chain.name,
            },
            contractAddress: tokenAddress,
            decimals,
            universe: balance.universe,
          });
        } else {
          assets.push({
            abstracted: true,
            balance: currency.balance,
            balanceInFiat: new Decimal(currency.value).toDecimalPlaces(2).toNumber(),
            breakdown: [
              {
                balance: currency.balance,
                balanceInFiat: new Decimal(currency.value).toDecimalPlaces(2).toNumber(),
                chain: {
                  id: bytesToNumber(balance.chain_id),
                  logo: chain.custom.icon,
                  name: chain.name,
                },
                contractAddress: tokenAddress,
                decimals,
                universe: balance.universe,
              },
            ],
            decimals: token.decimals,
            icon: getLogoFromSymbol(token.symbol),
            symbol: token.symbol,
          });
        }
      }
    }
  }

  for (const asset of assets) {
    asset.breakdown.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  }
  assets.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
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
