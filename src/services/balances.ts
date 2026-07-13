import Decimal from 'decimal.js';
import { orderBy } from 'es-toolkit';
import { bytesToNumber, type Hex, toHex } from 'viem';
import type {
  BridgeTokenBalance,
  Chain,
  ChainBalance,
  ChainListType,
  SwapTokenBalance,
  TokenBalance,
  TokenInfo,
  UnifiedBalanceResponseData,
} from '../domain';
import { getLogger, ZERO_ADDRESS } from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { Errors, formatUnknownError } from '../domain/errors';
import { EADDRESS } from '../swap/constants';
import type { FlatBalance } from '../swap/types';
import type { MiddlewareBridgeBalanceClient, MiddlewareSwapBalanceClient } from '../transport';
import { convertAddressByUniverse } from './addresses';
import { estimateRepresentativeDepositTxFee } from './deposit-fee-estimation';
import { divDecimals } from './math';
import { equalFold } from './strings';
import { estimateRepresentativeSwapNativeReserveFee } from './swap-native-reserve-fee';

const logger = getLogger();

const USD_VALUE_DECIMALS = 2;

type TokenBalanceGroup = {
  balance: Decimal;
  value: Decimal;
  currencyId?: number;
  chainBalances: ChainBalance[];
  symbolMeta: Map<string, { count: number; decimals: number; logo: string }>;
};

const toUsdValueString = (value: Decimal.Value) =>
  new Decimal(value).toDP(USD_VALUE_DECIMALS).toFixed(USD_VALUE_DECIMALS);

const getSortedSymbols = (symbolMeta: TokenBalanceGroup['symbolMeta']) =>
  orderBy(
    Array.from(symbolMeta.entries()).map(([symbol, meta]) => ({ symbol, ...meta })),
    [(entry) => entry.count, (entry) => entry.symbol.toLowerCase()],
    ['desc', 'asc']
  );

const finalizeTokenBalance = (group: TokenBalanceGroup): TokenBalance => {
  const sortedSymbols = getSortedSymbols(group.symbolMeta);
  const primarySymbol = sortedSymbols[0];

  if (!primarySymbol) {
    throw Errors.internal('token balance group missing symbol metadata');
  }

  return {
    balance: group.balance.toFixed(),
    value: toUsdValueString(group.value),
    chainBalances: orderBy(
      group.chainBalances,
      [(entry) => new Decimal(entry.value).toNumber()],
      ['desc']
    ),
    currencyId: group.currencyId,
    decimals: primarySymbol.decimals,
    logo: primarySymbol.logo,
    name: sortedSymbols.map((entry) => entry.symbol).join('/'),
    symbol: primarySymbol.symbol,
  };
};

const addChainBalanceToGroup = (
  groups: Map<string, TokenBalanceGroup>,
  groupKey: string,
  chainBalance: ChainBalance,
  input: {
    currencyId?: number;
    decimals: number;
    logo: string;
    symbol: string;
    value: Decimal;
  }
) => {
  const group =
    groups.get(groupKey) ??
    ({
      balance: new Decimal(0),
      value: new Decimal(0),
      currencyId: input.currencyId,
      chainBalances: [] as ChainBalance[],
      symbolMeta: new Map(),
    } satisfies TokenBalanceGroup);

  group.balance = Decimal.add(group.balance, chainBalance.balance);
  group.value = Decimal.add(group.value, input.value);
  group.chainBalances.push(chainBalance);

  const currentMeta = group.symbolMeta.get(input.symbol);
  group.symbolMeta.set(input.symbol, {
    count: (currentMeta?.count ?? 0) + 1,
    decimals: input.decimals,
    logo: input.logo,
  });

  groups.set(groupKey, group);
};

export const getBalancesForBridge = async (input: {
  middlewareClient: MiddlewareBridgeBalanceClient;
  evmAddress: Hex;
  chainList: ChainListType;
}): Promise<BridgeTokenBalance[]> => {
  const [evmBalances] = await Promise.all([
    input.middlewareClient.getBalances(input.evmAddress, 0).catch((error) => {
      throw Errors.backend(
        `Failed to fetch balances from middleware: ${formatUnknownError(error)}`,
        {
          service: 'middleware',
          details: { address: input.evmAddress },
        }
      );
    }),
  ]);

  return aggregateBalancesByCurrency(input.chainList, evmBalances);
};

