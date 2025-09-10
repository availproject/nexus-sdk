import { Bytes, PermitVariant, Universe } from "@arcana/ca-common";
import { Hex } from "viem";
import { toHex } from "viem/utils";

import { convertTo32BytesHex, equalFold } from "../utils";
import { EADDRESS } from "./constants";

export enum CurrencyID {
  AVAX = 5,
  DAI = 6,
  ETH = 3,
  HYPE = 0x10,
  KAIA = 0x11,
  POL = 4,
  USDC = 1,
  USDS = 99,
  USDT = 2,
  WETH = 7,
}

const chainData: Map<
  number,
  {
    CurrencyID: number;
    IsGasToken: boolean;
    Name: string;
    PermitContractVersion?: number;
    PermitVariant: PermitVariant;
    TokenContractAddress: string;
    TokenDecimals: number;
  }[]
> = new Map([
  [
    10,
    [
      {
        CurrencyID: CurrencyID.USDC,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDC],
        PermitContractVersion: 2,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0xb2c639c533813f4aa9d7837caf62653d097ff85",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.USDT,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDT],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(
          "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.USDT,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDT],
        PermitContractVersion: 1,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0x01bff41798a0bcf287b996046ca68b395dbc1071",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.DAI,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.DAI],
        PermitContractVersion: 2,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
        ),
        TokenDecimals: 18,
      },
      {
        CurrencyID: CurrencyID.ETH,
        IsGasToken: true,
        Name: CurrencyID[CurrencyID.ETH],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(EADDRESS),
        TokenDecimals: 18,
      },
      {
        CurrencyID: CurrencyID.WETH,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.WETH],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(
          "0x4200000000000000000000000000000000000006",
        ),
        TokenDecimals: 18,
      },
    ],
  ],
  [
    137,
    [
      {
        CurrencyID: CurrencyID.POL,
        IsGasToken: true,
        Name: CurrencyID[CurrencyID.POL],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(EADDRESS),
        TokenDecimals: 18,
      },
      {
        CurrencyID: CurrencyID.USDC,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDC],
        PermitContractVersion: 2,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.USDT,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDT],
        PermitContractVersion: 1,
        PermitVariant: PermitVariant.PolygonEMT,
        TokenContractAddress: convertTo32BytesHex(
          "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        ),
        TokenDecimals: 6,
      },
    ],
  ],
  [
    42161,
    [
      {
        CurrencyID: CurrencyID.WETH,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.WETH],
        PermitContractVersion: 1,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
        ),
        TokenDecimals: 18,
      },
      {
        CurrencyID: CurrencyID.USDC,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDC],
        PermitContractVersion: 2,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.USDT,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDT],
        PermitContractVersion: 1,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.DAI,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.DAI],
        PermitContractVersion: 2,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.ETH,
        IsGasToken: true,
        Name: CurrencyID[CurrencyID.ETH],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(EADDRESS),
        TokenDecimals: 18,
      },
    ],
  ],
  [
    534352,
    [
      {
        CurrencyID: CurrencyID.WETH,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.WETH],
        PermitContractVersion: 1,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0x5300000000000000000000000000000000000004",
        ),
        TokenDecimals: 18,
      },
      {
        CurrencyID: CurrencyID.USDC,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDC],
        PermitContractVersion: 2,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0x6efdbff2a14a7c8e15944d1f4a48f9f95f663a4",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.USDT,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDT],
        PermitContractVersion: 1,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0xf55bec9cafdbe8730f096aa55dad6d22d44099df",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.DAI,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.DAI],
        PermitContractVersion: 1,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0xcA77eB3fEFe3725Dc33bccB54eDEFc3D9f764f97",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.ETH,
        IsGasToken: true,
        Name: CurrencyID[CurrencyID.ETH],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(EADDRESS),
        TokenDecimals: 18,
      },
    ],
  ],
  [
    8453,
    [
      {
        CurrencyID: CurrencyID.WETH,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.WETH],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(
          "0x4200000000000000000000000000000000000006",
        ),
        TokenDecimals: 18,
      },
      {
        CurrencyID: CurrencyID.USDC,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDC],
        PermitContractVersion: 2,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.USDT,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDT],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(
          "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
        ),
        TokenDecimals: 6,
      },
      {
        CurrencyID: CurrencyID.USDS,
        IsGasToken: false,
        Name: CurrencyID[CurrencyID.USDS],
        PermitContractVersion: 1,
        PermitVariant: PermitVariant.EIP2612Canonical,
        TokenContractAddress: convertTo32BytesHex(
          "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc",
        ),
        TokenDecimals: 18,
      },
      {
        CurrencyID: CurrencyID.ETH,
        IsGasToken: true,
        Name: CurrencyID[CurrencyID.ETH],
        PermitVariant: PermitVariant.Unsupported,
        TokenContractAddress: convertTo32BytesHex(EADDRESS),
        TokenDecimals: 18,
      },
    ],
  ],
]);

const filterSupportedTokens = (
  tokens: {
    amount: string;
    chain_id: number;
    decimals: number;
    priceUSD: string;
    symbol: string;
    token_address: `0x${string}`;
    universe: Universe;
    value: number;
  }[],
) => {
  return tokens.filter((t) => {
    const d = chainData.get(t.chain_id);
    if (!d) {
      return false;
    }
    const token = d.find((dt) =>
      equalFold(dt.TokenContractAddress, t.token_address),
    );
    if (!token) {
      return false;
    }

    if (token.IsGasToken) {
      return true;
    }

    if (token.PermitVariant === PermitVariant.Unsupported) {
      return false;
    }

    return true;
  });
};

export const isEIP2612Supported = (contractAddress: Hex, chainID: bigint) => {
  const chaind = chainData.get(Number(chainID));
  if (!chaind) {
    throw new Error(`chain not found: ${chainID}`);
  }

  const token = chaind.find((dt) =>
    equalFold(dt.TokenContractAddress, convertTo32BytesHex(contractAddress)),
  );
  if (!token) {
    throw new Error(`token not found: ${contractAddress}`);
  }

  return token.PermitVariant !== PermitVariant.Unsupported;
};

const getTokenVersion = (tokenAddress: Hex) => {
  for (const [, tokens] of chainData.entries()) {
    const t = tokens.find((t) =>
      equalFold(convertTo32BytesHex(tokenAddress), t.TokenContractAddress),
    );
    if (t) {
      return { variant: t.PermitVariant, version: t.PermitContractVersion! };
    }
  }
  throw new Error("token not available or has no version");
};

const getPermitVariant = (tokenAddress: Hex) => {
  for (const [, tokens] of chainData.entries()) {
    const t = tokens.find((t) =>
      equalFold(convertTo32BytesHex(tokenAddress), t.TokenContractAddress),
    );
    if (t && t.PermitVariant) {
      return t.PermitVariant;
    }
  }
  throw new Error("token not available or has no version");
};

export const getTokenDecimals = (
  chainID: number | string,
  contractAddress: Bytes,
) => {
  const cData = chainData.get(Number(chainID));
  if (!cData) {
    throw new Error(`chain data not found for chain:${chainID}`);
  }
  const token = cData.find((c) =>
    equalFold(toHex(contractAddress), c.TokenContractAddress),
  );
  if (!token) {
    throw new Error(`token not found: ${toHex(contractAddress)}`);
  }
  return {
    decimals: token.TokenDecimals,
    symbol: CurrencyID[token.CurrencyID],
  };
};

export { chainData, filterSupportedTokens, getPermitVariant, getTokenVersion };
