import {
  ArcanaVault,
  DepositVEPacket,
  Environment,
  EVMRFF,
  EVMVaultABI,
  MsgDoubleCheckTx,
  Universe,
} from '@arcana/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import Decimal from 'decimal.js';
import { arrayify, CHAIN_IDS, FuelConnector, hexlify, Provider } from 'fuels';
import Long from 'long';
import {
  ByteArray,
  bytesToHex,
  bytesToNumber,
  encodeAbiParameters,
  getAbiItem,
  hashMessage,
  Hex,
  keccak256,
  pad,
  PrivateKeyAccount,
  PublicClient,
  toBytes,
  toHex,
  WalletClient,
  WebSocketTransport,
} from 'viem';

import { ChainList } from '../chains';
import { FUEL_BASE_ASSET_ID, getLogoFromSymbol, isNativeAddress, ZERO_ADDRESS } from '../constants';
import { getLogger } from '../logger';
import {
  EthereumProvider,
  Intent,
  Network,
  NetworkConfig,
  OraclePriceResponse,
  ReadableIntent,
  SDKConfig,
  TokenInfo,
  TxOptions,
  UnifiedBalanceResponseData,
  ChainListType,
  NexusNetwork,
  UserAssetDatum,
  Chain,
} from '@nexus/commons';
import { FeeStore, fetchBalances } from './api.utils';
import { requestTimeout, waitForIntentFulfilment } from './contract.utils';
import { cosmosCreateDoubleCheckTx, cosmosFillCheck, cosmosRefundIntent } from './cosmos.utils';
import {} from '@nexus/commons';

const logger = getLogger();

function convertAddressByUniverse(input: Hex, universe: Universe): Hex;
function convertAddressByUniverse(input: ByteArray, universe: Universe): ByteArray;

function convertAddressByUniverse(input: ByteArray | Hex, universe: Universe) {
  const inputIsString = typeof input === 'string';
  const bytes = inputIsString ? toBytes(input) : input;

  if (universe === Universe.ETHEREUM) {
    if (bytes.length === 20) {
      return inputIsString ? input : bytes;
    }
    if (bytes.length === 32) {
      return inputIsString ? toHex(bytes.subarray(12)) : bytes.subarray(12);
    }

    throw new Error('invalid length of input');
  }

  if (universe === Universe.FUEL) {
    if (bytes.length === 32) {
      return inputIsString ? input : bytes;
    }
    if (bytes.length === 20) {
      const padded = pad(bytes, {
        dir: 'left',
        size: 32,
      });
      return inputIsString ? toHex(padded) : padded;
    }

    throw new Error('invalid length of input');
  }

  throw new Error('universe is not supported');
}

const minutesToMs = (min: number) => min * 60 * 1000;

