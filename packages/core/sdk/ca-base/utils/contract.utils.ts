import {
  ChaindataMap,
  Currency,
  OmniversalChainID,
  PermitCreationError,
  PermitVariant,
  Universe,
} from '@arcana/ca-common';
import { ERC20ABI as ERC20ABIC } from '@arcana/ca-common';
import { CHAIN_IDS } from 'fuels';
import {
  Account,
  Address,
  bytesToHex,
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  fallback,
  getContract,
  Hex,
  hexToBigInt,
  hexToBytes,
  http,
  JsonRpcAccount,
  maxUint256,
  pad,
  parseSignature,
  PublicClient,
  SwitchChainError,
  WalletClient,
  WebSocketTransport,
} from 'viem';

import ERC20ABI from '../abi/erc20';
import gasOracleABI from '../abi/gasOracle';
import { FillEvent } from '../abi/vault';
import { ChainList } from './common.utils';
import { ZERO_ADDRESS } from '../constants';
import { ErrorLiquidityTimeout } from '../errors';
import { getLogger } from '../logger';
import {
  Chain,
  ChainListType,
  EVMTransaction,
  NetworkConfig,
  SponsoredApprovalData,
} from '@nexus/commons';
import { vscCreateSponsoredApprovals } from './api.utils';
import { convertTo32Bytes, equalFold, minutesToMs } from './common.utils';

const logger = getLogger();

const isEVMTx = (tx: unknown): tx is EVMTransaction => {
  logger.debug('isEVMTx', tx);
  if (typeof tx !== 'object') {
    return false;
  }
  if (!tx) {
    return false;
  }
  if (!('to' in tx)) {
    return false;
  }
  if (!('data' in tx || 'value' in tx)) {
    return false;
  }
  return true;
};

const getAllowance = (
  chain: Chain,
  address: `0x${string}`,
  tokenContract: `0x${string}`,
  chainList: ChainListType,
) => {
  logger.debug('getAllowance', {
    tokenContract,
    ZERO_ADDRESS,
  });

  if (equalFold(ZERO_ADDRESS, tokenContract)) {
    return Promise.resolve(maxUint256);
  }

  const publicClient = createPublicClientWithFallback(chain);

  return publicClient.readContract({
    abi: ERC20ABI,
    address: tokenContract,
    args: [address, chainList.getVaultContractAddress(chain.id)],
    functionName: 'allowance',
  });
};

const getAllowances = async (
  input: {
    chainID: number;
    tokenContract: `0x${string}`;
  }[],
  address: `0x${string}`,
  chainList: ChainListType,
) => {
  const values: { [k: number]: bigint } = {};
  const promises = [];
  for (const i of input) {
    if (i.chainID === CHAIN_IDS.fuel.mainnet) {
      promises.push(Promise.resolve(0n));
    } else {
      const chain = chainList.getChainByID(i.chainID);
      if (!chain) {
        throw new Error('chain not found');
      }
      promises.push(getAllowance(chain, address, i.tokenContract, chainList));
    }
  }
  const result = await Promise.all(promises);
  for (const i in result) {
    values[input[i].chainID] = result[i];
  }

  return values;
};

const waitForIntentFulfilment = async (
  publicClient: PublicClient<WebSocketTransport>,
  vaultContractAddr: `0x${string}`,
  requestHash: `0x${string}`,
  ac: AbortController,
) => {
  return new Promise((resolve) => {
    const unwatch = publicClient.watchContractEvent({
      abi: [FillEvent] as const,
      address: vaultContractAddr,
      args: { requestHash },
      eventName: 'Fill',
      onLogs: (logs) => {
        logger.debug('waitForIntentFulfilment', { logs });
        ac.abort();
        return resolve('ok');
      },
      poll: false,
    });
    ac.signal.addEventListener(
      'abort',
      () => {
        unwatch();
        return resolve('ok from outside');
      },
      { once: true },
    );
  });
};

const requestTimeout = (timeout: number, ac: AbortController) => {
  return new Promise((_, reject) => {
    const t = window.setTimeout(() => {
      ac.abort();
      return reject(ErrorLiquidityTimeout);
    }, minutesToMs(timeout));
    ac.signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t);
      },
      { once: true },
    );
  });
};

const getTokenTxFunction = (data: `0x${string}`) => {
  try {
    const { args, functionName } = decodeFunctionData({
      abi: ERC20ABI,
      data,
    });
    return { args, functionName };
  } catch (e) {
    logger.debug('getTokenTxFunction', e);
    return { args: [], functionName: 'unknown' };
  }
};

