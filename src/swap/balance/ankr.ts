import axios from 'axios';
import type { Hex } from 'viem';
import { getFallbackTokenLogoDataUri } from '../../services/token-logo';
import { EADDRESS } from '../constants';
import type { FlatBalance } from '../types';

// ---------------------------------------------------------------------------
// Chain name → Chain ID mapping
// ---------------------------------------------------------------------------

export const ANKR_CHAIN_MAP: Record<string, number> = {
  eth: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  polygon: 137,
  bsc: 56,
  avalanche: 43114,
  scroll: 534352,
  linea: 59144,
  polygon_zkevm: 1101,
  mantle: 5000,
  blast: 81457,
  gnosis: 100,
  fantom: 250,
  celo: 42220,
  moonbeam: 1284,
  flare: 14,
  syscoin: 57,
  rollux: 570,
  telos: 40,
  xdai: 100,
  zksync_era: 324,
};

const ANKR_API_URL = 'https://rpc.ankr.com/multichain';
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// AnkrClient
// ---------------------------------------------------------------------------

export class AnkrClient {
  async getBalances(walletAddress: Hex): Promise<FlatBalance[]> {
    try {
      const response = await axios.post(
        ANKR_API_URL,
        {
          jsonrpc: '2.0',
          method: 'ankr_getAccountBalance',
          params: {
            walletAddress,
            onlyWhitelisted: false,
          },
          id: 1,
        },
        { timeout: TIMEOUT_MS }
      );

      const assets: AnkrAsset[] = response.data?.result?.assets ?? [];
      return this.parseAssets(assets);
    } catch {
      return [];
    }
  }

  private parseAssets(assets: AnkrAsset[]): FlatBalance[] {
    const balances: FlatBalance[] = [];

    for (const asset of assets) {
      const chainID = ANKR_CHAIN_MAP[asset.blockchain];
      if (!chainID) continue;

      const balance = Number.parseFloat(asset.balance ?? '0');
      if (balance <= 0) continue;

      const isNative = !asset.contractAddress || asset.tokenType === 'NATIVE';
      const tokenAddress = isNative ? EADDRESS : (asset.contractAddress as Hex);

      balances.push({
        amount: asset.balance,
        chainID,
        decimals: asset.tokenDecimals,
        logo: getFallbackTokenLogoDataUri(asset.tokenSymbol),
        name: '',
        symbol: asset.tokenSymbol,
        tokenAddress,
        value: Number.parseFloat(asset.balanceUsd ?? '0'),
      });
    }

    return balances;
  }
}

// ---------------------------------------------------------------------------
// Ankr response types (internal)
// ---------------------------------------------------------------------------

type AnkrAsset = {
  blockchain: string;
  contractAddress?: string;
  tokenType: string;
  tokenSymbol: string;
  tokenDecimals: number;
  balance: string;
  balanceUsd: string;
};