const balancesToAssets = (balances: UnifiedBalanceResponseData[], chainList: ChainListType) => {
  const assets: UserAssets = new UserAssets([]);
  for (const balance of balances) {
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
        const asset = assets.data.find((s) => s.symbol === token.symbol);
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
          assets.add({
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

  assets.sort();

  return {
    assets,
    balanceInFiat: assets.getBalanceInFiat(),
  };
};

const INTENT_KEY = 'xar-sdk-intents';
const getIntentKey = (address: string) => {
  return `${INTENT_KEY}-${address}`;
};
type IntentD = { createdAt: number; id: number };

const storeIntentHashToStore = (address: string, id: number, createdAt = Date.now()) => {
  let intents: Array<IntentD> = [];
  const fetchedIntents = localStorage.getItem(getIntentKey(address));
  if (fetchedIntents) {
    intents = JSON.parse(fetchedIntents) ?? [];
  }

  intents.push({ createdAt, id });
  localStorage.setItem(getIntentKey(address), JSON.stringify(intents));
};

const removeIntentHashFromStore = (address: string, id: Long) => {
  let intents: Array<IntentD> = [];
  const fetchedIntents = localStorage.getItem(getIntentKey(address));
  if (fetchedIntents) {
    intents = JSON.parse(fetchedIntents) ?? [];
  }

  const oLen = intents.length;

  intents = intents.filter((h: IntentD) => h.id !== id.toNumber());
  if (oLen !== intents.length) {
    localStorage.setItem(getIntentKey(address), JSON.stringify(intents));
  }
};

const getExpiredIntents = (address: string) => {
  let intents: Array<IntentD> = [];
  const fetchedIntents = localStorage.getItem(getIntentKey(address));
  if (fetchedIntents) {
    intents = JSON.parse(fetchedIntents) ?? [];
  }
  logger.debug('getExpiredIntents', { intents });
  const expiredIntents: Array<IntentD> = [];
  const nonExpiredIntents: Array<IntentD> = [];

  const TEN_MINUTES_BEFORE = Date.now() - 600000;

  for (const intent of intents) {
    if (intent.createdAt < TEN_MINUTES_BEFORE) {
      expiredIntents.push(intent);
    } else {
      nonExpiredIntents.push(intent);
    }
  }
  localStorage.setItem(getIntentKey(address), JSON.stringify(nonExpiredIntents));
  return expiredIntents;
};

const refundExpiredIntents = async (
  address: string,
  cosmosURL: string,
  wallet: DirectSecp256k1Wallet,
) => {
  logger.debug('Starting check for expired intents at ', new Date());
  const expIntents = getExpiredIntents(address);
  const failedRefunds: IntentD[] = [];

  for (const intent of expIntents) {
    logger.debug(`Starting refund for: ${intent.id}`);
    try {
      await cosmosRefundIntent(cosmosURL, intent.id, wallet);
    } catch (e) {
      logger.debug('Refund failed', e);
      failedRefunds.push({
        createdAt: intent.createdAt,
        id: intent.id,
      });
    }
  }

  if (failedRefunds.length > 0) {
    for (const failed of failedRefunds) {
      storeIntentHashToStore(address, failed.id, failed.createdAt);
    }
  }
};

const equalFold = (a?: string, b?: string) => {
  if (!a || !b) {
    return false;
  }
  return a.toLowerCase() === b.toLowerCase();
};

const createRequestFuelSignature = async (
  fuelVaultAddress: string,
  provider: Provider,
  connector: FuelConnector,
  fuelRFF: Parameters<ArcanaVault['functions']['deposit']>[0],
) => {
  const account = await connector.currentAccount();
  if (!account) {
    throw new Error('Fuel connector is not connected.');
  }

  const vault = new ArcanaVault(hexlify(fuelVaultAddress), provider);
  const { value: hash } = await vault.functions.hash_request(fuelRFF).get();
  const signature = await connector.signMessage(account, {
    personalSign: arrayify(hash),
  });

  return { requestHash: hash as Hex, signature: arrayify(signature) };
};

const getExplorerURL = (baseURL: string, id: Long) => {
  return new URL(`/intent/${id.toNumber()}`, baseURL).toString();
};

/**
 * @param input
 * @param decimals
 * @returns input / (10**decimals)
 */
const divDecimals = (input: bigint | number | string, decimals: number) => {
  return new Decimal(input.toString()).div(Decimal.pow(10, decimals));
};

/**
 * @param input
 * @param decimals
 * @returns BigInt(input * (10**decimals))
 */
const mulDecimals = (input: Decimal | number | string, decimals: number) => {
  return BigInt(new Decimal(input).mul(Decimal.pow(10, decimals)).toFixed(0, Decimal.ROUND_CEIL));
};

const convertIntent = (
  intent: Intent,
  token: TokenInfo,
  chainList: ChainListType,
): ReadableIntent => {
  console.time('convertIntent');
  const sources = [];
  let sourcesTotal = new Decimal(0);
  for (const s of intent.sources) {
    const chainInfo = chainList.getChainByID(s.chainID);
    if (!chainInfo) {
      throw new Error('chain not supported');
    }
    sources.push({
      amount: s.amount.toFixed(),
      chainID: chainInfo.id,
      chainLogo: chainInfo.custom.icon,
      chainName: chainInfo.name,
      contractAddress: s.tokenContract,
    });
    sourcesTotal = sourcesTotal.plus(s.amount);
  }

  const allSources = [];
  for (const s of intent.allSources) {
    const chainInfo = chainList.getChainByID(s.chainID);
    if (!chainInfo) {
      throw new Error('chain not supported');
    }
    allSources.push({
      amount: s.amount.toFixed(),
      chainID: chainInfo.id,
      chainLogo: chainInfo.custom.icon,
      chainName: chainInfo.name,
      contractAddress: s.tokenContract,
    });
  }

  const destinationChainInfo = chainList.getChainByID(intent.destination.chainID);
  if (!destinationChainInfo) {
    throw new Error('chain not supported');
  }

  const destination = {
    amount: intent.destination.amount.toFixed(),
    chainID: intent.destination.chainID,
    chainLogo: destinationChainInfo?.custom.icon,
    chainName: destinationChainInfo?.name,
  };
  console.timeEnd('convertIntent');
  return {
    allSources,
    destination,
    fees: {
      caGas: Decimal.sum(intent.fees.collection, intent.fees.fulfilment).toFixed(token.decimals),
      gasSupplied: new Decimal(intent.fees.gasSupplied).toFixed(),
      protocol: new Decimal(intent.fees.protocol).toFixed(),
      solver: new Decimal(intent.fees.solver).toFixed(),
      total: Decimal.sum(
        intent.fees.collection,
        intent.fees.solver,
        intent.fees.protocol,
        intent.fees.fulfilment,
        intent.fees.gasSupplied,
      ).toFixed(token.decimals),
    },
    sources,
    sourcesTotal: sourcesTotal.toFixed(token.decimals),
    token: {
      decimals: token.decimals,
      logo: token.logo,
      name: token.name,
      symbol: token.symbol.toUpperCase(),
    },
  };
};

const hexTo0xString = (hex: string): `0x${string}` => {
  if (hex.startsWith('0x')) {
    return hex as `0x${string}`;
  }
  return `0x${hex}`;
};

const getSupportedChains = (env: Environment = Environment.CORAL) => {
  const chainList = new ChainList(env);
  return chainList.chains.map((chain) => {
    return {
      id: chain.id,
      logo: chain.custom.icon,
      name: chain.name,
      tokens: [...chain.custom.knownTokens],
    };
  });
};

const isArcanaWallet = (p: EthereumProvider) => {
  if ('isArcana' in p && p.isArcana) {
    return true;
  }
  return false;
};

const createRequestEVMSignature = async (
  evmRFF: EVMRFF,
  evmAddress: `0x${string}`,
  client: WalletClient | PrivateKeyAccount,
) => {
  logger.debug('createReqEVMSignature', { evmRFF });
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
      account: evmAddress,
      message: { raw: hash },
    }),
  );

  return { requestHash: hashMessage({ raw: hash }), signature };
};