export const getBalancesForSwap = async (input: {
  middlewareClient: MiddlewareSwapBalanceClient;
  evmAddress: Hex;
  chainList: ChainListType;
  // Reserve a representative gas amount out of native balances (default true) so swap planning
  // doesn't spend the gas it needs to execute. Callers that move funds via sponsored txs — e.g.
  // the init refund sweep, where the holder pays no gas — pass false to get the full balance.
  deductNativeReserve?: boolean;
}): Promise<SwapTokenBalance[]> => {
  const balances = await input.middlewareClient.getSwapBalances(input.evmAddress).catch((error) => {
    throw Errors.backend(
      `Failed to fetch swap balances from middleware: ${formatUnknownError(error)}`,
      {
        service: 'middleware',
        details: { address: input.evmAddress },
      }
    );
  });

  const swapSupported = balances.filter(
    (b) => input.chainList.getChainByID(b.chainID).swapSupported !== false
  );
  const adjusted =
    input.deductNativeReserve === false
      ? swapSupported
      : await deductSwapNativeReserveFees(input.chainList, swapSupported);
  return flatBalancesToAssets(input.chainList, adjusted);
};

// Scope: chains the user actually holds positive native (EADDRESS) balance on.
// Anything else doesn't need a fee estimate — drops the typical fanout from
// every-swap-supported-chain to 0-2 chains.
export const deductSwapNativeReserveFees = async (
  chainList: ChainListType,
  balances: FlatBalance[]
): Promise<FlatBalance[]> => {
  const nativeChainIds = new Set(
    balances
      .filter((b) => equalFold(b.tokenAddress, EADDRESS) && new Decimal(b.amount).gt(0))
      .map((b) => b.chainID)
  );
  if (nativeChainIds.size === 0) {
    return balances;
  }

  const chainsNeedingFees = chainList.chains.filter((c) => nativeChainIds.has(c.id));
  const feeByChain = new Map<number, Decimal>();
  await Promise.all(
    chainsNeedingFees.map(async (chain) => {
      try {
        const fee = await estimateRepresentativeSwapNativeReserveFee({ chain });
        feeByChain.set(chain.id, divDecimals(fee, chain.nativeCurrency.decimals));
      } catch (error) {
        logger.error('swap-balance-fee-estimate', error, { chainID: chain.id });
      }
    })
  );

  return balances.map((b) => {
    if (!equalFold(b.tokenAddress, EADDRESS)) return b;
    const fee = feeByChain.get(b.chainID);
    if (!fee) return b;
    const amount = new Decimal(b.amount);
    const remaining = amount.sub(fee);
    // Actual amount removed from this native balance — the reserve fee, or the whole balance
    // when the fee exceeds it.
    const deducted = amount.sub(Decimal.max(remaining, 0));
    logger.debug('swap-native-reserve-deducted', {
      chainId: b.chainID,
      deductedNativeAmount: `${deducted.toString()} ${b.symbol}`,
    });
    if (remaining.lte(0)) {
      return { ...b, amount: '0', value: 0 };
    }
    const ratio = amount.gt(0) ? remaining.div(amount) : new Decimal(0);
    return {
      ...b,
      amount: remaining.toFixed(b.decimals, Decimal.ROUND_FLOOR),
      value: ratio.mul(b.value).toNumber(),
    };
  });
};

export const aggregateBalancesByCurrency = (
  chainList: ChainListType,
  evmBalances: UnifiedBalanceResponseData[] = []
): BridgeTokenBalance[] => {
  const groups = new Map<string, TokenBalanceGroup>();

  logger.debug('aggregateBalancesByCurrency', {
    evmBalances,
  });

  for (const balance of evmBalances) {
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
      if (!token) {
        continue;
      }
      const normalizedBalance = divDecimals(currency.balance, token.decimals);
      const value = new Decimal(currency.value);
      const chainBalance: ChainBalance = {
        balance: normalizedBalance.toFixed(),
        value: toUsdValueString(value),
        symbol: token.symbol,
        chain: {
          id: bytesToNumber(balance.chain_id),
          logo: chain.custom.icon,
          name: chain.name,
        },
        contractAddress: tokenAddress,
        decimals: token.decimals,
        universe: balance.universe,
      };

      const groupKey =
        token.currencyId != null
          ? `currency:${token.currencyId}`
          : `symbol:${token.symbol.toLowerCase()}`;

      addChainBalanceToGroup(groups, groupKey, chainBalance, {
        currencyId: token.currencyId,
        decimals: token.decimals,
        logo: token.logo,
        symbol: token.symbol,
        value,
      });
    }
  }

  return orderBy(
    Array.from(groups.values()).map((group) => finalizeTokenBalance(group) as BridgeTokenBalance),
    [(asset) => new Decimal(asset.value).toNumber()],
    ['desc']
  );
};

