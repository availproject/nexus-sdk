import {
  Aggregator,
  BebopAggregator,
  BebopQuote,
  Bytes,
  ChaindataMap,
  CurrencyID,
  ERC20ABI,
  Holding,
  LiFiAggregator,
  LiFiQuote,
  msgpackableAxios,
  OmniversalChainID,
  PermitVariant,
  Quote,
  Universe,
} from '@avail-project/ca-common';
import CaliburABI from './calibur.abi';
import axios from 'axios';
import Decimal from 'decimal.js';
import { retry } from 'es-toolkit';
import { connect } from 'it-ws/client';
import { pack, unpack } from 'msgpackr';
import {
  ByteArray,
  bytesToBigInt,
  bytesToNumber,
  concat,
  createPublicClient,
  encodeFunctionData,
  getContract,
  Hex,
  hexToBigInt,
  http,
  maxUint256,
  pad,
  parseSignature,
  PrivateKeyAccount,
  PublicClient,
  toBytes,
  toHex,
  WalletClient,
} from 'viem';
import { ERC20PermitABI, ERC20PermitEIP2612PolygonType, ERC20PermitEIP712Type } from '../abi/erc20';
import { getLogoFromSymbol, ZERO_ADDRESS } from '../constants';
import {
  getLogger,
  Chain,
  SuccessfulSwapResult,
  UnifiedBalanceResponseData,
  UserAssetDatum,
  SWAP_STEPS,
  SwapStepType,
  AnkrAsset,
  AnkrBalances,
  SBCTx,
  SwapIntent,
  Tx,
  ChainListType,
} from '../../../commons';
import {
  convertAddressByUniverse,
  convertTo32BytesHex,
  createDeadlineFromNow,
  divDecimals,
  equalFold,
  getExplorerURL,
  getVSCURL,
  waitForTxReceipt,
} from '../utils';
import { SWEEP_ABI } from './abi';
import { CALIBUR_ADDRESS, EADDRESS, SWEEPER_ADDRESS } from './constants';
import { chainData, FlatBalance, getTokenVersion } from './data';
import { createSBCTxFromCalls, waitForSBCTxReceipt } from './sbc';
import Long from 'long';
import { Errors } from '../errors';

const logger = getLogger();

export const convertTo32Bytes = (
  input: `0x${string}` | bigint | ByteArray | number,
): Uint8Array => {
  if (typeof input === 'string') {
    return toBytes(pad(input, { dir: 'left', size: 32 }));
  }

  if (typeof input === 'bigint' || typeof input === 'number') {
    return toBytes(input, {
      size: 32,
    });
  }

  return pad(input, { dir: 'left', size: 32 });
};

export const EADDRESS_32_BYTES = convertTo32Bytes(EADDRESS);

export const convertToEVMAddress = (address: Hex | Uint8Array) => {
  if (typeof address === 'string') {
    address = toBytes(address);
  }

  if (address.length === 20) {
    return toHex(address);
  }

  if (address.length == 32) {
    return toHex(address.subarray(12));
  }

  throw Errors.invalidAddressLength('evm');
};

export const bytesEqual = (bytes1: Uint8Array, bytes2: Uint8Array): boolean => {
  logger.debug('bytesEqual', {
    bytes1,
    bytes2,
  });

  if (bytes1.length !== bytes2.length) {
    return false;
  }

  for (let i = 0; i < bytes1.length; i++) {
    if (bytes1[i] !== bytes2[i]) {
      return false;
    }
  }

  return true;
};

const AnkrChainIdMapping = new Map([
  ['arbitrum', 42161],
  ['avalanche_fuji', 43113],
  ['avalanche', 43114],
  ['base_sepolia', 84532],
  ['base', 8453],
  ['bsc', 56],
  ['eth_holesky', 17000],
  ['eth_sepolia', 11155111],
  ['eth', 1],
  ['fantom', 250],
  ['flare', 14],
  ['gnosis', 100],
  ['linea', 59144],
  ['optimism_testnet', 11155420],
  ['optimism', 10],
  ['polygon_amoy', 80002],
  ['polygon_zkevm', 1101],
  ['polygon', 137],
  ['rollux', 570],
  ['scroll', 534352],
  ['story_testnet', 1513],
  ['story', 1514],
  ['syscoin', 57],
  ['telos', 40],
  ['xai', 660279],
  ['xlayer', 196],
]);

export const NativeSlippage: Record<number, string> = {
  1: '0.02',
  10: '0.0002',
  137: '0.02',
  42161: '0.0002',
  43114: '0.01',
  8453: '0.0002',
};

