import {
  Aggregator,
  BebopAggregator,
  BebopQuote,
  Bytes,
  ChaindataMap,
  createCosmosClient,
  CurrencyID,
  ERC20ABI,
  EVMRFF,
  EVMVaultABI,
  LiFiAggregator,
  LiFiQuote,
  MsgCreateRequestForFunds,
  MsgCreateRequestForFundsResponse,
  MsgDoubleCheckTx,
  msgpackableAxios,
  OmniversalChainID,
  PermitVariant,
  Quote,
  Universe,
} from '@arcana/ca-common';
import CaliburABI from './calibur.abi';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { isDeliverTxFailure } from '@cosmjs/stargate';
import axios from 'axios';
import Decimal from 'decimal.js';
import { retry } from 'es-toolkit';
import { connect } from 'it-ws';
import { pack, unpack } from 'msgpackr';
import {
  ByteArray,
  bytesToBigInt,
  bytesToNumber,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  getContract,
  Hex,
  hexToBigInt,
  http,
  keccak256,
  maxUint256,
  pad,
  parseSignature,
  PrivateKeyAccount,
  PublicClient,
  toBytes,
  toHex,
  WalletClient,
  WebSocketTransport,
} from 'viem';

import { ERC20PermitABI, ERC20PermitEIP2612PolygonType, ERC20PermitEIP712Type } from '../abi/erc20';
import { FillEvent } from '../abi/vault';
import { getLogoFromSymbol, ZERO_ADDRESS } from '../constants';
import { getLogger } from '../logger';
import {
  Chain,
  SuccessfulSwapResult,
  TokenInfo,
  UnifiedBalanceResponseData,
  UserAssetDatum,
} from '@nexus/commons';
import {
  convertAddressByUniverse,
  convertTo32BytesHex,
  divDecimals,
  equalFold,
  getCosmosURL,
  getExplorerURL,
  getVSCURL,
  waitForTxReceipt,
} from '../utils';
import { SWEEP_ABI } from './abi';
import { CALIBUR_ADDRESS, EADDRESS, SWEEPER_ADDRESS } from './constants';
import { chainData, getTokenVersion } from './data';
import { createSBCTxFromCalls, waitForSBCTxReceipt } from './sbc';
import { DESTINATION_SWAP_HASH, SwapStep } from './steps';
import { AnkrAsset, AnkrBalances, SBCTx, SwapIntent, Tx, ChainListType } from '@nexus/commons';
import Long from 'long';

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

  throw new Error('Invalid address');
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
      deadline: maxUint256,
      nonce,
      owner: walletAddress,
      spender: spender,
      value: maxUint256,
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
            deadline: maxUint256,
            nonce,
            owner: walletAddress,
            spender: spender,
            value: maxUint256,
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
            functionSignature: packERC20Approve(spender),
            nonce,
          },
          primaryType: 'MetaTransaction',
          types: ERC20PermitEIP2612PolygonType,
        }),
        variant,
      };
    }
    default: {
      throw new Error('Token Not supported: (2612 details not found)');
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
        throw new Error('Error in VSC SBC Tx');
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

export const createRequestEVMSignature = async (evmRFF: EVMRFF, client: WalletClient) => {
  const account = (await client.getAddresses())[0];
  const abi = getAbiItem({ abi: EVMVaultABI, name: 'deposit' });
  const msg = encodeAbiParameters(abi.inputs[0].components, [
    evmRFF.sources,
    evmRFF.destinationUniverse,
    evmRFF.destinationChainID,
    evmRFF.destinations,
    evmRFF.nonce,
    evmRFF.expiry,
    evmRFF.parties,
  ]);
  const hash = keccak256(msg, 'bytes');
  const signature = toBytes(
    await client.signMessage({
      account,
      message: { raw: hash },
    }),
  );

  return { requestHash: hash, signature };
};

export const cosmosCreateRFF = async ({
  address,
  cosmosURL,
  msg,
  wallet,
}: {
  address: string;
  cosmosURL: string;
  msg: MsgCreateRequestForFunds;
  wallet: DirectSecp256k1Wallet;
}) => {
  const client = await createCosmosClient(wallet, getCosmosURL(cosmosURL, 'rpc'), {
    broadcastPollIntervalMs: 250,
  });

  const res = await client.signAndBroadcast(
    address,
    [
      {
        typeUrl: '/xarchain.chainabstraction.MsgCreateRequestForFunds',
        value: msg,
      },
    ],
    {
      amount: [],
      gas: 100_000n.toString(10),
    },
  );

  if (isDeliverTxFailure(res)) {
    throw new Error('Error creating RFF');
  }

  const decoded = MsgCreateRequestForFundsResponse.decode(res.msgResponses[0].value);
  return decoded.id;
};
export const cosmosCreateDoubleCheckTx = async ({
  address,
  cosmosURL,
  msg,
  wallet,
}: {
  address: string;
  cosmosURL: string;
  msg: MsgDoubleCheckTx;
  wallet: DirectSecp256k1Wallet;
}) => {
  const client = await createCosmosClient(wallet, getCosmosURL(cosmosURL, 'rpc'), {
    broadcastPollIntervalMs: 250,
  });

  logger.debug('cosmosCreateDoubleCheckTx:1', { doubleCheckMsg: msg });

  const res = await client.signAndBroadcast(
    address,
    [
      {
        typeUrl: '/xarchain.chainabstraction.MsgDoubleCheckTx',
        value: msg,
      },
    ],
    {
      amount: [],
      gas: 100_000n.toString(10),
    },
  );

  if (isDeliverTxFailure(res)) {
    throw new Error('Error creating MsgDoubleCheckTx');
  }

  logger.debug('cosmosCreateDoubleCheckTx:2', { doubleCheckTx: res });
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
    const { variant, version } = getTokenVersion(contractAddress);
    if (variant === PermitVariant.Unsupported) {
      const { request } = await publicClient.simulateContract({
        chain,
        abi: ERC20ABI,
        account: owner,
        address: contractAddress,
        args: [spender, maxUint256],
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
        maxUint256,
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

export const createPermitApprovalTx = async ({
  contractAddress,
  owner,
  ownerWallet,
  spender,
  variant,
  version,
}: {
  contractAddress: Hex;
  owner: Hex;
  ownerWallet: WalletClient;
  spender: Hex;
  variant: PermitVariant;
  version: number;
}) => {
  const { signature } = await createPermitSignature(
    contractAddress,
    ownerWallet,
    spender,
    owner,
    variant,
    version,
  );

  const { r, s, v } = parseSignature(signature);
  if (!v) {
    throw new Error('invalid signature: v is not present');
  }

  return {
    data:
      variant === PermitVariant.PolygonEMT
        ? encodeFunctionData({
            abi: ERC20PermitABI,
            args: [owner, packERC20Approve(spender), r, s, Number(v)],
            functionName: 'executeMetaTransaction',
          })
        : encodeFunctionData({
            abi: ERC20PermitABI,
            args: [owner, spender, maxUint256, maxUint256, Number(v), r, s],
            functionName: 'permit',
          }),
    to: contractAddress,
    value: 0n,
  };
};

export const packERC20Approve = (spender: Hex, amount = maxUint256) => {
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
  }>(
    'https://rpc.ankr.com/multichain/269e541dd5773dac3204831e29b9538284dd3e9591d2b7cb2ac47d85eae213b9/',
    {
      id: Decimal.random(2).mul(100).toNumber(),
      jsonrpc: '2.0',
      method: 'ankr_getAccountBalance',
      params: {
        blockchain: chainList.getAnkrNameList(),
        onlyWhitelisted: true,
        pageSize: 500,
        walletAddress: walletAddress,
      },
    },
  );
  if (!res.data?.result) throw new Error('balances cannot be retrieved');

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
          tokenAddress:
            asset.tokenType === 'ERC20' ? asset.contractAddress : (ZERO_ADDRESS as `0x${string}`),
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
  currentChainID?: number,
  selectedTokenAddress?: `0x${string}`,
) => {
  logger.debug('toFlatBalance', {
    assets,
  });
  return assets
    .map((a) =>
      a.breakdown.map((b) => {
        return {
          amount: b.balance,
          chainID: b.chain.id,
          decimals: b.decimals,
          symbol: a.symbol,
          tokenAddress: convertTo32BytesHex(
            b.contractAddress === ZERO_ADDRESS ? EADDRESS : b.contractAddress,
          ),
          universe: b.universe,
          value: b.balanceInFiat,
        };
      }),
    )
    .flat()
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
  ankrBalances: AnkrBalances,
  evmBalances: UnifiedBalanceResponseData[],
  fuelBalances: UnifiedBalanceResponseData[],
  chainList: ChainListType,
) => {
  const assets: UserAssetDatum[] = [];
  const vscBalances = evmBalances.concat(fuelBalances);

  logger.debug('balanceToAssets', {
    ankrBalances,
    evmBalances,
    fuelBalances,
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
        const asset = assets.find((s) => s.symbol === token.symbol);
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
                  logo: chain.custom.icon as string,
                  name: chain.name as string,
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
        !existingAsset.breakdown.find(
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
              logo: chain.custom.icon as string,
              name: chain.name as string,
            },
            contractAddress: asset.tokenAddress,
            decimals: asset.tokenData.decimals,
            universe: asset.universe,
          },
        ],
        decimals: asset.tokenData.decimals,
        icon: asset.tokenData.icon,
        symbol: asset.tokenData.symbol as string,
      });
    }
  }

  assets.forEach((asset) => {
    asset.breakdown.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  });
  assets.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  return assets;
};