export const flatBalancesToAssets = (
  chainList: ChainListType,
  balances: FlatBalance[] = []
): SwapTokenBalance[] => {
  const groups = new Map<string, TokenBalanceGroup>();

  for (const balance of balances) {
    const chain = chainList.getChainByID(balance.chainID);
    if (!chain) {
      continue;
    }

    const value = new Decimal(balance.value);
    const chainBalance: ChainBalance = {
      balance: balance.amount,
      value: toUsdValueString(value),
      symbol: balance.symbol,
      chain: {
        id: balance.chainID,
        logo: chain.custom.icon,
        name: chain.name,
      },
      contractAddress: balance.tokenAddress,
      decimals: balance.decimals,
      universe: chain.universe,
    };

    addChainBalanceToGroup(groups, balance.symbol.toLowerCase(), chainBalance, {
      decimals: balance.decimals,
      logo: balance.logo,
      symbol: balance.symbol,
      value,
    });
  }

  return orderBy(
    Array.from(groups.values()).map((group) => finalizeTokenBalance(group) as SwapTokenBalance),
    [(asset) => new Decimal(asset.value).toNumber()],
    ['desc']
  );
};

const getUserAssetBalance = (value: TokenBalance) => {
  return value.balance;
};

const getBridgeAssets = (value: TokenBalance, dstChainId: number) => {
  return value.chainBalances
    .filter((b) => b.chain.id !== dstChainId)
    .map((b) => ({
      chainID: b.chain.id,
      contractAddress: b.contractAddress,
      decimals: b.decimals,
      balance: new Decimal(b.balance),
    }));
};

const getBalanceOnChain = (value: TokenBalance, chainID: number, tokenAddress?: `0x${string}`) => {
  return (
    value.chainBalances.find((b) => {
      if (tokenAddress) {
        return b.chain.id === chainID && equalFold(b.contractAddress, tokenAddress);
      }
      return b.chain.id === chainID;
    })?.balance ?? '0'
  );
};

const isDeposit = (tokenAddress: `0x${string}`, universe: Universe) => {
  if (universe === Universe.ETHEREUM) {
    return equalFold(tokenAddress, ZERO_ADDRESS);
  }

  return false;
};

const iterateAsset = async (value: TokenBalance, chainList: ChainListType) => {
  const values = value.chainBalances
    .filter((b) => new Decimal(b.balance).gt(0))
    .sort((a, b) => {
      if (a.chain.id === 1) {
        return 1;
      }
      if (b.chain.id === 1) {
        return -1;
      }
      return Decimal.sub(b.balance, a.balance).toNumber();
    });

  return Promise.all(
    values.map(async (b) => {
      const originalBalance = new Decimal(b.balance);
      const originalValue = new Decimal(b.value);
      let balance = originalBalance;
      let value = originalValue;

      if (isDeposit(b.contractAddress, b.universe)) {
        const chain = chainList.getChainByID(b.chain.id);
        const { bufferedTotalFee } = await estimateRepresentativeDepositTxFee({
          chain,
          vaultAddress: chainList.getVaultContractAddress(chain.id),
          sourceCount: values.length,
        });

        const estimatedGasForDeposit = divDecimals(bufferedTotalFee, chain.nativeCurrency.decimals);

        if (originalBalance.lessThan(estimatedGasForDeposit)) {
          balance = new Decimal(0);
          value = new Decimal(0);
        } else {
          balance = Decimal.sub(originalBalance, estimatedGasForDeposit);
          value = originalBalance.gt(0)
            ? Decimal.mul(balance, Decimal.div(originalValue, originalBalance))
            : new Decimal(0);
        }
      }

      return {
        balance,
        value,
        chain: b.chain,
        contractAddress: b.contractAddress,
        decimals: b.decimals,
        universe: b.universe,
      };
    })
  );
};

