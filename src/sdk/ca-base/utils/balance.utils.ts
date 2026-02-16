import { ERC20ABI, Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { encodePacked, type Hex, isAddress, keccak256, pad, toHex } from 'viem';
import {
  type AnkrBalance,
  type Chain,
  type ChainListType,
  logger,
  type Source,
  SUPPORTED_CHAINS,
  type VSCClient,
} from '../../../commons';
import { ZERO_ADDRESS } from '../constants';
import { Errors } from '../errors';
import { filterSupportedTokens } from '../swap/data';
import {
  ankrBalanceToAssets,
  getAnkrBalances,
  toFlatBalance,
  vscBalancesToAssets,
} from '../swap/utils';
import { divDecimals, equalFold } from '.';
import { createPublicClientWithFallback } from './contract.utils';

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'USDM']);

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

const multiplierByChain = (chainID: number) => {
  switch (chainID) {
    case 534352:
      return 100n;
    default:
      return 3n;
  }
};

const applyNativeTransferFeeBuffer = (input: {
  chain: Chain;
  nativeBalance: bigint;
  maxFeePerGas: bigint;
}): bigint => {
  const transferFee = divDecimals(
    input.maxFeePerGas * 1_500_000n * multiplierByChain(input.chain.id),
    input.chain.nativeCurrency.decimals
  );
  const transferFeeRaw = BigInt(
    transferFee
      .mul(Decimal.pow(10, input.chain.nativeCurrency.decimals))
      .toDecimalPlaces(0)
      .toString()
  );
  return input.nativeBalance > transferFeeRaw ? input.nativeBalance - transferFeeRaw : 0n;
};

export const getBalance = async (
  chain: Chain,
  address: Hex,
  opts: { removeTransferFee?: boolean } = {}
): Promise<AnkrBalance[]> => {
  if (!isAddress(address)) {
    throw Errors.invalidInput(`invalid evm address: ${address}`);
  }
  if (chain.universe !== Universe.ETHEREUM) {
    throw Errors.invalidInput(`multicall3 balance is only supported for EVM chains: ${chain.name}`);
  }

  const publicClient = createPublicClientWithFallback(chain);
  const contracts = [
    {
      abi: MULTICALL3_ABI,
      address: MULTICALL3_ADDRESS,
      args: [address],
      functionName: 'getEthBalance',
    },
    ...chain.custom.knownTokens.map((token) => ({
      abi: ERC20ABI,
      address: token.contractAddress,
      args: [address] as const,
      functionName: 'balanceOf' as const,
    })),
  ];

  const multicallPromise = publicClient.multicall({
    allowFailure: true,
    contracts: contracts as Parameters<typeof publicClient.multicall>[0]['contracts'],
    multicallAddress: MULTICALL3_ADDRESS,
  });
  const feePromise = opts.removeTransferFee
    ? publicClient
        .estimateFeesPerGas()
        .then((f) => f.maxFeePerGas)
        .catch(() => null)
    : Promise.resolve(null);
  const [rawResponses, maxFeePerGas] = await Promise.all([multicallPromise, feePromise]);
  const responses = rawResponses as Array<
    { status: 'success'; result: bigint } | { status: 'failure'; error: Error }
  >;

  const nativeResult = responses[0];
  let nativeBalance = nativeResult.status === 'success' ? nativeResult.result : 0n;
  if (opts.removeTransferFee && nativeResult.status === 'success' && maxFeePerGas !== null) {
    nativeBalance = applyNativeTransferFeeBuffer({
      chain,
      nativeBalance,
      maxFeePerGas,
    });
  }
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

  for (let i = 0; i < chain.custom.knownTokens.length; i++) {
    const token = chain.custom.knownTokens[i];
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

  const chainBalances = await Promise.all(
    chains.map((chain) => getBalance(chain, address, { removeTransferFee: true }))
  );
  return chainBalances.flat();
};

export const getBalancesForSwap = async (input: {
  evmAddress: Hex;
  chainList: ChainListType;
  filterWithSupportedTokens: boolean;
  allowedSources?: Source[];
  removeSources?: Source[];
}) => {
  const ankrChains = input.chainList.chains.filter((chain) => chain.ankrName !== '');
  const multicallChains = input.chainList.chains.filter(
    (chain) => chain.ankrName === '' && chain.swapSupported && chain.universe === Universe.ETHEREUM
  );

  const [ankrBalances, multicallBalances] = await Promise.all([
    ankrChains.length > 0
      ? getAnkrBalances(input.evmAddress, input.chainList, true)
      : Promise.resolve([]),
    multicallChains.length > 0
      ? getBalances(multicallChains, input.evmAddress)
      : Promise.resolve([]),
  ]);

  logger.debug('getBalancesForSwap', {
    ankrBalances,
    multicallBalances,
  });
  const mergedBalances = [...ankrBalances, ...multicallBalances];

  const assets = ankrBalanceToAssets(
    input.chainList,
    mergedBalances,
    input.filterWithSupportedTokens,
    input.allowedSources,
    input.removeSources
  );
  let balances = toFlatBalance(assets);
  logger.debug('getBalancesForSwap', {
    input,
    ankrBalances,
    multicallBalances,
    mergedBalances,
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
