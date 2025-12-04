import { Currency, PermitCreationError, PermitVariant } from '@avail-project/ca-common';
import { ERC20ABI as ERC20ABIC } from '@avail-project/ca-common';
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
  http,
  maxUint256,
  pad,
  PublicClient,
  WalletClient,
  WebSocketTransport,
} from 'viem';
import ERC20ABI from '../abi/erc20';
import gasOracleABI from '../abi/gasOracle';
import { FillEvent } from '../abi/vault';
import { ZERO_ADDRESS } from '../constants';
import { Errors } from '../errors';
import { getLogger } from '../../../commons';
import { ChainListType, Chain, GetAllowanceParams, SetAllowanceParams } from '../../../commons';
import { equalFold, minutesToMs } from './common.utils';
import { PlatformUtils } from './platform.utils';

const logger = getLogger();

const getAllowance = async (
  chain: Chain,
  address: `0x${string}`,
  tokenContract: `0x${string}`,
  chainList: ChainListType,
) => {
  logger.debug('getAllowance', {
    tokenContract,
    ZERO_ADDRESS,
    chain,
    address,
  });

  if (equalFold(ZERO_ADDRESS, tokenContract)) {
    return Promise.resolve(maxUint256);
  }

  const publicClient = createPublicClientWithFallback(chain);

  try {
    const allowance = erc20GetAllowance(
      {
        contractAddress: tokenContract,
        spender: chainList.getVaultContractAddress(chain.id),
        owner: address,
      },
      publicClient,
    );
    return allowance;
  } catch {
    return 0n;
  }
};

const erc20GetAllowance = (params: GetAllowanceParams, client: PublicClient) => {
  return client.readContract({
    address: params.contractAddress,
    abi: ERC20ABI,
    functionName: 'allowance',
    args: [params.owner, params.spender],
  });
};

const erc20SetAllowance = (params: SetAllowanceParams & { chain: Chain }, client: WalletClient) => {
  return client.writeContract({
    address: params.contractAddress,
    abi: ERC20ABI,
    functionName: 'approve',
    args: [params.spender, params.amount],
    chain: params.chain,
    account: params.owner,
  });
};

const getAllowances = async (
  input: {
    chainID: number;
    tokenContract: `0x${string}`;
    holderAddress: `0x${string}`;
  }[],
  chainList: ChainListType,
) => {
  const values: { [k: number]: bigint } = {};
  const promises = [];
  for (const i of input) {
    const chain = chainList.getChainByID(i.chainID);
    if (!chain) {
      throw Errors.chainNotFound(i.chainID);
    }
    promises.push(getAllowance(chain, i.holderAddress, i.tokenContract, chainList));
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
      eventName: 'Fulfilment',
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
        logger.debug('waitForIntentFulfilment: got abort, going to unwatch');
        unwatch();
        return resolve('ok from outside');
      },
      { once: true },
    );
  });
};

const requestTimeout = (timeout: number, ac: AbortController) => {
  return new Promise((_, reject) => {
    const t = setTimeout(() => {
      ac.abort();
      return reject(Errors.liquidityTimeout());
    }, minutesToMs(timeout));

    ac.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
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
  confirmations = 1,
  timeout = 60000,
) => {
  const r = await publicClient.waitForTransactionReceipt({
    confirmations,
    hash,
    timeout,
  });
  if (r.status === 'reverted') {
    throw Errors.transactionReverted(hash);
  }

  return r;
};

const switchChain = async (client: WalletClient, chain: Chain) => {
  const current = await client.getChainId();
  if (current === chain.id) return;

  try {
    await client.switchChain({ id: chain.id });
  } catch (outerErr) {
    logger.error(`switchChain failed, trying addChain`, outerErr);
    try {
      await client.addChain({ chain });
      await client.switchChain({ id: chain.id });
    } catch (inner) {
      logger.error('Unable to add/switch chain', inner);
      throw inner;
    }
  }

  const after = await client.getChainId();
  if (after !== chain.id) {
    logger.error(`Wallet did not switch chains even though no error was thrown`);
    throw Errors.internal('wallet did not switch chain - no error thrown');
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
    client.request({ method: 'eth_chainId' }),
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
  return createPublicClient({
    transport: fallback(
      chain.rpcUrls.default.http.concat(chain.rpcUrls.default.publicHttp ?? []).map((s) => http(s)),
    ),
  });
};

const getPctGasBufferByChain = (_: number) => {
  // if (chainId === TESTNET_CHAIN_IDS.MONAD_TESTNET || chainId === MAINNET_CHAIN_IDS.MONAD) {
  //   return 0.05;
  // }

  return 0.3;
};

export {
  getPctGasBufferByChain,
  erc20GetAllowance,
  erc20SetAllowance,
  createPublicClientWithFallback,
  getAllowance,
  getAllowances,
  getL1Fee,
  getTokenTxFunction,
  requestTimeout,
  signPermitForAddressAndValue,
  switchChain,
  waitForIntentFulfilment,
  waitForTxReceipt,
};