export const createUserAsset = (value: TokenBalance) => {
  return {
    value,
    get balance() {
      return getUserAssetBalance(value);
    },
    getBridgeAssets: (dstChainId: number) => getBridgeAssets(value, dstChainId),
    getBalanceOnChain: (chainID: number, tokenAddress?: `0x${string}`) =>
      getBalanceOnChain(value, chainID, tokenAddress),
    isDeposit: (tokenAddress: `0x${string}`, universe: Universe) =>
      isDeposit(tokenAddress, universe),
    iterate: (chainList: ChainListType) => iterateAsset(value, chainList),
  };
};

const addAsset = (data: TokenBalance[], asset: TokenBalance) => {
  data.push(asset);
};

const findAsset = (
  data: TokenBalance[],
  input: string | Pick<TokenInfo, 'symbol' | 'currencyId'>
) => {
  const asset =
    typeof input === 'string'
      ? data.find((entry) => equalFold(entry.symbol, input))
      : ((input.currencyId != null
          ? data.find((entry) => entry.currencyId === input.currencyId)
          : undefined) ?? data.find((entry) => equalFold(entry.symbol, input.symbol)));

  if (asset) {
    return createUserAsset(asset);
  }

  throw Errors.tokenNotSupported();
};

const findAssetOnChain = (data: TokenBalance[], chainID: number, address: `0x${string}`) => {
  return data.find((asset) => {
    const index = asset.chainBalances.findIndex(
      (b) => b.chain.id === chainID && equalFold(b.contractAddress, address)
    );
    if (index > -1) {
      return asset;
    }
    return null;
  });
};

const getAssetDetails = (data: TokenBalance[], chain: Chain, address: `0x${string}`) => {
  const asset = findAssetOnChain(data, chain.id, address);

  logger.debug('getAssetDetails', {
    asset,
    assets: data,
  });

  const destinationGasBalance = getNativeBalance(data, chain);
  const chainsWithBalance = getChainCountWithBalance(asset);
  const destinationAssetBalance =
    asset?.chainBalances.find((b) => b.chain.id === chain.id)?.balance ?? '0';

  return {
    chainsWithBalance,
    destinationAssetBalance,
    destinationGasBalance,
  };
};

const getBalanceInFiat = (data: TokenBalance[]) => {
  return data
    .reduce((total, asset) => Decimal.add(total, asset.value), new Decimal(0))
    .toDecimalPlaces(USD_VALUE_DECIMALS)
    .toNumber();
};

const getChainCountWithBalance = (asset?: TokenBalance) => {
  return asset?.chainBalances.filter((b) => new Decimal(b.balance).gt(0)).length ?? 0;
};

const getNativeBalance = (data: TokenBalance[], chain: Chain) => {
  const asset = data.find((a) => equalFold(a.symbol, chain.nativeCurrency.symbol));
  if (asset) {
    return asset.chainBalances.find((b) => b.chain.id === chain.id)?.balance ?? '0';
  }

  return '0';
};

const sortAssets = (data: TokenBalance[]) => {
  for (const asset of data) {
    asset.chainBalances = orderBy(
      asset.chainBalances,
      [(entry) => new Decimal(entry.value).toNumber()],
      ['desc']
    );
  }
  const sorted = orderBy(data, [(asset) => new Decimal(asset.value).toNumber()], ['desc']);
  data.splice(0, data.length, ...sorted);
};

export const createUserAssets = (data: TokenBalance[]) => {
  return {
    data,
    add: (asset: TokenBalance) => addAsset(data, asset),
    find: (input: string | Pick<TokenInfo, 'symbol' | 'currencyId'>) => findAsset(data, input),
    findOnChain: (chainID: number, address: `0x${string}`) =>
      findAssetOnChain(data, chainID, address),
    getAssetDetails: (chain: Chain, address: `0x${string}`) =>
      getAssetDetails(data, chain, address),
    getBalanceInFiat: () => getBalanceInFiat(data),
    getChainCountWithBalance: (asset?: TokenBalance) => getChainCountWithBalance(asset),
    getNativeBalance: (chain: Chain) => getNativeBalance(data, chain),
    sort: () => sortAssets(data),
    [Symbol.iterator]: () => data.values(),
  };
};

export type UserAssetInstance = ReturnType<typeof createUserAsset>;
export type UserAssetsInstance = ReturnType<typeof createUserAssets>;