export const createPermitSignature = async (
  contractAddress: Hex,
  client: WalletClient,
  spender: Hex,
  walletAddress: Hex,
  variant: PermitVariant,
  version: number,
  deadline: bigint,
  amount: bigint,
) => {
  const contract = getContract({
    abi: ERC20ABI,
    address: contractAddress,
    client,
  });

  const [name, chainID, nonce] = await Promise.all([
    contract.read.name(),
    client.request({ method: 'eth_chainId' }, { dedupe: true }),
    contract.read.nonces([walletAddress]),
  ]);

  logger.debug('createPermitSigParams', {
    account: walletAddress,
    domain: {
      chainId: hexToBigInt(chainID),
      name,
      verifyingContract: contractAddress,
      version,
    },
    message: {
      deadline,
      nonce,
      owner: walletAddress,
      spender: spender,
      value: amount,
    },
    primaryType: 'Permit',
    types: ERC20PermitEIP712Type,
  });

  switch (variant) {
    case PermitVariant.EIP2612Canonical: {
      return {
        signature: await client.signTypedData({
          account: walletAddress,
          domain: {
            chainId: hexToBigInt(chainID),
            name,
            verifyingContract: contractAddress,
            version: version.toString(),
          },
          message: {
            deadline,
            nonce,
            owner: walletAddress,
            spender: spender,
            value: amount,
          },
          primaryType: 'Permit',
          types: ERC20PermitEIP712Type,
        }),
        variant,
      };
    }
    case PermitVariant.PolygonEMT: {
      return {
        signature: await client.signTypedData({
          account: walletAddress,
          domain: {
            name,
            salt: pad(chainID, {
              dir: 'left',
              size: 32,
            }),
            verifyingContract: contract.address,
            version: version.toString(10),
          },
          message: {
            from: walletAddress,
            functionSignature: packERC20Approve(spender, amount),
            nonce,
          },
          primaryType: 'MetaTransaction',
          types: ERC20PermitEIP2612PolygonType,
        }),
        variant,
      };
    }
    default: {
      throw Errors.tokenNotSupported(undefined, undefined, '(2612 details not found)');
    }
  }
};

export const vscSBCTx = async (input: SBCTx[], vscDomain: string) => {
  const ops: [bigint, Hex][] = [];
  const connection = connect(
    new URL('/api/v1/create-sbc-tx', getVSCURL(vscDomain, 'wss')).toString(),
  );

  try {
    await connection.connected();
    connection.socket.send(pack(input));
    let count = 0;
    for await (const response of connection.source) {
      const data: {
        errored: boolean;
        part_idx: number;
        tx_hash: Uint8Array;
      } = unpack(response);

      logger.debug('vscSBCTx', { data });

      if (data.errored) {
        throw Errors.internal('Error in VSC SBC Tx');
      }

      ops.push([bytesToBigInt(input[data.part_idx].chain_id), toHex(data.tx_hash)]);

      count += 1;

      if (count === input.length) {
        break;
      }
    }
  } finally {
    await connection.close();
  }
  return ops;
};

export const EXPECTED_CALIBUR_CODE = concat(['0xef0100', CALIBUR_ADDRESS]);

export const isAuthorizationCodeSet = async (
  chainID: number,
  address: `0x${string}`,
  cache: Cache,
) => {
  const code = cache.getCode({
    address,
    chainID,
  });

  logger.debug('isAuthorizationCodeSet', { code, EXPECTED_CALIBUR_CODE });
  if (!code) {
    return false;
  }

  return code != '0x' && equalFold(code, EXPECTED_CALIBUR_CODE);
};

export const isNativeAddress = (contractAddress: Hex) =>
  equalFold(contractAddress, ZERO_ADDRESS) || equalFold(contractAddress, EADDRESS);

/**
 * Creates EIP2612 signature or executes non sponsored approval and transferFrom Tx
 */
export const createPermitAndTransferFromTx = async ({
  amount,
  approval,
  cache,
  chain,
  contractAddress,
  owner,
  ownerWallet,
  publicClient,
  spender,
}: {
  amount: bigint;
  approval?: Tx;
  cache: Cache;
  chain: Chain;
  contractAddress: Hex;
  owner: Hex;
  ownerWallet: WalletClient;
  publicClient: PublicClient;
  spender: Hex;
}) => {
  const txList: Tx[] = [];
  await ownerWallet.switchChain({
    id: chain.id,
  });

  logger.debug('createPermitCalls', {
    contractAddress,
    EADDRESS,
  });

  let allowance = cache.getAllowance({
    chainID: chain.id,
    contractAddress,
    owner,
    spender,
  });

  if (allowance === undefined) {
    logger.debug('createPermitCalls: allowance not found in cache', {
      cache,
      chain,
      contractAddress,
      owner,
      spender,
    });
    allowance = await publicClient.readContract({
      abi: ERC20ABI,
      address: contractAddress,
      args: [owner, spender],
      functionName: 'allowance',
    });
  }

  logger.debug('createPermitTx', { allowance, amount });

  if (allowance < amount) {
    const { variant, version } = await getTokenVersion(contractAddress, publicClient);
    if (variant === PermitVariant.Unsupported) {
      const { request } = await publicClient.simulateContract({
        chain,
        abi: ERC20ABI,
        account: owner,
        address: contractAddress,
        args: [spender, amount],
        functionName: 'approve',
      });
      const hash = await ownerWallet.writeContract(request);
      await waitForTxReceipt(hash, publicClient, 1);
      // On retry the value will be present, so no need to refetch allowance
      cache.addAllowanceValue(
        {
          chainID: chain.id,
          contractAddress,
          owner,
          spender,
        },
        amount,
      );
    } else {
      const approvalTx =
        approval ??
        (await createPermitApprovalTx({
          contractAddress,
          owner,
          ownerWallet,
          spender,
          variant,
          version,
          amount,
        }));
      txList.push(approvalTx);
    }
  }

  txList.push({
    data: encodeFunctionData({
      abi: ERC20ABI,
      args: [owner, spender, amount],
      functionName: 'transferFrom',
    }),
    to: contractAddress,
    value: 0n,
  });

  return txList;
};

