// This file contains extra token details which are not supported for bridging but should be used for multicall chain balances

import { MAINNET_CHAIN_IDS, NEXUS_ASSETS_BASE_URL, type TokenInfo } from '../../commons';

type TokenByChain = Array<{
  chainId: number;
  tokens: TokenInfo[];
}>;

export const TOKENS_BY_CHAIN: TokenByChain = [
  {
    chainId: MAINNET_CHAIN_IDS.CITREA,
    tokens: [
      {
        contractAddress: '0x3100000000000000000000000000000000000006',
        name: 'Wrapped Citrea Bitcoin',
        logo: `${NEXUS_ASSETS_BASE_URL}/wcbtc/logo.png`,
        decimals: 18,
        symbol: 'WCBTC',
      },
      {
        contractAddress: '0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D',
        name: 'Citrea USD',
        logo: `${NEXUS_ASSETS_BASE_URL}/ctusd/logo.png`,
        decimals: 6,
        symbol: 'ctUSD',
      },
    ],
  },
];
