import { encodeFunctionData, type Hex } from "viem";
import type { ChainOption, TokenOption } from "./types";

/* ── Deposit protocols across chains ─────────────────────────────────
 * Lending-deposit targets for the Swap & Execute / Bridge & Execute tabs.
 * Ported from avail-deposit's deposit config. Each chain pins one protocol
 * (an Aave V3 deployment or a fork) plus the assets it accepts. */

type DepositStrategy = "erc20-supply" | "native-eth";

export type DepositProtocolMeta = {
  id: "aave" | "hyperlend" | "zentra";
  label: string;
  marketUrl: string;
  linkLabel: string;
};

type DepositAsset = {
  symbol: string;
  label: string;
  /** Token the swap/bridge lands in (the SDK `toTokenAddress`). */
  swapTokenAddress: Hex;
  /** Token the pool's `supply`/approval expects. Absent for native. */
  protocolAsset?: Hex;
  decimals: number;
  strategy: DepositStrategy;
};

type DepositChainConfig = {
  chainId: number;
  name: string;
  protocol: DepositProtocolMeta;
  poolAddress: Hex;
  wethGateway?: Hex;
  assets: DepositAsset[];
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;

// Aave V3 forks share this `supply` signature.
const poolAbi = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

const wethGatewayAbi = [
  {
    type: "function",
    name: "depositETH",
    stateMutability: "payable",
    inputs: [
      { name: "pool", type: "address" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

const AAVE_BASE: DepositProtocolMeta = {
  id: "aave",
  label: "Aave V3",
  marketUrl: "https://app.aave.com/?marketName=proto_base_v3",
  linkLabel: "View on Aave",
};
const AAVE_ARBITRUM: DepositProtocolMeta = {
  ...AAVE_BASE,
  marketUrl: "https://app.aave.com/?marketName=proto_arbitrum_v3",
};
const AAVE_OPTIMISM: DepositProtocolMeta = {
  ...AAVE_BASE,
  marketUrl: "https://app.aave.com/?marketName=proto_optimism_v3",
};
const HYPERLEND: DepositProtocolMeta = {
  id: "hyperlend",
  label: "HyperLend",
  marketUrl: "https://app.hyperlend.finance/",
  linkLabel: "View on HyperLend",
};
const ZENTRA: DepositProtocolMeta = {
  id: "zentra",
  label: "Zentra",
  marketUrl: "https://zentra.finance/",
  linkLabel: "View on Zentra",
};

const DEPOSIT_CONFIG: Record<number, DepositChainConfig> = {
  8453: {
    chainId: 8453,
    name: "Base",
    protocol: AAVE_BASE,
    poolAddress: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    wethGateway: "0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24",
    assets: [
      {
        symbol: "USDC",
        label: "USDC",
        swapTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        protocolAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        strategy: "erc20-supply",
      },
      {
        symbol: "ETH",
        label: "ETH",
        swapTokenAddress: ZERO_ADDRESS,
        decimals: 18,
        strategy: "native-eth",
      },
    ],
  },
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    protocol: AAVE_ARBITRUM,
    poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    wethGateway: "0x5283BEcEd7ADF6D003225C13896E536f2D4264FF",
    assets: [
      {
        symbol: "USDC",
        label: "USDC",
        swapTokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        protocolAsset: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        decimals: 6,
        strategy: "erc20-supply",
      },
      {
        symbol: "USDT",
        label: "USDT",
        swapTokenAddress: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        protocolAsset: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        decimals: 6,
        strategy: "erc20-supply",
      },
      {
        symbol: "ETH",
        label: "ETH",
        swapTokenAddress: ZERO_ADDRESS,
        decimals: 18,
        strategy: "native-eth",
      },
    ],
  },
  10: {
    chainId: 10,
    name: "Optimism",
    protocol: AAVE_OPTIMISM,
    poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    wethGateway: "0x5f2508cAE9923b02316254026CD43d7902866725",
    assets: [
      {
        symbol: "USDC",
        label: "USDC",
        swapTokenAddress: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
        protocolAsset: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
        decimals: 6,
        strategy: "erc20-supply",
      },
      {
        symbol: "USDT",
        label: "USDT",
        swapTokenAddress: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
        protocolAsset: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
        decimals: 6,
        strategy: "erc20-supply",
      },
      {
        symbol: "ETH",
        label: "ETH",
        swapTokenAddress: ZERO_ADDRESS,
        decimals: 18,
        strategy: "native-eth",
      },
    ],
  },
  999: {
    chainId: 999,
    name: "HyperEVM",
    protocol: HYPERLEND,
    poolAddress: "0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b",
    wethGateway: "0x49558c794ea2aC8974C9F27886DDfAa951E99171",
    assets: [
      {
        symbol: "USDC",
        label: "USDC",
        swapTokenAddress: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
        protocolAsset: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
        decimals: 6,
        strategy: "erc20-supply",
      },
      {
        symbol: "USDT",
        label: "USDT",
        swapTokenAddress: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
        protocolAsset: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
        decimals: 6,
        strategy: "erc20-supply",
      },
      {
        symbol: "USDe",
        label: "USDe",
        swapTokenAddress: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
        protocolAsset: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
        decimals: 18,
        strategy: "erc20-supply",
      },
    ],
  },
  4114: {
    chainId: 4114,
    name: "Citrea",
    protocol: ZENTRA,
    poolAddress: "0xfb7908150b738e7dB9862007c66C9eb7850706F5",
    assets: [
      {
        symbol: "USDC",
        label: "USDC",
        swapTokenAddress: "0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839",
        protocolAsset: "0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839",
        decimals: 6,
        strategy: "erc20-supply",
      },
      {
        symbol: "WCBTC",
        label: "WCBTC",
        swapTokenAddress: "0x3100000000000000000000000000000000000006",
        protocolAsset: "0x3100000000000000000000000000000000000006",
        decimals: 18,
        strategy: "erc20-supply",
      },
      {
        symbol: "ctUSD",
        label: "ctUSD",
        swapTokenAddress: "0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D",
        protocolAsset: "0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D",
        decimals: 6,
        strategy: "erc20-supply",
      },
    ],
  },
};

export type EncodedDepositExecute = {
  marketUrl: string;
  execute: {
    to: Hex;
    data: Hex;
    value: bigint;
    gas: bigint;
    tokenApproval?: {
      toTokenAddress: Hex;
      amount: bigint;
      spender: Hex;
    };
  };
};

export function getDepositSupportedChains(): ChainOption[] {
  return Object.values(DEPOSIT_CONFIG).map((c) => ({ id: c.chainId, name: c.name }));
}

export function getDepositTokenOptions(chainId: number): TokenOption[] {
  return (
    DEPOSIT_CONFIG[chainId]?.assets.map((a) => ({
      symbol: a.symbol,
      label: a.label,
      tokenAddress: a.swapTokenAddress,
      decimals: a.decimals,
    })) ?? []
  );
}

export function getDepositProtocol(chainId: number): DepositProtocolMeta | undefined {
  return DEPOSIT_CONFIG[chainId]?.protocol;
}

export function buildDepositExecute(params: {
  chainId: number;
  symbol: string;
  amount: bigint;
  wallet: Hex;
}): EncodedDepositExecute {
  const config = DEPOSIT_CONFIG[params.chainId];
  if (!config) throw new Error("Deposit is not configured for the selected chain.");

  const asset = config.assets.find(
    (a) => a.symbol.toLowerCase() === params.symbol.toLowerCase(),
  );
  if (!asset) {
    throw new Error(
      `${params.symbol} is not supported on the selected ${config.protocol.label} market.`,
    );
  }

  const marketUrl = config.protocol.marketUrl;

  if (asset.strategy === "native-eth") {
    if (!config.wethGateway)
      throw new Error("Native deposits are not configured for this market.");
    return {
      marketUrl,
      execute: {
        to: config.wethGateway,
        data: encodeFunctionData({
          abi: wethGatewayAbi,
          functionName: "depositETH",
          args: [config.poolAddress, params.wallet, 0],
        }),
        value: params.amount,
        gas: 420_000n,
      },
    };
  }

  if (!asset.protocolAsset)
    throw new Error("Missing token address for selected deposit.");

  return {
    marketUrl,
    execute: {
      to: config.poolAddress,
      data: encodeFunctionData({
        abi: poolAbi,
        functionName: "supply",
        args: [asset.protocolAsset, params.amount, params.wallet, 0],
      }),
      value: 0n,
      gas: 350_000n,
      tokenApproval: {
        toTokenAddress: asset.protocolAsset,
        amount: params.amount,
        spender: config.poolAddress,
      },
    },
  };
}
