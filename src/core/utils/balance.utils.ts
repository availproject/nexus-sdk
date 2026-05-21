import { Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { encodePacked, type Hex, keccak256, pad, toHex } from 'viem';
import {
  type AnkrAsset,
  type AnkrBalance,
  type ChainListType,
  logger,
  type OraclePriceResponse,
  SUPPORTED_CHAINS,
  type VSCClient,
} from '../../commons';
import {
  ankrBalanceToAssets,
  fetchTransferFees,
  getTokenSymbol,
  type PublicClientList,
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

// vservice /swap-balances returns `""` for balanceUsd (and tokenPrice) on unpriced long-tail
// tokens — `new Decimal("")` throws downstream and rejects the whole route fetch. Coerce
// empty/missing numeric strings to "0" at this boundary so the rest of the pipeline can
// trust the values it sees. We don't want to *drop* unpriced assets: the user still holds
// the balance, and surfacing it at $0 is more useful than hiding it.
const normalizeDecimalString = (value: string | undefined | null): string =>
  typeof value === 'string' && value.length > 0 ? value : '0';

// vservice /swap-balances returns Ankr-shaped assets already merged across ankr + multicall
// chains. Map them into the existing AnkrBalance shape so the downstream pipeline
// (ankrBalanceToAssets, toFlatBalance) is unchanged.
const swapAssetsToAnkrBalances = (assets: AnkrAsset[]): AnkrBalance[] => {
  const out: AnkrBalance[] = [];
  for (const asset of assets) {
    const chainID = Number.parseInt(asset.blockchain, 10);
    if (!Number.isFinite(chainID)) continue;
    out.push({
      balance: normalizeDecimalString(asset.balance),
      balanceUSD: normalizeDecimalString(asset.balanceUsd),
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
  /** When supplied, fetchTransferFees reuses the cached batched clients (no fresh client per chain). */
  publicClientList?: PublicClientList;
}) => {
  const swapSupportedChains = input.chainList.chains.filter(
    (chain) =>
      chain.universe === Universe.ETHEREUM && (chain.ankrName !== '' || chain.swapSupported)
  );

  // Sequencing: balances first, transfer fees second. `fetchTransferFees` was previously
  // fanned out across every swap-supported chain on every route calc — typically 11+ RPC
  // batches just to estimate a fee that's only ever deducted from *native* balances
  // (deductTransferFees skips non-native). Scoping the fanout to chains the user actually
  // holds native on drops typical 11-chain fanout to 0–2. Wall clock difference is small;
  // RPC-cost / throttling reduction is the win.
  //
  // Note: `allowedSources` / `removeSources` filtering used to live here — it now lives
  // in `_exactOutRoute`'s refresh body so a refresh with a different fromSources doesn't
  // have to refetch balances. This function always returns the unfiltered set.
  const swapAssets = await input.vscClient.getSwapBalances(input.evmAddress);
  const ankrBalances = swapAssetsToAnkrBalances(swapAssets);
  const nativeChainIds = new Set(
    ankrBalances
      .filter((b) => equalFold(b.tokenAddress, ZERO_ADDRESS) && new Decimal(b.balance).gt(0))
      .map((b) => b.chainID)
  );
  const chainsNeedingFees = swapSupportedChains.filter((c) => nativeChainIds.has(c.id));
  const transferFeesByChain = await fetchTransferFees(chainsNeedingFees, input.publicClientList);

  const mergedBalances = deductTransferFees(ankrBalances, transferFeesByChain);

  const assets = ankrBalanceToAssets(
    input.chainList,
    mergedBalances,
    input.filterWithSupportedTokens
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
  chainList: ChainListType;
}) => {
  const [evmBalances] = await Promise.all([
    input.vscClient.getEVMBalancesForAddress(input.evmAddress),
  ]);

  const assets = vscBalancesToAssets(input.chainList, evmBalances);

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