const convertGasToToken = (
  token: TokenInfo,
  oraclePrices: OraclePriceResponse,
  destinationChainID: number,
  destinationUniverse: Universe,
  gas: Decimal,
) => {
  if (isNativeAddress(destinationUniverse, token.contractAddress)) {
    return gas;
  }

  const gasTokenInUSD =
    oraclePrices
      .find(
        (rate) =>
          rate.chainId === destinationChainID &&
          (equalFold(rate.tokenAddress, ZERO_ADDRESS) ||
            equalFold(rate.tokenAddress, FUEL_BASE_ASSET_ID)),
      )
      ?.priceUsd.toFixed() ?? '0';

  const transferTokenInUSD = oraclePrices
    .find(
      (rate) =>
        rate.chainId === destinationChainID && equalFold(rate.tokenAddress, token.contractAddress),
    )
    ?.priceUsd.toFixed();
  if (!transferTokenInUSD) {
    throw new Error('could not find token in price oracle');
  }

  const usdValue = gas.mul(gasTokenInUSD);
  const tokenEquivalent = usdValue.div(transferTokenInUSD);

  return tokenEquivalent.toDP(token.decimals, Decimal.ROUND_CEIL);
};

const evmWaitForFill = async (
  vaultContractAddress: `0x${string}`,
  publicClient: PublicClient<WebSocketTransport>,
  requestHash: `0x${string}`,
  intentID: Long,
  grpcURL: string,
  cosmosURL: string,
) => {
  const ac = new AbortController();
  await Promise.race([
    waitForIntentFulfilment(publicClient, vaultContractAddress, requestHash, ac),
    requestTimeout(3, ac),
    cosmosFillCheck(intentID, grpcURL, cosmosURL, ac),
  ]);
};

