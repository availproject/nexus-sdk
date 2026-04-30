import { ERC20ABI, Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { encodePacked, type Hex, isAddress, keccak256, pad, toHex } from 'viem';
import {
  type AnkrBalance,
  type Chain,
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
  getAnkrBalances,
  toFlatBalance,
  vscBalancesToAssets,
} from '../../swap/utils';
import { ZERO_ADDRESS } from '../constants';
import { Errors } from '../errors';
import { divDecimals, equalFold } from '.';
import { createPublicClientWithFallback } from './contract.utils';
import { TOKENS_BY_CHAIN } from './swap-tokens.utils';

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const CITREA_MULTICALL3_ADDRESS = '0xA738e84fdE890Bc60b99AF7ccE43990E534304de' as const;
const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'USDM', 'CTUSD']);

const MULTICALL3_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'addr', type: 'address' }],
    name: 'getEthBalance',
    outputs: [{ internalType: 'uint256', name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const mapMulticallResultToBalance = (input: {
  chain: Chain;
  balance: string;
  balanceUSD?: string;
  tokenAddress: Hex;
  tokenData: {
    decimals: number;
    icon: string;
    name: string;
    symbol: string;
  };
  error?: boolean;
}): AnkrBalance => ({
  balance: input.balance,
  balanceUSD: input.balanceUSD ?? '0',
  chainID: input.chain.id,
  tokenAddress: input.tokenAddress,
  tokenData: input.tokenData,
  universe: input.chain.universe,
  error: input.error,
});

export const getBalance = async (chain: Chain, address: Hex): Promise<AnkrBalance[]> => {
  if (!isAddress(address)) {
    throw Errors.invalidInput(`invalid evm address: ${address}`);
  }
  if (chain.universe !== Universe.ETHEREUM) {
    throw Errors.invalidInput(`multicall3 balance is only supported for EVM chains: ${chain.name}`);
  }

  const publicClient = createPublicClientWithFallback(chain);
  const multicall3Address =
    chain.id === SUPPORTED_CHAINS.CITREA ? CITREA_MULTICALL3_ADDRESS : MULTICALL3_ADDRESS;
  const extraKnownTokens =
    TOKENS_BY_CHAIN.find((tokenByChain) => tokenByChain.chainId === chain.id)?.tokens ?? [];
  const tokenInfos = [...chain.custom.knownTokens, ...extraKnownTokens];
  const contracts = [
    {
      abi: MULTICALL3_ABI,
      address: multicall3Address,
      args: [address],
      functionName: 'getEthBalance',
    },
    ...tokenInfos.map((token) => ({
      abi: ERC20ABI,
      address: token.contractAddress,
      args: [address] as const,
      functionName: 'balanceOf' as const,
    })),
  ];

  const multicallPromise = publicClient.multicall({
    allowFailure: true,
    contracts: contracts as Parameters<typeof publicClient.multicall>[0]['contracts'],
    multicallAddress: multicall3Address,
  });
  const rawResponses = await multicallPromise;
  const responses = rawResponses as Array<
    { status: 'success'; result: bigint } | { status: 'failure'; error: Error }
  >;

  const nativeResult = responses[0];
  const nativeBalance = nativeResult.status === 'success' ? nativeResult.result : 0n;
  const balances: AnkrBalance[] = [
    mapMulticallResultToBalance({
      balance: divDecimals(nativeBalance, chain.nativeCurrency.decimals).toFixed(),
      balanceUSD: '0',
      chain,
      tokenAddress: ZERO_ADDRESS,
      tokenData: {
        decimals: chain.nativeCurrency.decimals,
        icon: chain.custom.icon,
        name: chain.nativeCurrency.name,
        symbol: chain.nativeCurrency.symbol,
      },
      error: nativeResult.status !== 'success',
    }),
  ];

  for (let i = 0; i < tokenInfos.length; i++) {
    const token = tokenInfos[i];
    const result = responses[i + 1];
    const tokenBalance = result.status === 'success' ? result.result : 0n;
    const isStable = STABLE_SYMBOLS.has(token.symbol.toUpperCase());
    const tokenBalancesInDecimal = divDecimals(tokenBalance, token.decimals).toFixed();
    balances.push(
      mapMulticallResultToBalance({
        balance: tokenBalancesInDecimal,
        balanceUSD: isStable ? tokenBalancesInDecimal : '0',
        chain,
        tokenAddress: token.contractAddress,
        tokenData: {
          decimals: token.decimals,
          icon: token.logo,
          name: token.name,
          symbol: token.symbol,
        },
        error: result.status !== 'success',
      })
    );
  }

  return balances;
};

export const getBalances = async (chains: Chain[], address: Hex): Promise<AnkrBalance[]> => {
  if (!isAddress(address)) {
    throw Errors.invalidInput(`invalid evm address: ${address}`);
  }

  const chainBalances = await Promise.all(chains.map((chain) => getBalance(chain, address)));
  return chainBalances.flat();
};

const enrichBalancesWithOracleUSD = (
  balances: AnkrBalance[],
  oraclePrices: OraclePriceResponse
): AnkrBalance[] => {
  if (oraclePrices.length === 0) {
    return balances;
  }

  return balances.map((balance) => {
    const tokenAddress = equalFold(balance.tokenAddress, ZERO_ADDRESS)
      ? ZERO_ADDRESS
      : balance.tokenAddress;
    const oracleRate = oraclePrices.find(
      (rate) => rate.chainId === balance.chainID && equalFold(rate.tokenAddress, tokenAddress)
    );
    if (!oracleRate) {
      return balance;
    }

    return {
      ...balance,
      balanceUSD: new Decimal(balance.balance).mul(oracleRate.priceUsd).toFixed(),
    };
  });
};

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

export const getBalancesForSwap = async (input: {
  evmAddress: Hex;
  chainList: ChainListType;
  filterWithSupportedTokens: boolean;
  oraclePrices?: OraclePriceResponse | Promise<OraclePriceResponse>;
  allowedSources?: Source[];
  removeSources?: Source[];
}) => {
  const ankrChains = input.chainList.chains.filter((chain) => chain.ankrName !== '');
  const multicallChains = input.chainList.chains.filter(
    (chain) => chain.ankrName === '' && chain.swapSupported && chain.universe === Universe.ETHEREUM
  );
  const allChains = [...ankrChains, ...multicallChains];

  const [ankrBalances, multicallBalances, oraclePrices, transferFeesByChain] = await Promise.all([
    ankrChains.length > 0
      ? getAnkrBalances(input.evmAddress, input.chainList)
      : Promise.resolve([]),
    multicallChains.length > 0
      ? getBalances(multicallChains, input.evmAddress)
      : Promise.resolve([]),
    input.oraclePrices ? Promise.resolve(input.oraclePrices) : Promise.resolve([]),
    fetchTransferFees(allChains),
  ]);
  const multicallBalancesWithOracleUSD = enrichBalancesWithOracleUSD(
    multicallBalances,
    oraclePrices
  );

  const tfbc: string[] = [];
  transferFeesByChain.forEach((v, k) => {
    tfbc.push(`${k}: ${v.toFixed()}`);
  });

  logger.debug('getBalancesForSwap', {
    ankrBalances,
    multicallBalances: multicallBalancesWithOracleUSD,
    oraclePrices,
    transferFeesByChain: tfbc,
  });
  const mergedBalances = deductTransferFees(
    [...ankrBalances, ...multicallBalancesWithOracleUSD],
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
    input,
    ankrBalances,
    multicallBalances: multicallBalancesWithOracleUSD,
    mergedBalances,
    oraclePrices,
    assets,
    balances,
  });

  // if (input.filterWithSupportedTokens) {
  //   balances = filterSupportedTokens(balances);
  // }

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
  // Native currency on any EVM chain uses account balance override (not only ETH).
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