export const determinePermitVariantAndVersion = async (
  client: PublicClient,
  contractAddress: Hex,
) => {
  const standardPermitData = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'permit',
        inputs: [
          { type: 'address', name: 'owner' },
          { type: 'address', name: 'spender' },
          { type: 'uint256', name: 'value' },
          { type: 'uint256', name: 'deadline' },
          { type: 'uint8', name: 'v' },
          { type: 'bytes32', name: 'r' },
          { type: 'bytes32', name: 's' },
        ],
      },
    ],
    functionName: 'permit',
    args: [
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      0n,
      0n,
      0,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    ],
  });

  // Dummy data for DAI-style permit (holder=spender=zero, nonce=0, expiry=0, allowed=true, v=0, r=0, s=0)
  const daiPermitData = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'permit',
        inputs: [
          { type: 'address', name: 'holder' },
          { type: 'address', name: 'spender' },
          { type: 'uint256', name: 'nonce' },
          { type: 'uint256', name: 'expiry' },
          { type: 'bool', name: 'allowed' },
          { type: 'uint8', name: 'v' },
          { type: 'bytes32', name: 'r' },
          { type: 'bytes32', name: 's' },
        ],
      },
    ],
    functionName: 'permit',
    args: [
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      0n,
      0n,
      true,
      0,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    ],
  });

  const promises = [
    functionExists(client, contractAddress, standardPermitData),
    functionExists(client, contractAddress, daiPermitData),
    getVersion(client, contractAddress),
  ];
  const [canonicalPermitResponse, daiPermitResponse, versionResponse] = await Promise.allSettled(
    promises,
  );

  let variant = PermitVariant.Unsupported;
  if (canonicalPermitResponse.status === 'fulfilled') {
    variant = PermitVariant.EIP2612Canonical;
  } else if (daiPermitResponse.status === 'fulfilled') {
    variant = PermitVariant.DAI;
  }

  return {
    variant,
    version: versionResponse.status === 'fulfilled' ? Number(versionResponse.value) : 1,
  };
};

async function getVersion(client: PublicClient, token: `0x${string}`): Promise<string> {
  try {
    const result = await client.readContract({
      address: token,
      abi: [
        {
          type: 'function',
          name: 'version',
          inputs: [],
          stateMutability: 'view',
          outputs: [{ name: '', type: 'string' }],
        },
      ] as const,
      functionName: 'version',
    });
    return result;
  } catch {
    return '1';
  }
}

async function functionExists(client: PublicClient, token: `0x${string}`, data: `0x${string}`) {
  return client.call({ to: token, data });
}

export const createPermitApprovalTx = async ({
  contractAddress,
  owner,
  ownerWallet,
  spender,
  variant,
  version,
  amount,
}: {
  contractAddress: Hex;
  owner: Hex;
  ownerWallet: WalletClient;
  spender: Hex;
  variant: PermitVariant;
  version: number;
  amount: bigint;
}) => {
  const deadline = createDeadlineFromNow(3n);
  const { signature } = await createPermitSignature(
    contractAddress,
    ownerWallet,
    spender,
    owner,
    variant,
    version,
    deadline,
    amount,
  );

  const { r, s, v } = parseSignature(signature);
  if (!v) {
    throw Errors.internal('invalid signature: v is not present');
  }

  return {
    data:
      variant === PermitVariant.PolygonEMT
        ? encodeFunctionData({
            abi: ERC20PermitABI,
            args: [owner, packERC20Approve(spender, amount), r, s, Number(v)],
            functionName: 'executeMetaTransaction',
          })
        : encodeFunctionData({
            abi: ERC20PermitABI,
            args: [owner, spender, amount, deadline, Number(v), r, s],
            functionName: 'permit',
          }),
    to: contractAddress,
    value: 0n,
  };
};

export const packERC20Approve = (spender: Hex, amount: bigint) => {
  return encodeFunctionData({
    abi: ERC20ABI,
    args: [spender, amount],
    functionName: 'approve',
  });
};

const multiplierByChain = (chainID: number) => {
  switch (chainID) {
    case 534352:
      return 100n;
    default:
      return 3n;
  }
};

