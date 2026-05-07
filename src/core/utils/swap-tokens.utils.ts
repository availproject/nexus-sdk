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
  {
    chainId: MAINNET_CHAIN_IDS.HYPEREVM,
    tokens: [
      {
        contractAddress: '0xfd739d4e423301ce9385c1fb8850539d657c296d',
        name: 'Kinetiq Staked HYPE',
        logo: `${NEXUS_ASSETS_BASE_URL}/hype/logo.png`,
        decimals: 18,
        symbol: 'KHYPE',
      },
      {
        contractAddress: '0x5555555555555555555555555555555555555555',
        name: 'Wrapped Hype',
        logo: `${NEXUS_ASSETS_BASE_URL}/hype/logo.png`,
        decimals: 18,
        symbol: 'WHYPE',
      },
      {
        contractAddress: '0xffaa4a3d97fe9107cef8a3f48c069f577ff76cc1',
        name: 'Staked HYPE',
        logo: `${NEXUS_ASSETS_BASE_URL}/hype/logo.png`,
        decimals: 18,
        symbol: 'stHYPE',
      },
      {
        contractAddress: '0x111111a1a0667d36bD57c0A9f569b98057111111',
        name: 'USDH',
        logo: `${NEXUS_ASSETS_BASE_URL}/usdh/logo.png`,
        decimals: 6,
        symbol: 'USDH',
      },
      {
        contractAddress: '0x9fdbda0a5e284c32744d2f17ee5c74b284993463',
        name: 'Unit Bitcoin',
        logo: 'https://assets.coingecko.com/coins/images/55066/large/ubtc.jpg',
        decimals: 8,
        symbol: 'UBTC',
      },
      {
        contractAddress: '0xBe6727B535545C67d5cAa73dEa54865B92CF7907',
        name: 'Unit Ethereum',
        logo: 'https://assets.coingecko.com/coins/images/55066/large/ubtc.jpg',
        decimals: 18,
        symbol: 'UETH',
      },
      {
        contractAddress: '0x000000000000780555bD0BCA3791f89f9542c2d6',
        name: 'Kinetiq Governance Token',
        logo: '',
        decimals: 18,
        symbol: 'KNTQ',
      },
      {
        contractAddress: '0x94e8396e0869c9F2200760aF0621aFd240E1CF38',
        name: 'Staked HYPE Shares',
        logo: '',
        decimals: 18,
        symbol: 'wstHYPE',
      },
      {
        contractAddress: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
        name: 'USDeOFT',
        logo: '',
        decimals: 18,
        symbol: 'USDe',
      },
      {
        contractAddress: '0x9BA2EDc44E0A4632EB4723E81d4142353e1bB160',
        name: 'Kinetiq Earn Vault',
        logo: '',
        decimals: 18,
        symbol: 'vkHYPE',
      },
      {
        contractAddress: '0x9b498C3c8A0b8CD8BA1D9851d40D186F1872b44E',
        name: 'Purr',
        logo: '',
        decimals: 18,
        symbol: 'PURR',
      },
      {
        contractAddress: '0x053f6755320d06b8fd6675581b0475B2E32399b1',
        name: 'Based Token',
        logo: '',
        decimals: 18,
        symbol: 'BASED',
      },
      {
        contractAddress: '0x360C140E5344A1A0593D44B4ea6Fc7C3DAf0C473',
        name: 'Kinetiq Markets LST',
        logo: '',
        decimals: 18,
        symbol: 'kmHYPE',
      },
      {
        contractAddress: '0x5748ae796AE46A4F1348a1693de4b50560485562',
        name: 'Looped HYPE',
        logo: '',
        decimals: 18,
        symbol: 'LHYPE',
      },
      {
        contractAddress: '0xd8FC8F0b03eBA61F64D08B0bef69d80916E5DdA9',
        name: 'hyperbeat x ether.fi HYPE',
        logo: '',
        decimals: 18,
        symbol: 'beHYPE',
      },
      {
        contractAddress: '0xBD6Dab50F03A305a80037294fA8D1A9DC0CaC91B',
        name: 'HyperLend',
        logo: '',
        decimals: 18,
        symbol: 'HPL',
      },
      {
        contractAddress: '0x02c6a2fA58cC01A18B8D9E00eA48d65E4dF26c70',
        name: 'feUSD',
        logo: '',
        decimals: 18,
        symbol: 'feUSD',
      },
      {
        contractAddress: '0x4F9E014f620D83b08342C8BDFf3043fb2220b727',
        name: 'QONE',
        logo: '',
        decimals: 18,
        symbol: 'QONE',
      },
      {
        contractAddress: '0xf4D9235269a96aaDaFc9aDAe454a0618eBE37949',
        name: 'Tether Gold',
        logo: '',
        decimals: 6,
        symbol: 'XAUt0',
      },
      {
        contractAddress: '0xa320D9f65ec992EfF38622c63627856382Db726c',
        name: 'HFUN',
        logo: '',
        decimals: 18,
        symbol: 'HFUN',
      },
      {
        contractAddress: '0x96C6cBB6251Ee1c257b2162ca0f39AA5Fa44B1FB',
        name: 'Hyperbeat Ultra HYPE',
        logo: '',
        decimals: 18,
        symbol: 'hbHYPE',
      },
      {
        contractAddress: '0x5e105266db42f78FA814322Bce7f388B4C2e61eb',
        name: 'Hyperbeat USDT',
        logo: '',
        decimals: 18,
        symbol: 'hbUSDT',
      },
      {
        contractAddress: '0x9FD7466f987Fd4C45a5BBDe22ED8aba5BC8D72d1',
        name: 'hwHLP',
        logo: '',
        decimals: 6,
        symbol: 'hwHLP',
      },
      {
        contractAddress: '0xfDD22Ce6D1F66bc0Ec89b20BF16CcB6670F55A5a',
        name: 'thBILL',
        logo: '',
        decimals: 6,
        symbol: 'thBILL',
      },
      {
        contractAddress: '0x441794D6a8F9A3739F5D4E98a728937b33489D29',
        name: 'Liquid HYPE Yield',
        logo: '',
        decimals: 18,
        symbol: 'liquidHYPE',
      },
      {
        contractAddress: '0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03',
        name: 'xHYPE',
        logo: '',
        decimals: 18,
        symbol: 'xHYPE',
      },
      {
        contractAddress: '0x03832767BDf9A8EF007449942125Ad605aCfADb8',
        name: 'Swap',
        logo: '',
        decimals: 18,
        symbol: 'SWAP',
      },
    ],
  },
];
