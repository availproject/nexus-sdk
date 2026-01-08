import {
  type Bytes,
  DepositVEPacket,
  Environment,
  ERC20ABI,
  type EVMRFF,
  EVMVaultABI,
  MsgDoubleCheckTx,
  Universe,
} from '@avail-project/ca-common';
import type { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';
import Decimal from 'decimal.js';
import type Long from 'long';
import { type TronWeb, utils } from 'tronweb';
import {
  type ByteArray,
  bytesToHex,
  bytesToNumber,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  type Hex,
  hashMessage,
  hexToBigInt,
  keccak256,
  type PrivateKeyAccount,
  type PublicClient,
  pad,
  toBytes,
  toHex,
  UserRejectedRequestError,
  type WalletClient,
  type WebSocketTransport,
} from 'viem';
import type { AnalyticsManager } from '../../../analytics/AnalyticsManager';
import { NexusAnalyticsEvents } from '../../../analytics/events';
import {
  type Chain,
  type ChainListType,
  type CosmosOptions,
  type CosmosQueryClient,
  getLogger,
  type IBridgeOptions,
  type Intent,
  type OraclePriceResponse,
  type ReadableIntent,
  type SupportedChainsAndTokensResult,
  type TokenInfo,
  type UserAssetDatum,
} from '../../../commons';
import { ChainList } from '../chains';
import { getLogoFromSymbol, isNativeAddress, ZERO_ADDRESS } from '../constants';
import { Errors } from '../errors';
import {
  createPublicClientWithFallback,
  requestTimeout,
  waitForIntentFulfilment,
} from './contract.utils';
import { cosmosCreateDoubleCheckTx, cosmosFillCheck, cosmosRefundIntent } from './cosmos.utils';
import { PlatformUtils } from './platform.utils';

const logger = getLogger();

function convertAddressByUniverse(input: Hex, universe: Universe): Hex;
function convertAddressByUniverse(input: ByteArray, universe: Universe): ByteArray;

function convertAddressByUniverse(input: ByteArray | Hex, universe: Universe) {
  const inputIsString = typeof input === 'string';
  const bytes = inputIsString ? toBytes(input) : input;

  if (universe === Universe.ETHEREUM || universe === Universe.TRON) {
    if (bytes.length === 20) {
      return inputIsString ? input : bytes;
    }
    if (bytes.length === 32) {
      return inputIsString ? toHex(bytes.subarray(12)) : bytes.subarray(12);
    }

    throw Errors.invalidAddressLength('evm|tron');
  }

  return toHex(input);
}

const minutesToMs = (min: number) => min * 60 * 1000;

const INTENT_KEY = 'xar-sdk-intents';
const getIntentKey = (address: string) => {
  return `${INTENT_KEY}-${address}`;
};
type IntentD = { createdAt: number; id: number };

const storeIntentHashToStore = (address: string, id: number, createdAt = Date.now()) => {
  let intents: Array<IntentD> = [];
  const fetchedIntents = PlatformUtils.storageGetItem(getIntentKey(address));
  if (fetchedIntents) {
    intents = JSON.parse(fetchedIntents) ?? [];
  }

  intents.push({ createdAt, id });
  PlatformUtils.storageSetItem(getIntentKey(address), JSON.stringify(intents));
};

const removeIntentHashFromStore = (address: string, id: Long) => {
  let intents: Array<IntentD> = [];
  const fetchedIntents = PlatformUtils.storageGetItem(getIntentKey(address));
  if (fetchedIntents) {
    intents = JSON.parse(fetchedIntents) ?? [];
  }

  const oLen = intents.length;

  intents = intents.filter((h: IntentD) => h.id !== id.toNumber());
  if (oLen !== intents.length) {
    PlatformUtils.storageSetItem(getIntentKey(address), JSON.stringify(intents));
  }
};

const getExpiredIntents = (address: string) => {
  let intents: Array<IntentD> = [];
  const fetchedIntents = PlatformUtils.storageGetItem(getIntentKey(address));
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
  PlatformUtils.storageSetItem(getIntentKey(address), JSON.stringify(nonExpiredIntents));
  return expiredIntents;
};

const refundExpiredIntents = async ({
  address,
  evmAddress,
  client,
  analytics,
}: CosmosOptions & { evmAddress: string; analytics?: AnalyticsManager }) => {
  logger.debug('Starting check for expired intents at ', new Date());
  const expIntents = getExpiredIntents(evmAddress);
  const failedRefunds: IntentD[] = [];

  for (const intent of expIntents) {
    logger.debug(`Starting refund for: ${intent.id}`);

    // Track refund initiated
    if (analytics) {
      analytics.track(NexusAnalyticsEvents.REFUND_INITIATED, {
        intentId: intent.id,
        createdAt: intent.createdAt,
      });
    }

    try {
      await cosmosRefundIntent({ client, intentID: intent.id, address });
      // Track refund success
      if (analytics) {
        analytics.track(NexusAnalyticsEvents.REFUND_COMPLETED, {
          intentId: intent.id,
          createdAt: intent.createdAt,
        });
      }
    } catch (e) {
      logger.debug('Refund failed', e);

      // Track refund failure
      if (analytics) {
        analytics.trackError('refund', e, {
          intentId: intent.id,
          createdAt: intent.createdAt,
        });
      }

      failedRefunds.push({
        createdAt: intent.createdAt,
        id: intent.id,
      });
    }
  }

  if (failedRefunds.length > 0) {
    for (const failed of failedRefunds) {
      storeIntentHashToStore(evmAddress, failed.id, failed.createdAt);
    }
  }
};

const equalFold = (a?: string, b?: string) => {
  if (!a || !b) {
    return false;
  }
  return a.toLowerCase() === b.toLowerCase();
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
  chainList: ChainListType
): ReadableIntent => {
  console.time('convertIntent');
  const sources = [];
  let sourcesTotal = new Decimal(0);
  for (const s of intent.sources) {
    const chainInfo = chainList.getChainByID(s.chainID);
    if (!chainInfo) {
      throw Errors.chainNotFound(s.chainID);
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
      throw Errors.chainNotFound(s.chainID);
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
    throw Errors.chainNotFound(intent.destination.chainID);
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
        intent.fees.gasSupplied
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

const getSupportedChains = (
  env: Environment = Environment.CORAL
): SupportedChainsAndTokensResult => {
  const chainList = new ChainList(env);
  return chainList.chains.map((chain) => {
    return {
      id: chain.id,
      logo: chain.custom.icon,
      name: chain.name,
      tokens: [
        ...chain.custom.knownTokens,
        {
          contractAddress: ZERO_ADDRESS,
          decimals: chain.nativeCurrency.decimals,
          logo: getLogoFromSymbol(chain.nativeCurrency.symbol),
          name: chain.nativeCurrency.name,
          symbol: chain.nativeCurrency.symbol,
        },
      ],
    };
  });
};

const createRequestEVMSignature = async (
  evmRFF: EVMRFF,
  evmAddress: `0x${string}`,
  client: WalletClient | PrivateKeyAccount
) => {
  logger.debug('createReqEVMSignature', { evmRFF });
  const abi = getAbiItem({ abi: EVMVaultABI, name: 'deposit' });
  const msg = encodeAbiParameters(abi.inputs[0].components, [
    evmRFF.sources,
    evmRFF.destinationUniverse,
    evmRFF.destinationChainID,
    evmRFF.recipientAddress,
    evmRFF.destinations,
    evmRFF.nonce,
    evmRFF.expiry,
    evmRFF.parties,
  ]);

  const hash = keccak256(msg, 'bytes');
  const signature = toBytes(
    await client
      .signMessage({
        account: evmAddress,
        message: { raw: hash },
      })
      .catch((e) => {
        if (e instanceof UserRejectedRequestError) {
          throw Errors.userRejectedIntentSignature();
        }
        throw e;
      })
  );

  return { requestHash: hashMessage({ raw: hash }), signature };
};

const createRequestTronSignature = async (evmRFF: EVMRFF, client: AdapterProps) => {
  logger.debug('createReqEVMSignature', { evmRFF });
  const abi = getAbiItem({ abi: EVMVaultABI, name: 'deposit' });
  const msg = encodeAbiParameters(abi.inputs[0].components, [
    evmRFF.sources,
    evmRFF.destinationUniverse,
    evmRFF.destinationChainID,
    evmRFF.recipientAddress,
    evmRFF.destinations,
    evmRFF.nonce,
    evmRFF.expiry,
    evmRFF.parties,
  ]);
  const hash = toHex(keccak256(msg, 'bytes'));

  // FIXME: Hack - since tron doesn't supports binary decode of hex before signing
  // const uppercaseHash = convertToUpperCaseHash(toHex(hash));
  const sig = await client.signMessage(hash);
  return {
    requestHash: utils.message.hashMessage(hash) as Hex,
    signature: toBytes(sig),
  };
};

// const convertToUpperCaseHash = (input: Hex) => {
//   return `0x${input.substring(2).toUpperCase()}`;
// };

const convertGasToToken = (
  token: {
    contractAddress: Hex;
    decimals: number;
  },
  oraclePrices: OraclePriceResponse,
  destinationChainID: number,
  destinationUniverse: Universe,
  gas: Decimal
) => {
  if (gas.isZero() || isNativeAddress(destinationUniverse, token.contractAddress)) {
    return gas;
  }

  const gasTokenInUSD =
    oraclePrices
      .find(
        (rate) => rate.chainId === destinationChainID && equalFold(rate.tokenAddress, ZERO_ADDRESS)
      )
      ?.priceUsd.toFixed() ?? '0';

  const transferTokenInUSD = oraclePrices
    .find(
      (rate) =>
        rate.chainId === destinationChainID && equalFold(rate.tokenAddress, token.contractAddress)
    )
    ?.priceUsd.toFixed();

  if (!transferTokenInUSD) {
    throw Errors.internal('could not find token in price oracle');
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
  cosmosQueryClient: CosmosQueryClient
) => {
  const ac = new AbortController();
  await Promise.race([
    waitForIntentFulfilment(publicClient, vaultContractAddress, requestHash, ac),
    requestTimeout(3, ac),
    cosmosFillCheck(intentID, cosmosQueryClient, ac),
  ]);
};

const convertTo32Bytes = (value: bigint | Hex | number | Bytes) => {
  if (typeof value === 'bigint' || typeof value === 'number') {
    return toBytes(value, {
      size: 32,
    });
  } else if (typeof value === 'string') {
    return pad(toBytes(value), {
      dir: 'left',
      size: 32,
    });
  } else {
    return pad(value, {
      dir: 'left',
      size: 32,
    });
  }
};

const convertTo32BytesHex = (value: Hex | Bytes) => {
  const bytes = convertTo32Bytes(value);
  return toHex(bytes);
};

const convertToHexAddressByUniverse = (address: Uint8Array, universe: Universe) => {
  if (universe === Universe.ETHEREUM || universe === Universe.TRON) {
    if (address.length === 20) {
      return bytesToHex(address);
    } else if (address.length === 32) {
      if (!address.subarray(0, 12).every((b) => b === 0)) {
        throw Errors.invalidAddressLength('evm', 'non-zero-padded 32-byte address');
      }
      return bytesToHex(address.subarray(12));
    } else {
      throw Errors.invalidAddressLength('evm');
    }
  } else {
    throw Errors.universeNotSupported();
  }
};

const createDepositDoubleCheckTx = (chainID: Uint8Array, cosmos: CosmosOptions, intentID: Long) => {
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
      client: cosmos.client,
      msg,
    });
  };
};

class UserAsset {
  get balance() {
    return this.value.balance;
  }

  constructor(public value: UserAssetDatum) {}

  getBridgeAssets(dstChainId: number) {
    return this.value.breakdown
      .filter((b) => b.chain.id !== dstChainId)
      .map((b) => {
        return {
          chainID: b.chain.id,
          contractAddress: b.contractAddress,
          decimals: b.decimals,
          balance: new Decimal(b.balance),
        };
      });
  }

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

    return false;
  }

  async iterate(chainList: ChainListType) {
    const values = this.value.breakdown
      .filter((b) => new Decimal(b.balance).gt(0))
      .sort((a, b) => {
        if (a.chain.id === 1) {
          return 1;
        }
        if (b.chain.id === 1) {
          return -1;
        }
        return Decimal.sub(b.balance, a.balance).toNumber();
      });

    const balances = [];

    for (const b of values) {
      let balance = new Decimal(b.balance);
      if (this.isDeposit(b.contractAddress, b.universe)) {
        const ESTIMATED_DEPOSIT_GAS = 200_000n;

        const chain = chainList.getChainByID(b.chain.id);
        if (!chain) {
          throw Errors.chainNotFound(b.chain.id);
        }

        const publicClient = createPublicClientWithFallback(chain);
        const gasEstimate = await publicClient.estimateFeesPerGas();
        const gasUnitPrice = gasEstimate.maxFeePerGas ?? gasEstimate.gasPrice;

        const estimatedGasForDeposit = divDecimals(
          ESTIMATED_DEPOSIT_GAS * gasUnitPrice,
          chain.nativeCurrency.decimals
        );

        if (new Decimal(b.balance).lessThan(estimatedGasForDeposit)) {
          balance = new Decimal(0);
        } else {
          balance = new Decimal(b.balance).minus(estimatedGasForDeposit);
        }
      }

      balances.push({
        balance,
        chainID: b.chain.id,
        decimals: b.decimals,
        tokenContract: b.contractAddress,
        universe: b.universe,
      });
    }

    return balances;
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
    throw Errors.tokenNotSupported();
  }

  findOnChain(chainID: number, address: `0x${string}`) {
    return this.data.find((asset) => {
      const index = asset.breakdown.findIndex(
        (b) => b.chain.id === chainID && equalFold(b.contractAddress, address)
      );
      if (index > -1) {
        return asset;
      }
      return null;
    });
  }

  getAssetDetails(chain: Chain, address: `0x${string}`) {
    const asset = this.findOnChain(chain.id, address);

    getLogger().debug('getAssetDetails', {
      asset,
      assets: this.data,
    });

    const destinationGasBalance = this.getNativeBalance(chain);
    const chainsWithBalance = this.getChainCountWithBalance(asset);
    const destinationAssetBalance =
      asset?.breakdown.find((b) => b.chain.id === chain.id)?.balance ?? '0';
    return {
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
    for (const asset of this.data) {
      asset.breakdown.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
    }
    this.data.sort((a, b) => b.balanceInFiat - a.balanceInFiat);
  }

  [Symbol.iterator]() {
    return this.data.values();
  }
}

async function waitForTronDepositTxConfirmation(
  hash: Hex,
  vaultContractAddress: Hex,
  tronWeb: TronWeb,
  owner: Hex,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 120000, interval = 3000 } = options;

  const startTime = Date.now();

  logger.debug('Waiting for confirmation of tron tx');

  const input = encodeFunctionData({
    abi: EVMVaultABI,
    functionName: 'requestState',
    args: [hash],
  });
  while (Date.now() - startTime < timeout) {
    try {
      const result = await tronWeb.transactionBuilder.triggerConstantContract(
        tronWeb.utils.address.fromHex(vaultContractAddress),
        '',
        {
          input,
        },
        [],
        tronWeb.utils.address.fromHex(owner)
      );

      logger.debug('requestHashWitnessedOnTron', {
        result,
      });
      if (result.Error) {
        throw Errors.internal(result.Error);
      }

      const requestState = bytesToNumber(result.constant_result[0]);
      if (requestState === 0) {
        throw Errors.internal('Request not witnessed yet.');
      }

      return;
    } catch (err) {
      logger.error('Error while checking transaction:', err, {
        cause: 'TRANSACTION_CHECK_ERROR',
      });
      // Don’t throw yet; continue polling
    }

    logger.debug('⏳ Still waiting...');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw Errors.transactionTimeout(timeout / 1000);
}

function pctAdditionToBigInt(base: bigint, percentage: number) {
  return base + BigInt(new Decimal(base).mul(percentage).toFixed(0));
}

function divideBigInt(base: bigint, divisor: number) {
  if (base === 0n) {
    return base;
  }

  return BigInt(new Decimal(base).div(divisor).toFixed(0));
}

async function waitForTronApprovalTxConfirmation(
  amount: bigint,
  owner: Hex,
  spender: Hex,
  contractAddress: Hex,
  tronWeb: TronWeb,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 120000, interval = 3000 } = options;

  const startTime = Date.now();

  logger.debug('Waiting for confirmation of tron approval tx');

  const input = encodeFunctionData({
    abi: ERC20ABI,
    functionName: 'allowance',
    args: [owner, spender],
  });

  while (Date.now() - startTime < timeout) {
    try {
      const result = await tronWeb.transactionBuilder.triggerConstantContract(
        tronWeb.utils.address.fromHex(contractAddress),
        '',
        {
          input,
        },
        [],
        tronWeb.utils.address.fromHex(owner)
      );

      logger.debug('waitForTronApprovalTxConfirmation', {
        result,
      });

      if (result.Error) {
        throw Errors.internal(result.Error);
      }

      const allowance = hexToBigInt(`0x${result.constant_result[0]}`);
      if (allowance < amount) {
        throw Errors.internal('Allowance not set yet.');
      }

      return;
    } catch (err) {
      logger.error('Error while checking transaction', err, {
        cause: 'TRANSACTION_CHECK_ERROR',
      });
      // Don’t throw yet; continue polling
    }

    logger.debug('⏳ Still waiting...');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw Errors.transactionTimeout(timeout / 1000);
}

const createExplorerTxURL = (txHash: Hex, explorerURL: string) => {
  return new URL(`/tx/${txHash}`, explorerURL).href;
};

const retrieveAddress = (universe: Universe, input: Pick<IBridgeOptions, 'evm' | 'tron'>): Hex => {
  if (universe === Universe.ETHEREUM) {
    return input.evm.address;
  } else if (universe === Universe.TRON) {
    if (!input.tron) {
      throw Errors.internal('tron source but no tron input');
    }

    return input.tron.address as Hex;
  }

  throw Errors.internal('unknown universe');
};

const SIWE_KEY = '_siwe_sig';

const storeSIWESignatureToLocalStorage = (address: Hex, siweChain: number, signature: string) => {
  PlatformUtils.storageSetItem(`${SIWE_KEY}-${address}-${siweChain}`, signature);
};

const retrieveSIWESignatureFromLocalStorage = (address: Hex, siweChain: number) => {
  return PlatformUtils.storageGetItem(`${SIWE_KEY}-${address}-${siweChain}`);
};

const createDeadlineFromNow = (minutes = 3n): bigint => {
  const nowInSeconds = BigInt(Math.floor(Date.now() / 1000));
  return nowInSeconds + minutes * 60n;
};

export {
  divideBigInt,
  createDeadlineFromNow,
  pctAdditionToBigInt,
  retrieveSIWESignatureFromLocalStorage,
  storeSIWESignatureToLocalStorage,
  retrieveAddress,
  createExplorerTxURL,
  waitForTronApprovalTxConfirmation,
  waitForTronDepositTxConfirmation,
  UserAsset,
  UserAssets,
  convertAddressByUniverse,
  convertGasToToken,
  convertIntent,
  convertTo32Bytes,
  convertTo32BytesHex,
  convertToHexAddressByUniverse,
  createDepositDoubleCheckTx,
  createRequestEVMSignature,
  divDecimals,
  equalFold,
  evmWaitForFill,
  getExpiredIntents,
  getExplorerURL,
  getSupportedChains,
  hexTo0xString,
  minutesToMs,
  mulDecimals,
  refundExpiredIntents,
  removeIntentHashFromStore,
  storeIntentHashToStore,
  createRequestTronSignature,
};