export const getAnkrBalances = async (
  walletAddress: `0x${string}`,
  chainList: ChainListType,
  removeTransferFee = false,
) => {
  const publicClients: { [id: number]: PublicClient } = {};
  const res = await axios.post<{
    id: number;
    jsonrpc: '2.0';
    result: {
      assets: AnkrAsset[];
      totalBalanceUsd: string;
      totalCount: number;
    };
  }>('https://rpcs.avail.so/multichain', {
    id: Decimal.random(2).mul(100).toNumber(),
    jsonrpc: '2.0',
    method: 'ankr_getAccountBalance',
    params: {
      blockchain: chainList.getAnkrNameList(),
      onlyWhitelisted: true,
      pageSize: 500,
      walletAddress: walletAddress,
    },
  });
  if (!res.data?.result) throw Errors.internal('balances cannot be retrieved');

  const filteredAssets = res.data.result.assets.filter(
    (asset) =>
      AnkrChainIdMapping.has(asset.blockchain) &&
      !new Decimal(asset.tokenPrice?.trim() || 0).equals(0),
  );
  const assets: AnkrBalances = [];
  const promises = [];
  for (const asset of filteredAssets) {
    promises.push(
      (async () => {
        let balance = asset.balance;
        if (removeTransferFee && asset.tokenType === 'NATIVE') {
          const chainID = AnkrChainIdMapping.get(asset.blockchain)!;
          const chain = chainList.getChainByID(AnkrChainIdMapping.get(asset.blockchain)!)!;
          if (!publicClients[chainID]) {
            const client = createPublicClient({
              transport: http(chain.rpcUrls.default.http[0]),
            });
            publicClients[chainID] = client;
          }

          const fee = await publicClients[chainID].estimateFeesPerGas();
          const multipler = multiplierByChain(Number(chainID));
          const transferFee = divDecimals(
            fee.maxFeePerGas * 1_500_000n * multipler,
            chain.nativeCurrency.decimals,
          );

          logger.debug('getAnkrBalances', {
            balance: asset.balance,
            chainID,
            transferFee: transferFee.toFixed(),
          });

          balance = new Decimal(asset.balance).gt(transferFee)
            ? Decimal.sub(asset.balance, transferFee).toFixed(
                asset.tokenDecimals,
                Decimal.ROUND_FLOOR,
              )
            : '0';

          logger.debug('getAnkrBalances', {
            chainID,
            newBalance: balance,
            oldBalance: asset.balance,
            transferFee: transferFee.toFixed(),
          });
        }

        assets.push({
          balance,
          balanceUSD: asset.balanceUsd,
          chainID: AnkrChainIdMapping.get(asset.blockchain)!,
          tokenAddress: asset.tokenType === 'ERC20' ? asset.contractAddress : ZERO_ADDRESS,
          tokenData: {
            decimals: asset.tokenDecimals,
            icon: asset.thumbnail,
            name: asset.tokenName,
            symbol: getTokenSymbol(asset.tokenSymbol),
          },
          universe: Universe.ETHEREUM,
        });
      })(),
    );
  }
  await Promise.all(promises);
  return assets;
};

export function getTokenSymbol(symbol: string) {
  if (['USD₮', 'USD₮0', 'USDt'].includes(symbol)) {
    return 'USDT';
  }
  return symbol;
}

export const toFlatBalance = (
  assets: UserAssetDatum[],
  convertAddressToBytes32 = true,
  currentChainID?: number,
  selectedTokenAddress?: `0x${string}`,
): FlatBalance[] => {
  logger.debug('toFlatBalance', {
    assets,
  });
  return assets
    .flatMap((a) =>
      a.breakdown.map((b) => {
        const tokenAddress = equalFold(b.contractAddress, ZERO_ADDRESS)
          ? EADDRESS
          : b.contractAddress;
        return {
          amount: b.balance,
          chainID: b.chain.id,
          decimals: b.decimals,
          symbol: a.symbol,
          tokenAddress: convertAddressToBytes32 ? convertTo32BytesHex(tokenAddress) : tokenAddress,
          universe: b.universe,
          value: b.balanceInFiat,
          logo: a.icon ?? '',
        };
      }),
    )
    .filter((b) => {
      return !(b.chainID === currentChainID && equalFold(b.tokenAddress, selectedTokenAddress));
    })
    .filter(
      (b) =>
        b.universe === Universe.ETHEREUM &&
        new Decimal(b.amount).gt(0) &&
        new Decimal(b.value).gt(0),
    );
};