const convertBalance = (balances: Awaited<ReturnType<typeof fetchBalances>>) => {
  const parsedBreakdown = balances.assets.data.map((asset) => {
    return {
      ...asset,
      breakdown: Array.from({
        ...asset.breakdown,
        length: Object.keys(asset.breakdown).length,
      }),
    };
  });
  return parsedBreakdown.map((asset) => {
    return {
      abstracted: asset.abstracted,
      balance: asset.balance,
      balanceInFiat: asset.balanceInFiat,
      breakdown: asset.breakdown.map((breakdown) => {
        return {
          balance: breakdown.balance,
          balanceInFiat: breakdown.balanceInFiat,
          chain: {
            id: breakdown.chain.id,
            logo: breakdown.chain.logo,
            name: breakdown.chain.name,
          },
          contractAddress: breakdown.contractAddress,
          decimals: breakdown.decimals,
          isNative: breakdown.isNative,
        };
      }),
      icon: asset.icon,
      symbol: asset.symbol,
    };
  });
};

const convertTo32Bytes = (value: bigint | Hex | number) => {
  if (typeof value == 'bigint' || typeof value === 'number') {
    return toBytes(value, {
      size: 32,
    });
  }

  if (typeof value === 'string') {
    return pad(toBytes(value), {
      dir: 'left',
      size: 32,
    });
  }

  throw new Error('invalid type');
};

const convertTo32BytesHex = (value: Hex) => {
  const bytes = convertTo32Bytes(value);
  return toHex(bytes);
};

const convertToHexAddressByUniverse = (address: Uint8Array, universe: Universe) => {
  if (universe === Universe.FUEL) {
    if (address.length === 32) {
      return bytesToHex(address);
    } else {
      throw new Error('fuel: invalid address length');
    }
  } else if (universe === Universe.ETHEREUM) {
    if (address.length === 20) {
      return bytesToHex(address);
    } else if (address.length === 32) {
      if (!address.subarray(0, 12).every((b) => b === 0)) {
        throw new Error('evm: non-zero-padded 32-byte address');
      }
      return bytesToHex(address.subarray(12));
    } else {
      throw new Error('evm: invalid address length');
    }
  } else {
    throw new Error('unsupported universe');
  }
};

const createDepositDoubleCheckTx = (
  chainID: Uint8Array,
  cosmos: {
    address: string;
    wallet: DirectSecp256k1Wallet;
  },
  intentID: Long,
  network: NetworkConfig,
) => {
  const msg = MsgDoubleCheckTx.create({
    creator: cosmos.address,
    packet: {
      $case: 'depositPacket',
      value: DepositVEPacket.create({
        gasRefunded: false,
        id: intentID,
      }),
    },
    txChainID: chainID,
    txUniverse: Universe.ETHEREUM,
  });

  return () => {
    return cosmosCreateDoubleCheckTx({
      address: cosmos.address,
      cosmosURL: network.COSMOS_URL,
      msg,
      wallet: cosmos.wallet,
    });
  };
};

const getSDKConfig = (c: { network?: NexusNetwork; debug?: boolean }): Required<SDKConfig> => {
  const config = {
    debug: c.debug ?? false,
    network: Environment.CORAL as Network,
  };

  switch (c.network) {
    case 'testnet': {
      config.network = Environment.FOLLY;
      break;
    }
    case 'mainnet': {
      config.network = Environment.CORAL;
      break;
    }
  }

  return config;
};

const getTxOptions = (options?: Partial<TxOptions>) => {
  const defaultOptions: TxOptions = {
    bridge: false,
    gas: 0n,
    skipTx: false,
    sourceChains: [],
  };

  if (options?.bridge !== undefined) {
    defaultOptions.bridge = options.bridge;
  }

  if (options?.gas !== undefined) {
    defaultOptions.gas = options.gas;
  }

  if (options?.skipTx !== undefined) {
    defaultOptions.skipTx = options.skipTx;
  }

  if (options?.sourceChains !== undefined) {
    defaultOptions.sourceChains = options.sourceChains;
  }

  return defaultOptions;
};

class UserAsset {
  get balance() {
    return this.value.balance;
  }

  constructor(public value: UserAssetDatum) {}

  getBalanceOnChain(chainID: number, tokenAddress?: `0x${string}`) {
    return (
      this.value.breakdown.find((b) => {
        if (tokenAddress) {
          return b.chain.id === chainID && equalFold(b.contractAddress, tokenAddress);
        }
        return b.chain.id === chainID;
      })?.balance ?? '0'
    );
  }

  isDeposit(tokenAddress: `0x${string}`, universe: Universe) {
    if (universe === Universe.ETHEREUM) {
      return equalFold(tokenAddress, ZERO_ADDRESS);
    }

    if (universe === Universe.FUEL) {
      return true;
    }

    return false;
  }