const setAllowances = async (
  tokenContractAddresses: Array<`0x${string}`>,
  client: WalletClient,
  networkConfig: NetworkConfig,
  chainList: ChainList,
  chain: Chain,
  amount: bigint,
) => {
  const vaultAddr = chainList.getVaultContractAddress(chain.id);
  const p = [];
  const address = (await client.getAddresses())[0];

  const chainId = new OmniversalChainID(Universe.ETHEREUM, chain.id);
  const chainDatum = ChaindataMap.get(chainId);
  if (!chainDatum) {
    throw new Error('Chain data not found');
  }

  const account: JsonRpcAccount = {
    address,
    type: 'json-rpc',
  };
  const publicClient = createPublicClientWithFallback(chain);

  const sponsoredApprovalParams: SponsoredApprovalData = {
    address: hexToBytes(
      pad(address, {
        dir: 'left',
        size: 32,
      }),
    ),
    chain_id: chainDatum.ChainID32,
    operations: [],
    universe: chainDatum.Universe,
  };

  for (const addr of tokenContractAddresses) {
    const currency = chainDatum.CurrencyMap.get(convertTo32Bytes(addr));
    if (!currency) {
      throw new Error('Currency not found');
    }

    if (currency.permitVariant === PermitVariant.Unsupported) {
      const hash = await client.writeContract({
        abi: ERC20ABI,
        account: address,
        address: addr,
        args: [vaultAddr, amount],
        chain,
        functionName: 'approve',
      });
      p.push(
        (async function () {
          const result = await publicClient.waitForTransactionReceipt({
            confirmations: 2,
            hash,
          });
          if (result.status === 'reverted') {
            throw new Error('setAllowance failed with tx revert');
          }
        })(),
      );
    } else {
      const signed = parseSignature(
        await signPermitForAddressAndValue(
          currency,
          client,
          publicClient,
          account,
          vaultAddr,
          amount,
        ),
      );
      sponsoredApprovalParams.operations.push({
        sig_r: hexToBytes(signed.r),
        sig_s: hexToBytes(signed.s),
        sig_v: signed.yParity < 27 ? signed.yParity + 27 : signed.yParity,
        token_address: currency.tokenAddress,
        value: convertTo32Bytes(amount),
        variant: currency.permitVariant === PermitVariant.PolygonEMT ? 2 : 1,
      });
    }
  }

  if (p.length) {
    await Promise.all(p);
  }

  if (sponsoredApprovalParams.operations.length) {
    await vscCreateSponsoredApprovals(networkConfig.VSC_DOMAIN, [sponsoredApprovalParams]);
  }

  return;
};

const DEFAULT_GAS_ORACLE_ADDRESS = '0x420000000000000000000000000000000000000F';

const L1_GAS_ORACLES: Record<number, `0x${string}`> = {
  10: DEFAULT_GAS_ORACLE_ADDRESS,
  11155420: DEFAULT_GAS_ORACLE_ADDRESS,
  534352: '0x5300000000000000000000000000000000000002',
  8453: DEFAULT_GAS_ORACLE_ADDRESS,
  84532: DEFAULT_GAS_ORACLE_ADDRESS,
} as const;

const chainsWithGasOracles = Object.keys(L1_GAS_ORACLES).map(Number);

const getL1Fee = async (chain: Chain, input: `0x${string}` = '0x') => {
  let fee = 0n;
  if (chainsWithGasOracles.includes(chain.id)) {
    fee = await fetchL1Fee(chain, input);
  }

  return fee;
};

const fetchL1Fee = (chain: Chain, input: `0x${string}`) => {
  const pc = createPublicClientWithFallback(chain);

  return pc.readContract({
    abi: gasOracleABI,
    address: L1_GAS_ORACLES[chain.id],
    args: [input],
    functionName: 'getL1Fee',
  });
};

const waitForTxReceipt = async (
  hash: `0x${string}`,
  publicClient: PublicClient,
  confirmations = 2,
) => {
  const r = await publicClient.waitForTransactionReceipt({
    confirmations,
    hash,
  });
  if (r.status === 'reverted') {
    throw new Error(`Transaction reverted: ${hash}`);
  }
};

const switchChain = async (client: WalletClient, chain: Chain) => {
  try {
    await client.switchChain({ id: chain.id });
  } catch (e) {
    if (e instanceof SwitchChainError && e.code === SwitchChainError.code) {
      await client.addChain({
        chain,
      });
      await client.switchChain({ id: chain.id });
      return;
    }
    throw e;
  }
};

const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const;

const PolygonDomain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
] as const;