export const waitForIntentFulfilment = async (
  publicClient: PublicClient<WebSocketTransport>,
  vaultContractAddr: `0x${string}`,
  requestHash: `0x${string}`,
): Promise<void> => {
  logger.debug('waitForIntentFulfilment', { requestHash });
  return new Promise((resolve) => {
    const unwatch = publicClient.watchContractEvent({
      abi: [FillEvent] as const,
      address: vaultContractAddr,
      args: { requestHash },
      eventName: 'Fill',
      onLogs: (logs) => {
        logger.debug('waitForIntentFulfilment', { logs });
        publicClient.transport.getRpcClient().then((c) => c.close());
        // ac?.abort();
        unwatch();
        return resolve(void 0);
      },
      poll: false,
    });
    // ac?.signal.addEventListener(
    //   "abort",
    //   () => {
    //     unwatch();
    //   },
    //   { once: true },
    // );
  });
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
  private allowanceQueries: Set<AllowanceInput> = new Set();
  private nativeAllowanceQueries: Set<AllowanceInput> = new Set();
  private setCodeQueries: Set<SetCodeInput> = new Set();

  constructor(private publicClientList: PublicClientList) {}

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
    const requests = [];

    for (const input of this.nativeAllowanceQueries) {
      const publicClient = this.publicClientList.get(input.chainID);
      requests.push(
        publicClient
          .readContract({
            address: input.contractAddress,
            abi: CaliburABI,
            functionName: 'nativeAllowance',
            args: [input.spender],
          })
          .then((code) => {
            this.allowanceValues.set(getAllowanceCacheKey(input), code);
          }),
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
  constructor(private chainList: ChainListType) {}

  get(chainID: bigint | number | string) {
    let client = this.list[Number(chainID)];
    if (!client) {
      const chain = this.chainList.getChainByID(Number(chainID));
      if (!chain) {
        throw new Error(`Chain not found: ${chainID}`);
      }
      client = createPublicClient({
        transport: http(chain.rpcUrls.default.http[0]),
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

// const APPROVE_GAS_LIMIT = 63_000n;

// export const swapToGasIfPossible = async ({
//   actualAddress,
//   aggregators,
//   assetsUsed,
//   balances,
//   chainList,
//   ephemeralAddress,
//   oraclePrices,
// }: {
//   actualAddress: Bytes;
//   aggregators: Aggregator[];
//   assetsUsed: {
//     amount: string;
//     chainID: number;
//     contractAddress: `0x${string}`;
//   }[];
//   balances: Balances;
//   chainList: ChainList;
//   ephemeralAddress: Bytes;
//   grpcURL: string;
//   oraclePrices: OraclePriceResponse;
// }) => {
//   const aci: CreateAllowanceCacheInput = new Set();
//   const blacklist: Hex[] = [];
//   const data: {
//     [k: number]: {
//       amount: bigint;
//       contractAddress: Hex;
//       txs: Tx[];
//       unsupportedTokens: Hex[];
//     };
//   } = {};

//   let requote = false;
//   const chainToUnsupportedTokens: Record<number, Hex[]> = {};

//   const assetsGroupedByChain = Map.groupBy(
//     assetsUsed,
//     (asset) => asset.chainID,
//   );

//   for (const [chainID, swapQuotes] of assetsGroupedByChain) {
//     for (const sQuote of swapQuotes) {
//       if (!isEIP2612Supported(sQuote.contractAddress, BigInt(chainID))) {
//         if (!chainToUnsupportedTokens[Number(chainID)]) {
//           chainToUnsupportedTokens[Number(chainID)] = [];
//         }
//         aci.add({
//           chainID: Number(chainID),
//           contractAddress: sQuote.contractAddress,
//           owner: convertToEVMAddress(actualAddress),
//           spender: convertToEVMAddress(ephemeralAddress),
//         });
//         chainToUnsupportedTokens[Number(chainID)].push(sQuote.contractAddress);
//       }
//     }
//   }
//   logger.debug("checkAndSupplyGasForApproval:1", {
//     assetsGroupedByChain,
//     chainToUnsupportedTokens,
//   });

//   const allowanceCache = await createAllowanceCache(aci, chainList);

//   if (Object.keys(chainToUnsupportedTokens).length === 0) {
//     return { blacklist, data, requote: false };
//   }

//   for (const chainID in chainToUnsupportedTokens) {
//     const tokens: Hex[] = [];
//     for (const token of chainToUnsupportedTokens[chainID]) {
//       const allowance = allowanceCache.gget({
//         chainID: Number(chainID),
//         owner: convertToEVMAddress(actualAddress),
//         spender: convertToEVMAddress(ephemeralAddress),
//         tokenAddress: token,
//       });
//       if (!allowance || allowance < 100000000n) {
//         tokens.push(token);
//       }
//     }
//     if (tokens.length) {
//       chainToUnsupportedTokens[chainID] = tokens;
//     } else {
//       delete chainToUnsupportedTokens[chainID];
//     }

//     const quotes = assetsGroupedByChain.get(Number(chainID));
//     const balancesOnChain = balances.filter(
//       (b) =>
//         b.chain_id === Number(chainID) &&
//         isEIP2612Supported(b.token_address, BigInt(chainID)),
//     );

//     const chain = chainList.getChainByID(Number(chainID));
//     if (!chain) {
//       throw new Error(`chain not found: ${chainID}`);
//     }

//     const publicClient = createPublicClient({
//       transport: http(chain.rpcUrls.default.http[0]),
//     });

//     const gasPrice = await publicClient.estimateFeesPerGas();

//     const gas =
//       APPROVE_GAS_LIMIT *
//       gasPrice.maxFeePerGas *
//       BigInt(chainToUnsupportedTokens[chainID].length) *
//       3n;

//     const nativeBalance = balances.find(
//       (b) =>
//         b.chain_id === Number(chainID) && equalFold(b.token_address, EADDRESS),
//     );

//     logger.debug("checkAndSupplyGasForApproval:2", {
//       gas,
//       gasPrice,
//       nativeBalance,
//     });

//     if (new Decimal(nativeBalance?.amount ?? 0).gte(gas)) {
//       data[Number(chainID)] = {
//         // Since txs.length == 0, amount and contractAddress should not get used, only unsupported token
//         amount: 0n,
//         contractAddress: "0x",
//         txs: [],
//         unsupportedTokens: chainToUnsupportedTokens[chainID],
//       };
//       continue;
//     }

//     let done = false;

//     // Split between sources included and excluded in source swaps
//     const split = splitBalanceByQuotes(balancesOnChain, quotes!);
//     logger.debug("checkAndSupplyGasForApproval:3", {
//       chainID,
//       split,
//     });
//     for (const s of split.excluded) {
//       const gasInToken = convertGasToToken(
//         {
//           contractAddress: s.token_address,
//           decimals: s.decimals,
//           priceUSD: s.priceUSD,
//         },
//         oraclePrices,
//         chain.id,
//         divDecimals(gas, chain.nativeCurrency.decimals),
//       );

//       logger.debug("checkAndSupplyGasForApproval:3:excluded", {
//         amount: s.amount,
//         gasInToken: gasInToken.toFixed(),
//         token: s,
//       });

//       if (gasInToken.lt(s.amount)) {
//         const res = await swapToGasQuote(
//           ephemeralAddress,
//           actualAddress,
//           new OmniversalChainID(Universe.ETHEREUM, chainID),
//           {
//             tokenAddress: EADDRESS_32_BYTES,
//           },
//           aggregators,
//           {
//             amount: mulDecimals(gasInToken, s.decimals),
//             decimals: s.decimals,
//             tokenAddress: convertTo32Bytes(s.token_address),
//           },
//         );
//         if (res.quote) {
//           const txs = getTxsFromQuote(
//             res.aggregator,
//             res.quote,
//             convertTo32Bytes(s.token_address),
//           );
//           data[Number(chainID)] = {
//             amount: mulDecimals(gasInToken, s.decimals),
//             contractAddress: s.token_address,
//             txs: [txs.approval!, txs.swap],
//             unsupportedTokens: chainToUnsupportedTokens[chainID],
//           };
//           done = true;
//           break;
//         }
//       }
//     }

//     if (!done) {
//       for (const s of split.included) {
//         const gasInToken = convertGasToToken(
//           {
//             contractAddress: s.token_address,
//             decimals: s.decimals,
//             priceUSD: s.priceUSD,
//           },
//           oraclePrices,
//           chain.id,
//           divDecimals(gas, chain.nativeCurrency.decimals),
//         );

//         logger.debug("checkAndSupplyGasForApproval:3:included", {
//           amount: s.amount,
//           gasInToken: gasInToken.toFixed(),
//         });

//         if (gasInToken.gte(s.amount)) {
//           const res = await swapToGasQuote(
//             ephemeralAddress,
//             actualAddress,
//             new OmniversalChainID(Universe.ETHEREUM, chainID),
//             {
//               tokenAddress: EADDRESS_32_BYTES,
//             },
//             aggregators,
//             {
//               amount: mulDecimals(gasInToken, s.decimals),
//               decimals: s.decimals,
//               tokenAddress: convertTo32Bytes(s.token_address),
//             },
//           );
//           if (res.quote) {
//             const txs = getTxsFromQuote(
//               res.aggregator,
//               res.quote,
//               convertTo32Bytes(s.token_address),
//             );
//             data[Number(chainID)] = {
//               amount: mulDecimals(gasInToken, s.decimals),
//               contractAddress: s.token_address,
//               txs: [txs.approval!, txs.swap],
//               unsupportedTokens: chainToUnsupportedTokens[chainID],
//             };
//             // since we had to use source swap token for gas
//             // TODO: Check if we have enough if we swap for gas otherwise throw error
//             done = true;
//             requote = true;
//             break;
//           }
//         }
//       }
//     }

//     if (!done) {
//       throw new Error(`could not swap token for gas on chain: ${chainID}`);
//     }
//   }

//   return {
//     blacklist,
//     data,
//     requote,
//   };
// };

// const convertGasToToken = (
//   token: { contractAddress: Hex; decimals: number; priceUSD: string },
//   oraclePrices: OraclePriceResponse,
//   destinationChainID: number,
//   gas: Decimal,
// ) => {
//   const gasTokenPerUSD =
//     oraclePrices
//       .find(
//         (rate) =>
//           rate.chainId === destinationChainID &&
//           equalFold(rate.tokenAddress, ZERO_ADDRESS),
//       )
//       ?.tokensPerUsd.toString() ?? "0";
//   const transferTokenPerUSD = Decimal.div(1, token.priceUSD);

//   logger.debug("convertGasToToken", {
//     gas: gas.toFixed(),
//     gasTokenPerUSD,
//     transferTokenPerUSD,
//   });

//   const gasInUSD = new Decimal(1).div(gasTokenPerUSD).mul(gas);
//   const totalRequired = new Decimal(gasInUSD).div(transferTokenPerUSD);

//   return totalRequired.toDP(token.decimals, Decimal.ROUND_CEIL);
// };

export const getTxsFromQuote = (
  aggregator: Aggregator,
  quote: Quote,
  inputToken: Bytes,
  createApproval = true,
) => {
  logger.debug('getTxsFromQuote', {
    aggregator,
    createApproval,
    inputToken,
    quote,
  });
  if (aggregator instanceof LiFiAggregator) {
    const originalResponse = (quote as LiFiQuote).originalResponse;
    const tx = originalResponse.transactionRequest;
    logger.debug('getTxsFromQuote', {
      'approval.amount': quote.inputAmount,
      'approval.target': originalResponse.estimate.approvalAddress,
      tx: tx,
      'tx.amount': quote.inputAmount,
      'tx.inputToken': inputToken,
      'tx.outputAmount': quote.outputAmountMinimum,
    });
    const val = {
      amount: quote.inputAmount,
      approval: null as null | Tx,
      inputToken,
      outputAmount: quote.outputAmountMinimum,
      swap: {
        data: tx.data as Hex,
        to: tx.to as Hex,
        value: BigInt(tx.value),
      },
    };
    if (createApproval) {
      val.approval = {
        data: packERC20Approve(originalResponse.estimate.approvalAddress as Hex, quote.inputAmount),
        to: convertToEVMAddress(inputToken),
        value: 0n,
      };
    }

    return val;
  } else if (aggregator instanceof BebopAggregator) {
    const originalResponse = (quote as BebopQuote).originalResponse;
    const tx = originalResponse.quote.tx;
    logger.debug('getTxsFromQuote', {
      'approval.amount': quote.inputAmount,
      'approval.target': originalResponse.quote.approvalTarget,
      tx: tx,
      'tx.amount': quote.inputAmount,
      'tx.inputToken': inputToken,
      'tx.outputAmount': quote.outputAmountMinimum,
    });
    const val = {
      amount: quote.inputAmount,
      approval: null as null | Tx,
      inputToken,
      outputAmount: quote.outputAmountMinimum,
      swap: {
        data: tx.data,
        to: tx.to,
        value: BigInt(tx.value),
      },
    };
    if (createApproval) {
      val.approval = {
        data: packERC20Approve(originalResponse.quote.approvalTarget as Hex, quote.inputAmount),
        to: convertToEVMAddress(inputToken),
        value: 0n,
      };
    }

    return val;
  }

  throw new Error('Unknown aggregator');
};

// const splitBalanceByQuotes = (
//   balances: Balances,
//   quotes: {
//     amount: string;
//     chainID: number;
//     contractAddress: `0x${string}`;
//   }[],
// ) => {
//   const [included, excluded] = partition(balances, (b) => {
//     return !!quotes.find((q) => equalFold(q.contractAddress, b.token_address));
//   });

//   return {
//     excluded,
//     included,
//   };
// };

// export async function swapToGasQuote(
//   userAddress: Bytes,
//   receiverAddress: Bytes | null,
//   chainID: OmniversalChainID,
//   requirement: {
//     tokenAddress: Bytes;
//   },
//   aggregators: Aggregator[],
//   cur: {
//     amount: bigint;
//     decimals: number;
//     tokenAddress: Bytes;
//   },
// ): Promise<{
//   aggregator: Aggregator;
//   inputAmount: Decimal;
//   quote: null | Quote;
// }> {
//   // We spray and pray
//   const buyQuoteResult = await aggregateAggregators(
//     [
//       {
//         chain: chainID,
//         inputAmount: cur.amount,
//         inputToken: cur.tokenAddress,
//         outputToken: requirement.tokenAddress,
//         receiverAddress,
//         type: QuoteType.ExactIn,
//         userAddress,
//       },
//     ],
//     aggregators,
//     0,
//   );
//   if (buyQuoteResult.length !== 1) {
//     throw new AutoSelectionError("???");
//   }

//   const buyQuote = buyQuoteResult[0];
//   if (buyQuote.quote == null) {
//     throw new AutoSelectionError("Couldn't get buy quote");
//   }

//   return {
//     ...buyQuote,
//     inputAmount: convertBigIntToDecimal(buyQuote.quote.inputAmount).div(
//       Decimal.pow(10, cur.decimals),
//     ),
//   };
// }

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
    throw new Error(`chain not found: ${destination.chainID}`);
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
      throw new Error(`chain not found: ${source.chainID}`);
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
  // @ts-ignore
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
      throw new Error(`cot not found on chain ${chainID}`);
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
        data: packERC20Approve(SWEEPER_ADDRESS),
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
    emit: (step: SwapStep) => void;
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
        emitter.emit(DESTINATION_SWAP_HASH(ops[0], chainList));
      }

      performance.mark('destination-swap-mining-start');
      await waitForSBCTxReceipt(ops, chainList, publicClientList);
      performance.mark('destination-swap-mining-end');
      return ops[0][1];
    }, 2);
    return hash;
  } catch (e) {
    logger.error('destination swap failed twice, sweeping to eoa', e);
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
      logger.error('error during destination sweep', e);
    });
    throw e;
  }
};

export const getSwapSupportedChains = (chainList: ChainListType) => {
  const chains: {
    id: number;
    logo: string;
    name: string;
    tokens: TokenInfo[];
  }[] = [];
  for (const c of chainData.keys()) {
    const chain = chainList.getChainByID(c);
    if (!chain) {
      continue;
    }

    const data = {
      id: chain.id,
      logo: chain.custom.icon,
      name: chain.name,
      tokens: [] as TokenInfo[],
    };

    const tokens = chainData.get(c);
    if (!tokens) {
      continue;
    }

    tokens.forEach((t) => {
      if (t.PermitVariant !== PermitVariant.Unsupported) {
        data.tokens.push({
          contractAddress: convertToEVMAddress(t.TokenContractAddress),
          decimals: t.TokenDecimals,
          logo: '',
          name: t.Name,
          symbol: t.Name,
        });
      }
    });

    chains.push(data);
  }
  return chains;
};