export const balancesToAssets = (
  isCA: boolean,
  ankrBalances: AnkrBalances,
  chainList: ChainListType,
  evmBalances: UnifiedBalanceResponseData[] = [],
  tronBalances: UnifiedBalanceResponseData[] = [],
) => {
  const assets: UserAssetDatum[] = [];
  const vscBalances = evmBalances.concat(tronBalances);

  logger.debug('balanceToAssets', {
    ankrBalances,
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
        balance.universe,
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

  for (const asset of ankrBalances) {
    if (new Decimal(asset.balance).equals(0)) {
      continue;
    }

    if (isCA) {
      // Checking if a particular token is supported for CA
      if (!chainList.getTokenByAddress(asset.chainID, asset.tokenAddress)) {
        continue;
      }
    }

    const d = chainData.get(asset.chainID);
    if (!d) {
      continue;
    }

    const chain = chainList.getChainByID(asset.chainID);
    if (!chain) {
      continue;
    }
    const existingAsset = assets.find((a) => equalFold(a.symbol, asset.tokenData.symbol));
    if (existingAsset) {
      if (
        !existingAsset.breakdown.some(
          (t) => t.chain.id === chain.id && equalFold(t.contractAddress, asset.tokenAddress),
        )
      ) {
        existingAsset.balance = Decimal.add(existingAsset.balance, asset.balance).toFixed();
        existingAsset.balanceInFiat = Decimal.add(existingAsset.balanceInFiat, asset.balanceUSD)
          .toDecimalPlaces(2)
          .toNumber();

        existingAsset.breakdown.push({
          balance: asset.balance,
          balanceInFiat: new Decimal(asset.balanceUSD).toDecimalPlaces(2).toNumber(),
          chain: {
            id: chain.id,
            logo: chain.custom.icon,
            name: chain.name,
          },
          contractAddress: asset.tokenAddress,
          decimals: asset.tokenData.decimals,
          universe: asset.universe,
        });
      }
    } else {
      assets.push({
        abstracted: true,
        balance: asset.balance,
        balanceInFiat: new Decimal(asset.balanceUSD).toDecimalPlaces(2).toNumber(),
        breakdown: [
          {
            balance: asset.balance,
            balanceInFiat: new Decimal(asset.balanceUSD).toDecimalPlaces(2).toNumber(),
            chain: {
              id: chain.id,
              logo: chain.custom.icon,
              name: chain.name,
            },
            contractAddress: asset.tokenAddress,
            decimals: asset.tokenData.decimals,
            universe: asset.universe,
          },
        ],
        decimals: asset.tokenData.decimals,
        icon: asset.tokenData.icon,
        symbol: asset.tokenData.symbol,
      });
    }
  }

  assets.forEach((asset) => {
    asset.breakdown.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  });
  assets.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  return assets;
};

export const average = (a: bigint, b: bigint) => {
  return (a & b) + ((a ^ b) >> 1n);
};

export type AllowanceInput = {
  chainID: number;
  contractAddress: Hex;
  owner: Hex;
  spender: Hex;
};

export type CreateAllowanceCacheInput = Set<AllowanceInput>;
export type SetCodeInput = {
  address: Hex;
  chainID: number;
};

export class Cache {
  public allowanceValues: Map<string, bigint> = new Map();
  public setCodeValues: Map<string, Hex | undefined> = new Map();
  private readonly allowanceQueries: Set<AllowanceInput> = new Set();
  private readonly nativeAllowanceQueries: Set<AllowanceInput> = new Set();
  private readonly setCodeQueries: Set<SetCodeInput> = new Set();

  constructor(private readonly publicClientList: PublicClientList) {}

  addAllowanceQuery(input: AllowanceInput) {
    this.allowanceQueries.add(input);
  }

  addAllowanceValue(input: AllowanceInput, value: bigint) {
    this.allowanceValues.set(getAllowanceCacheKey(input), value);
  }

  addNativeAllowanceQuery(input: AllowanceInput) {
    this.nativeAllowanceQueries.add(input);
  }

  addSetCodeQuery(input: SetCodeInput) {
    this.setCodeQueries.add(input);
  }

  addSetCodeValue(input: SetCodeInput, value: Hex) {
    this.setCodeValues.set(getSetCodeKey(input), value);
  }

  getAllowance(input: AllowanceInput) {
    return this.allowanceValues.get(getAllowanceCacheKey(input));
  }

  getCode(input: SetCodeInput) {
    return this.setCodeValues.get(getSetCodeKey(input));
  }

  async process() {
    await Promise.all([
      this.processNativeAllowanceRequests(),
      this.processAllowanceRequests(),
      this.processGetCodeRequests(),
    ]);
  }

  private async processNativeAllowanceRequests() {
    const requests: Promise<void>[] = [];
    for (const input of this.nativeAllowanceQueries) {
      const publicClient = this.publicClientList.get(input.chainID);
      requests.push(
        (async (inp: AllowanceInput, publicClient: PublicClient) => {
          let allowance = 0n;
          const code = await publicClient.getCode({
            address: inp.contractAddress,
          });
          if (equalFold(code, EXPECTED_CALIBUR_CODE)) {
            allowance = await publicClient.readContract({
              address: inp.contractAddress,
              abi: CaliburABI,
              functionName: 'nativeAllowance',
              args: [inp.spender],
            });
          }
          this.allowanceValues.set(getAllowanceCacheKey(inp), allowance);
        })(input, publicClient),
      );
    }
    await Promise.all(requests);
  }

  private async processAllowanceRequests() {
    // The request query list is small so don't care about performance here (for now)
    const unprocessedInput = [...this.allowanceQueries].filter(
      (v) => this.getAllowance(v) === undefined,
    );
    const inputByChainID = Map.groupBy(unprocessedInput, (i) => i.chainID);
    const requests = [];

    for (const [chainID, inputs] of inputByChainID) {
      const publicClient = this.publicClientList.get(chainID);

      for (const input of inputs) {
        requests.push(
          equalFold(input.contractAddress, EADDRESS)
            ? Promise.resolve(this.allowanceValues.set(getAllowanceCacheKey(input), maxUint256))
            : publicClient
                .readContract({
                  abi: ERC20ABI,
                  address: input.contractAddress,
                  args: [input.owner, input.spender],
                  functionName: 'allowance',
                })
                .then((allowance) => {
                  this.allowanceValues.set(getAllowanceCacheKey(input), allowance);
                }),
        );
      }
    }

    await Promise.all(requests);
  }

  private async processGetCodeRequests() {
    const requests = [];

    for (const input of this.setCodeQueries) {
      const publicClient = this.publicClientList.get(input.chainID);
      requests.push(
        publicClient
          .getCode({
            address: input.address,
          })
          .then((code) => {
            this.setCodeValues.set(getSetCodeKey(input), code);
          }),
      );
    }
    await Promise.all(requests);
  }
}

// To remove duplication of publicClients
export class PublicClientList {
  private list: Record<number, PublicClient> = {};
  constructor(private readonly chainList: ChainListType) {}

  get(chainID: bigint | number | string) {
    let client = this.list[Number(chainID)];
    if (!client) {
      const chain = this.chainList.getChainByID(Number(chainID));
      if (!chain) {
        throw Errors.chainNotFound(Number(chainID));
      }
      client = createPublicClient({
        transport: http(chain.rpcUrls.default.http[0]),
        batch: {
          multicall: true,
        },
      });
      this.list[Number(chainID)] = client;
    }

    return client;
  }
}

export const getAllowanceCacheKey = ({
  chainID,
  contractAddress,
  owner,
  spender,
}: AllowanceInput) => ('a' + contractAddress + chainID + owner + spender).toLowerCase();

export const getSetCodeKey = (input: SetCodeInput) =>
  ('a' + input.chainID + input.address).toLowerCase();

export const parseQuote = (
  input: {
    agg: Aggregator;
    originalHolding: Holding & { decimals: number; symbol: string };
    quote: Quote;
    req: { inputToken: Bytes };
  },
  createApproval = true,
) => {
  logger.debug('getTxsFromQuote', {
    createApproval,
    input,
  });
  if (input.agg instanceof LiFiAggregator) {
    const originalResponse = (input.quote as LiFiQuote).originalResponse;
    const tx = originalResponse.transactionRequest;
    const val = {
      input: {
        amount: input.quote.inputAmount,
        token: input.req.inputToken,
        decimals: input.originalHolding.decimals,
        symbol: input.originalHolding.symbol,
      },
      output: {
        amount: input.quote.outputAmountMinimum,
      },
      swap: {
        approval: null as null | Tx,
        tx: {
          data: tx.data as Hex,
          to: tx.to as Hex,
          value: BigInt(tx.value),
        },
      },
    };
    if (createApproval) {
      val.swap.approval = {
        data: packERC20Approve(
          originalResponse.estimate.approvalAddress as Hex,
          input.quote.inputAmount,
        ),
        to: convertToEVMAddress(input.req.inputToken),
        value: 0n,
      };
    }

    return val;
  } else if (input.agg instanceof BebopAggregator) {
    const originalResponse = (input.quote as BebopQuote).originalResponse;
    const tx = originalResponse.quote.tx;
    logger.debug('getTxsFromQuote', {
      'approval.amount': input.quote.inputAmount,
      'approval.target': originalResponse.quote.approvalTarget,
      tx: tx,
      'tx.amount': input.quote.inputAmount,
      'tx.inputToken': input.req.inputToken,
      'tx.outputAmount': input.quote.outputAmountMinimum,
    });
    const val = {
      input: {
        amount: input.quote.inputAmount,
        token: input.req.inputToken,
        decimals: input.originalHolding.decimals,
        symbol: input.originalHolding.symbol,
      },
      output: { amount: input.quote.outputAmountMinimum },
      swap: {
        approval: null as null | Tx,
        tx: {
          data: tx.data,
          to: tx.to,
          value: BigInt(tx.value),
        },
      },
    };
    if (createApproval) {
      val.swap.approval = {
        data: packERC20Approve(
          originalResponse.quote.approvalTarget as Hex,
          input.quote.inputAmount,
        ),
        to: convertToEVMAddress(input.req.inputToken),
        value: 0n,
      };
    }

    return val;
  }

  throw Errors.internal('Unknown aggregator');
};

/**
 * Creates Tx object depending on contractAddress being native or ERC20
 */
export const createTransfer = ({
  amount,
  contractAddress,
  data,
  spender,
}: {
  amount: bigint;
  contractAddress: Hex;
  data: Hex;
  owner: Hex;
  spender: Hex;
  value: bigint;
}) => {
  const tx: Tx[] = [];

  if (!equalFold(contractAddress, ZERO_ADDRESS)) {
    tx.push({
      data: packERC20Approve(spender, amount),
      to: contractAddress,
      value: 0n,
    });
  }

  tx.push({
    data: data,
    to: contractAddress,
    value: amount,
  });

  return tx;
};

export const createSwapIntent = (
  sources: {
    amount: string;
    chainID: number;
    contractAddress: `0x${string}`;
    decimals: number;
    symbol: string;
  }[],
  destination: {
    amount: string;
    chainID: number;
    contractAddress: `0x${string}`;
    decimals: number;
    symbol: string;
  },
  chainList: ChainListType,
): SwapIntent => {
  const chain = chainList.getChainByID(destination.chainID);
  if (!chain) {
    throw Errors.chainNotFound(destination.chainID);
  }

  const intent: SwapIntent = {
    destination: {
      amount: destination.amount,
      chain: {
        id: chain.id,
        logo: chain.custom.icon,
        name: chain.name,
      },
      token: {
        contractAddress: destination.contractAddress,
        decimals: destination.decimals,
        symbol: destination.symbol,
      },
    },
    sources: [],
  };

  for (const source of sources) {
    const chain = chainList.getChainByID(source.chainID);
    if (!chain) {
      throw Errors.chainNotFound(source.chainID);
    }

    intent.sources.push({
      amount: source.amount,
      chain: {
        id: chain.id,
        logo: chain.custom.icon,
        name: chain.name,
      },
      token: {
        contractAddress: source.contractAddress,
        decimals: source.decimals,
        symbol: source.symbol,
      },
    });
  }

  return intent;
};

export const getTokenInfo = async (
  contractAddress: Hex,
  publicClient: PublicClient,
  chain: Chain,
) => {
  if (isNativeAddress(contractAddress)) {
    return {
      contractAddress: ZERO_ADDRESS,
      decimals: chain.nativeCurrency.decimals,
      symbol: chain.nativeCurrency.symbol,
    };
  } else {
    const [decimals, symbol] = await Promise.all([
      publicClient.readContract({
        abi: ERC20ABI,
        address: contractAddress,
        functionName: 'decimals',
      }),
      publicClient.readContract({
        abi: ERC20ABI,
        address: contractAddress,
        functionName: 'symbol',
      }),
    ]);

    return { contractAddress, decimals, symbol };
  }
};

const metadataAxios = msgpackableAxios.create({
  baseURL: 'https://metadata-cerise.arcana.network',
});

const types = {
  Record: [
    { name: 'rff_id', type: 'uint256' },
    { name: 'has_xcs', type: 'bool' },
    { name: 'src', type: 'Transaction[]' },
    { name: 'dst', type: 'Transaction' },
  ],
  Transaction: [
    { name: 'univ', type: 'uint8' },
    { name: 'chid', type: 'bytes32' },
    { name: 'tx_hash', type: 'bytes32' },
    { name: 'swaps', type: 'XCSSwap[]' },
  ],
  XCSSwap: [
    { name: 'input_contract', type: 'bytes32' },
    { name: 'input_amt', type: 'uint256' },
    { name: 'input_decimals', type: 'uint8' },
    { name: 'output_contract', type: 'bytes32' },
    { name: 'output_amt', type: 'uint256' },
    { name: 'output_decimals', type: 'uint8' },
    { name: 'agg', type: 'uint8' },
  ],
} as const;

export type SwapMetadata = {
  dst: SwapMetadataTx;
  has_xcs: boolean;
  rff_id: bigint;
  src: SwapMetadataTx[];
};

export type SwapMetadataTx = {
  chid: Bytes;
  swaps: {
    agg: number;
    input_amt: Bytes;
    input_contract: Bytes;
    input_decimals: number;
    output_amt: Bytes;
    output_contract: Bytes;
    output_decimals: number;
  }[];
  tx_hash: Bytes;
  univ: number;
};

const convertSwapMetaToSwap = (src: SwapMetadataTx) => {
  const swaps = src.swaps.map((s) => {
    return {
      inputAmount: bytesToBigInt(s.input_amt),
      inputContract: convertToEVMAddress(s.input_contract),
      inputDecimals: s.input_decimals,
      outputAmount: bytesToBigInt(s.output_amt),
      outputContract: convertToEVMAddress(s.output_contract),
      outputDecimals: s.output_decimals,
    };
  });
  return {
    chainId: bytesToNumber(src.chid),
    swaps,
    txHash: toHex(src.tx_hash),
  };
};

export const convertMetadataToSwapResult = (
  metadata: SwapMetadata,
  baseURL: string,
): SuccessfulSwapResult => {
  return {
    sourceSwaps: metadata.src.map(convertSwapMetaToSwap),
    explorerURL: getExplorerURL(baseURL, Long.fromBigInt(metadata.rff_id)),
    destinationSwap: convertSwapMetaToSwap(metadata.dst),
  };
};

function mswap2eip712swap(input: SwapMetadataTx['swaps'][0]) {
  return {
    agg: input.agg,
    input_amt: bytesToBigInt(input.input_amt),
    input_contract: toHex(input.input_contract),
    input_decimals: input.input_decimals,
    output_amt: bytesToBigInt(input.output_amt),
    output_contract: toHex(input.output_contract),
    output_decimals: input.output_decimals,
  };
}

export const calculateValue = (
  amount: Decimal.Value,
  value: Decimal.Value,
  newAmount: Decimal.Value,
) => {
  return Decimal.div(value, amount).mul(newAmount);
};

function mtx2eip712tx(input: SwapMetadataTx) {
  return {
    chid: toHex(input.chid),
    swaps: input.swaps.map(mswap2eip712swap),
    tx_hash: toHex(input.tx_hash),
    univ: input.univ,
  };
}
export const postSwap = async ({
  metadata,
  wallet,
}: {
  metadata: SwapMetadata;
  wallet: PrivateKeyAccount;
}) => {
  logger.debug('metadata', {
    metadata,
    msg: {
      ...metadata,
      dst: mtx2eip712tx(metadata.dst),
      src: metadata.src.map(mtx2eip712tx),
    },
  });
  const signature = await wallet.signTypedData({
    domain: {
      chainId: 1n,
      name: 'CA Metadata',
      verifyingContract: ZERO_ADDRESS,
      version: '0.0.1',
    },
    message: {
      ...metadata,
      dst: mtx2eip712tx(metadata.dst),
      src: metadata.src.map(mtx2eip712tx),
    },
    primaryType: 'Record',
    types,
  });

  logger.debug('metadata', {
    data: {
      record: metadata,
      rff_id: Number(metadata.rff_id),
      sig: toBytes(signature),
    },
    signature,
  });

  const rffIDN = Number(metadata.rff_id);
  // @ts-expect-error
  delete metadata.rff_id;

  const res = await metadataAxios<{ value: number }>({
    data: {
      record: metadata,
      rff_id: rffIDN,
      sig: toBytes(signature),
    },
    method: 'POST',
    url: `/api/v1/save-metadata/${rffIDN === 0 ? 'unlinked' : 'linked'}`,
  });

  return rffIDN === 0 ? res.data.value : rffIDN;
};

export const createSweeperTxs = ({
  cache,
  chainID,
  COTCurrencyID,
  receiver,
  sender,
  tokenAddress,
}: {
  cache: Cache;
  chainID: number;
  COTCurrencyID: CurrencyID;
  receiver: Hex;
  sender: Hex;
  tokenAddress?: Hex;
}) => {
  const txs: Tx[] = [];
  if (!tokenAddress) {
    const currency = ChaindataMap.get(
      new OmniversalChainID(Universe.ETHEREUM, chainID),
    )!.Currencies.find((c) => c.currencyID === COTCurrencyID);

    if (!currency) {
      throw Errors.internal(`cot not found on chain ${chainID}`);
    }

    tokenAddress = convertToEVMAddress(currency.tokenAddress);
  }

  if (isNativeAddress(tokenAddress)) {
    const nativeAllowance = cache.getAllowance({
      chainID: Number(chainID),
      contractAddress: sender,
      owner: SWEEPER_ADDRESS,
      spender: SWEEPER_ADDRESS,
    });
    logger.debug('createSweeperTxs', {
      nativeAllowance,
    });

    if (!nativeAllowance || nativeAllowance === 0n) {
      txs.push({
        to: sender,
        data: encodeFunctionData({
          abi: CaliburABI,
          functionName: 'approveNative',
          args: [SWEEPER_ADDRESS, maxUint256],
        }),
        value: 0n,
      });
    }

    txs.push({
      data: encodeFunctionData({
        abi: SWEEP_ABI,
        args: [receiver],
        functionName: 'sweepERC7914',
      }),
      to: SWEEPER_ADDRESS,
      value: 0n,
    });
  } else {
    const sweeperAllowance = cache.getAllowance({
      chainID: Number(chainID),
      contractAddress: convertToEVMAddress(tokenAddress),
      owner: sender,
      spender: SWEEPER_ADDRESS,
    });

    if (!sweeperAllowance || sweeperAllowance === 0n) {
      txs.push({
        data: packERC20Approve(SWEEPER_ADDRESS, maxUint256),
        to: convertToEVMAddress(tokenAddress),
        value: 0n,
      });
    }
    txs.push({
      data: encodeFunctionData({
        abi: SWEEP_ABI,
        args: [convertToEVMAddress(tokenAddress), receiver],
        functionName: 'sweepERC20',
      }),
      to: SWEEPER_ADDRESS,
      value: 0n,
    });
  }

  return txs;
};

export const performDestinationSwap = async ({
  actualAddress,
  cache,
  calls,
  chain,
  chainList,
  COT,
  emitter,
  ephemeralAddress,
  ephemeralWallet,
  hasDestinationSwap,
  publicClientList,
  vscDomain,
}: {
  actualAddress: Hex;
  cache: Cache;
  calls: Tx[];
  chain: Chain;
  chainList: ChainListType;
  COT: CurrencyID;
  emitter: {
    emit: (step: SwapStepType) => void;
  };
  ephemeralAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  hasDestinationSwap: boolean;
  publicClientList: PublicClientList;
  vscDomain: string;
}) => {
  try {
    // If destination swap token is COT then calls is an empty array,
    // sweeper txs will send from ephemeral -> eoa, other cases it sweeps the dust
    const hash = await retry(async () => {
      const sbcTx = await createSBCTxFromCalls({
        cache,
        calls: calls.concat(
          createSweeperTxs({
            cache,
            chainID: chain.id,
            COTCurrencyID: COT,
            receiver: actualAddress,
            sender: ephemeralAddress,
          }),
        ),
        chainID: chain.id,
        ephemeralAddress,
        ephemeralWallet,
        publicClient: publicClientList.get(chain.id),
      });
      performance.mark('destination-swap-start');
      const ops = await vscSBCTx([sbcTx], vscDomain);
      performance.mark('destination-swap-end');

      if (hasDestinationSwap) {
        emitter.emit(SWAP_STEPS.DESTINATION_SWAP_HASH(ops[0], chainList));
      }

      performance.mark('destination-swap-mining-start');
      await waitForSBCTxReceipt(ops, chainList, publicClientList);
      performance.mark('destination-swap-mining-end');
      return ops[0][1];
    }, 2);
    return hash;
  } catch (e) {
    logger.error('destination swap failed twice, sweeping to eoa', e, { cause: 'SWAP_FAILED' });
    await vscSBCTx(
      [
        await createSBCTxFromCalls({
          cache,
          calls: createSweeperTxs({
            cache,
            chainID: chain.id,
            COTCurrencyID: COT,
            receiver: actualAddress,
            sender: ephemeralAddress,
          }),
          chainID: chain.id,
          ephemeralAddress,
          ephemeralWallet,
          publicClient: publicClientList.get(chain.id),
        }),
      ],
      vscDomain,
    ).catch((e) => {
      logger.error('error during destination sweep', e, { cause: 'DESTINATION_SWEEP_ERROR' });
    });
    throw e;
  }
};

export const getSwapSupportedChains = (chainList: ChainListType) => {
  return chainList.chains
    .filter((chain) => chain.ankrName !== '')
    .map((chain) => ({
      id: chain.id,
      name: chain.name,
      logo: chain.custom.icon,
    }));
};