  iterate(feeStore: FeeStore) {
    return this.value.breakdown
      .filter((b) => new Decimal(b.balance).gt(0))
      .sort((a, b) => {
        if (a.chain.id === 1) {
          return 1;
        }
        if (b.chain.id === 1) {
          return -1;
        }
        return Decimal.sub(b.balance, a.balance).toNumber();
      })
      .map((b) => {
        let balance = new Decimal(b.balance);
        if (this.isDeposit(b.contractAddress, b.universe)) {
          const collectionFee = feeStore.calculateCollectionFee({
            decimals: b.decimals,
            sourceChainID: b.chain.id,
            sourceTokenAddress: b.contractAddress,
          });

          let estimatedGasForDeposit = collectionFee.mul(b.chain.id === 1 ? 2 : 4);

          if (b.contractAddress === FUEL_BASE_ASSET_ID && b.chain.id === CHAIN_IDS.fuel.mainnet) {
            // Estimating this amount of gas is required for fuel -> vault
            estimatedGasForDeposit = new Decimal('0.000_003');
          }

          if (new Decimal(b.balance).lessThan(estimatedGasForDeposit)) {
            balance = new Decimal(0);
          } else {
            balance = new Decimal(b.balance).minus(estimatedGasForDeposit);
          }
        }
        return {
          balance,
          chainID: b.chain.id,
          decimals: b.decimals,
          tokenContract: b.contractAddress,
          universe: b.universe,
        };
      });
  }
}
class UserAssets {
  constructor(public data: UserAssetDatum[]) {}

  add(asset: UserAssetDatum) {
    this.data.push(asset);
  }

  find(symbol: string) {
    for (const asset of this.data) {
      if (equalFold(asset.symbol, symbol)) {
        return new UserAsset(asset);
      }
    }
    throw new Error('Asset is not supported.');
  }

  findOnChain(chainID: number, address: `0x${string}`) {
    return this.data.find((asset) => {
      const index = asset.breakdown.findIndex(
        (b) => b.chain.id === chainID && equalFold(b.contractAddress, address),
      );
      if (index > -1) {
        return asset;
      }
      return null;
    });
  }

  getAssetDetails(chain: Chain, address: `0x${string}`) {
    const asset = this.findOnChain(chain.id, address);
    if (!asset) {
      throw new Error('Asset is not supported.');
    }

    getLogger().debug('getAssetDetails', {
      asset,
      assets: this.data,
    });

    const destinationGasBalance = this.getNativeBalance(chain);
    const chainsWithBalance = this.getChainCountWithBalance(asset);
    const destinationAssetBalance =
      asset.breakdown.find((b) => b.chain.id === chain.id)?.balance ?? '0';
    return {
      asset,
      chainsWithBalance,
      destinationAssetBalance,
      destinationGasBalance,
    };
  }

  getBalanceInFiat() {
    return this.data
      .reduce((total, asset) => {
        return total.add(asset.balanceInFiat);
      }, new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();
  }

  getChainCountWithBalance(asset?: UserAssetDatum) {
    return asset?.breakdown.filter((b) => new Decimal(b.balance).gt(0)).length ?? 0;
  }

  getNativeBalance(chain: Chain) {
    const asset = this.data.find((a) => equalFold(a.symbol, chain.nativeCurrency.symbol));
    if (asset) {
      return asset.breakdown.find((b) => b.chain.id === chain.id)?.balance ?? '0';
    }

    return '0';
  }

  sort() {
    this.data.forEach((asset) => {
      asset.breakdown.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
    });
    this.data.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  }

  [Symbol.iterator]() {
    return this.data.values();
  }
}

export {
  UserAsset,
  UserAssets,
  balancesToAssets,
  convertAddressByUniverse,
  convertBalance,
  convertGasToToken,
  convertIntent,
  convertTo32Bytes,
  convertTo32BytesHex,
  convertToHexAddressByUniverse,
  createDepositDoubleCheckTx,
  createRequestEVMSignature,
  createRequestFuelSignature,
  divDecimals,
  equalFold,
  evmWaitForFill,
  getExpiredIntents,
  getExplorerURL,
  getSDKConfig,
  getSupportedChains,
  getTxOptions,
  hexTo0xString,
  isArcanaWallet,
  minutesToMs,
  mulDecimals,
  refundExpiredIntents,
  removeIntentHashFromStore,
  storeIntentHashToStore,
};