async function signPermitForAddressAndValue(
  cur: Currency,
  client: WalletClient,
  publicClient: PublicClient,
  account: Account,
  spender: Address,
  value: bigint,
  deadline?: bigint,
) {
  const contract = getContract({
    abi: ERC20ABIC,
    address: bytesToHex(cur.tokenAddress.subarray(12)),
    client: { public: publicClient },
  });

  const walletAddress = account.address;
  deadline = deadline ?? 2n ** 256n - 1n;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestsToBeMade: Promise<any>[] = [
    (() => {
      // Hack for sophon ETH
      return contract.read.name().catch(() => {
        return '';
      });
    })(),
    client.request({ method: 'eth_chainId' }, { dedupe: true }),
  ];

  switch (cur.permitVariant) {
    case PermitVariant.Unsupported:
    default: {
      throw new PermitCreationError('Permits are unsupported on this currency');
    }
    case PermitVariant.DAI:
    case PermitVariant.EIP2612Canonical:
    case PermitVariant.Polygon2612: {
      requestsToBeMade[2] = contract.read.nonces([walletAddress]);
      break;
    }
    case PermitVariant.PolygonEMT: {
      requestsToBeMade[2] = contract.read.getNonce([walletAddress]);
    }
  }

  const [name, chainID, nonce] = await Promise.all(
    requestsToBeMade as [Promise<string>, Promise<Hex>, Promise<bigint>],
  );

  switch (cur.permitVariant) {
    case PermitVariant.DAI: {
      return client.signTypedData({
        account,
        domain: {
          chainId: hexToBigInt(chainID),
          name,
          verifyingContract: contract.address,
          version: cur.permitContractVersion.toString(10),
        },
        message: {
          allowed: true,
          expiry: deadline,
          holder: walletAddress,
          nonce,
          spender: spender,
        },
        primaryType: 'Permit',
        types: {
          EIP712Domain,
          Permit: [
            { name: 'holder', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
            { name: 'allowed', type: 'bool' },
          ],
        },
      });
    }
    case PermitVariant.EIP2612Canonical: {
      return client.signTypedData({
        account,
        domain: {
          chainId: hexToBigInt(chainID),
          name,
          verifyingContract: contract.address,
          version: cur.permitContractVersion.toString(10),
        },
        message: {
          deadline,
          nonce,
          owner: walletAddress,
          spender,
          value,
        },
        primaryType: 'Permit',
        types: {
          EIP712Domain,
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
      });
    }
    case PermitVariant.Polygon2612: {
      return client.signTypedData({
        account,
        domain: {
          name,
          salt: pad(chainID, {
            dir: 'left',
            size: 32,
          }),
          verifyingContract: contract.address,
          version: cur.permitContractVersion.toString(10),
        },
        message: {
          allowed: true,
          expiry: deadline,
          holder: walletAddress,
          nonce,
          spender: spender,
        },
        primaryType: 'Permit',
        types: {
          EIP712Domain: PolygonDomain,
          Permit: [
            { name: 'holder', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
            { name: 'allowed', type: 'bool' },
          ],
        },
      });
    }
    case PermitVariant.PolygonEMT: {
      const funcSig = encodeFunctionData({
        abi: ERC20ABI,
        args: [spender, value],
        functionName: 'approve',
      });
      return client.signTypedData({
        account,
        domain: {
          name,
          salt: pad(chainID, {
            dir: 'left',
            size: 32,
          }),
          verifyingContract: contract.address,
          version: cur.permitContractVersion.toString(10),
        },
        message: {
          from: walletAddress,
          functionSignature: funcSig,
          nonce,
        },
        primaryType: 'MetaTransaction',
        types: {
          EIP712Domain: PolygonDomain,
          MetaTransaction: [
            { name: 'nonce', type: 'uint256' },
            { name: 'from', type: 'address' },
            { name: 'functionSignature', type: 'bytes' },
          ],
        },
      });
    }
  }
}

const createPublicClientWithFallback = (chain: Chain): PublicClient => {
  if (chain.rpcUrls.default.http.length === 1) {
    return createPublicClient({
      transport: http(chain.rpcUrls.default.http[0]),
    });
  }
  return createPublicClient({
    transport: fallback(chain.rpcUrls.default.http.map((s) => http(s))),
  });
};

export {
  createPublicClientWithFallback,
  getAllowance,
  getAllowances,
  getL1Fee,
  getTokenTxFunction,
  isEVMTx,
  requestTimeout,
  setAllowances,
  signPermitForAddressAndValue,
  switchChain,
  waitForIntentFulfilment,
  waitForTxReceipt,
};
