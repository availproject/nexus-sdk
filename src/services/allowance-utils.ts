import {
  type Account,
  type Address,
  encodeFunctionData,
  getContract,
  maxUint256,
  type PublicClient,
  pad,
  toHex,
  type WalletClient,
} from 'viem';
import ERC20ABI from '../abi/erc20';
import type { Chain, ChainListType, GetAllowanceParams } from '../domain';
import { getLogger, ZERO_ADDRESS } from '../domain';
import { ERROR_CODES, Errors, ExecutionError, formatUnknownError } from '../domain/errors';
import { PermitCreationError, type PermitCurrency, PermitVariant } from '../domain/permits';
import { createPublicClientWithFallback, switchChain } from './evm';
import { isUserRejectedRequest } from './is-user-rejected-request';
import { equalFold } from './strings';

const logger = getLogger();

export const buildAllowanceKey = (
  chainID: number,
  tokenContract: `0x${string}`,
  holderAddress: `0x${string}`
) => `${chainID}:${tokenContract.toLowerCase()}:${holderAddress.toLowerCase()}`;

// All wrapped calls in this module are RPC reads (allowance, nonces, name).
// Permit signing failures live below and use `Errors.execution(..., { service: 'wallet' })` directly.
const wrapExternal = async <T>(
  message: string,
  code: 'erc20_allowance' | 'erc20_nonce' | 'erc20_name',
  details: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    const specificCode =
      code === 'erc20_allowance'
        ? ERROR_CODES.EXEC_ERC20_ALLOWANCE_READ_FAILED
        : code === 'erc20_nonce'
          ? ERROR_CODES.EXEC_ERC20_NONCE_READ_FAILED
          : ERROR_CODES.EXEC_ERC20_NAME_READ_FAILED;
    throw new ExecutionError(specificCode, `${message}: ${formatUnknownError(error)}`, {
      context: { service: 'rpc' },
      details,
    });
  }
};

const getAllowance = async (
  chain: Chain,
  address: `0x${string}`,
  tokenContract: `0x${string}`,
  chainList: ChainListType
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
      publicClient
    );
    return allowance;
  } catch (error) {
    logger.error(
      'getAllowance failed',
      new ExecutionError(
        ERROR_CODES.EXEC_ERC20_ALLOWANCE_READ_FAILED,
        `Failed to read allowance: ${formatUnknownError(error)}`,
        {
          context: { service: 'rpc', chainId: chain.id },
          details: { tokenContract },
        }
      )
    );
    return 0n;
  }
};

export const erc20GetAllowance = (params: GetAllowanceParams, client: PublicClient) => {
  return wrapExternal(
    'Failed to read allowance',
    'erc20_allowance',
    {
      contractAddress: params.contractAddress,
      owner: params.owner,
      spender: params.spender,
    },
    () =>
      client.readContract({
        address: params.contractAddress,
        abi: ERC20ABI,
        functionName: 'allowance',
        args: [params.owner, params.spender],
      })
  );
};

export const getAllowances = async (
  input: {
    chainID: number;
    tokenContract: `0x${string}`;
    holderAddress: `0x${string}`;
  }[],
  chainList: ChainListType
) => {
  const values: Record<string, bigint> = {};
  const promises = [];
  for (const i of input) {
    const chain = chainList.getChainByID(i.chainID);
    promises.push(getAllowance(chain, i.holderAddress, i.tokenContract, chainList));
  }
  const result = await Promise.all(promises);
  for (const i in result) {
    values[buildAllowanceKey(input[i].chainID, input[i].tokenContract, input[i].holderAddress)] =
      result[i];
  }

  return values;
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

export async function signPermitForAddressAndValue(
  cur: PermitCurrency,
  chain: Chain,
  client: WalletClient,
  publicClient: PublicClient,
  account: Account,
  spender: Address,
  value: bigint,
  ddl?: bigint
) {
  await switchChain(client, chain);

  const contract = getContract({
    abi: ERC20ABI,
    address: cur.tokenAddress,
    client: { public: publicClient },
  });

  const walletAddress = account.address;
  const deadline = ddl ?? 2n ** 256n - 1n;

  const tokenNameRequest = contract.read.name().catch(() => {
    logger.error(
      'signPermit:failed to read token name',
      new ExecutionError(ERROR_CODES.EXEC_ERC20_NAME_READ_FAILED, 'Failed to read token name', {
        context: { service: 'rpc' },
        details: { tokenAddress: cur.tokenAddress },
      })
    );
    return '';
  });
  let nonceRequest: Promise<bigint>;

  switch (cur.permitVariant) {
    case PermitVariant.DAI:
    case PermitVariant.EIP2612Canonical:
    case PermitVariant.Polygon2612: {
      nonceRequest = wrapExternal(
        'Failed to read permit nonce',
        'erc20_nonce',
        { tokenAddress: cur.tokenAddress, permitVariant: cur.permitVariant },
        () => contract.read.nonces([walletAddress])
      );
      break;
    }
    case PermitVariant.PolygonEMT: {
      nonceRequest = wrapExternal(
        'Failed to read permit nonce',
        'erc20_nonce',
        { tokenAddress: cur.tokenAddress, permitVariant: cur.permitVariant },
        () => contract.read.getNonce([walletAddress])
      );
      break;
    }
    default: {
      throw new PermitCreationError('Permits are unsupported on this currency');
    }
  }

  const [name, nonce] = await Promise.all([tokenNameRequest, nonceRequest]);
  const polygonDomainSalt = pad(toHex(chain.id), {
    dir: 'left',
    size: 32,
  });

  switch (cur.permitVariant) {
    case PermitVariant.DAI: {
      try {
        return await client.signTypedData({
          account,
          domain: {
            chainId: BigInt(chain.id),
            name,
            verifyingContract: contract.address,
            version: cur.permitContractVersion.toString(10),
          },
          types: {
            Permit: [
              { name: 'holder', type: 'address' },
              { name: 'spender', type: 'address' },
              { name: 'nonce', type: 'uint256' },
              { name: 'expiry', type: 'uint256' },
              { name: 'allowed', type: 'bool' },
            ],
            EIP712Domain,
          },
          primaryType: 'Permit',
          message: {
            holder: walletAddress,
            spender,
            nonce,
            expiry: deadline,
            allowed: true,
          },
        });
      } catch (error) {
        if (isUserRejectedRequest(error)) {
          throw Errors.userRejectedAllowance();
        }
        throw Errors.execution(`Failed to sign permit: ${formatUnknownError(error)}`, {
          service: 'wallet',
          details: {
            tokenAddress: cur.tokenAddress,
            permitVariant: cur.permitVariant,
          },
        });
      }
    }
    case PermitVariant.EIP2612Canonical: {
      try {
        return await client.signTypedData({
          account,
          domain: {
            chainId: BigInt(chain.id),
            name,
            verifyingContract: contract.address,
            version: cur.permitContractVersion.toString(10),
          },
          types: {
            Permit: [
              { name: 'owner', type: 'address' },
              { name: 'spender', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
            ],
            EIP712Domain,
          },
          primaryType: 'Permit',
          message: {
            owner: walletAddress,
            spender,
            value,
            nonce,
            deadline,
          },
        });
      } catch (error) {
        if (isUserRejectedRequest(error)) {
          throw Errors.userRejectedAllowance();
        }
        throw Errors.execution(`Failed to sign permit: ${formatUnknownError(error)}`, {
          service: 'wallet',
          details: {
            tokenAddress: cur.tokenAddress,
            permitVariant: cur.permitVariant,
          },
        });
      }
    }
    case PermitVariant.Polygon2612: {
      try {
        return await client.signTypedData({
          account,
          domain: {
            name,
            salt: polygonDomainSalt,
            verifyingContract: contract.address,
            version: cur.permitContractVersion.toString(10),
          },
          message: {
            allowed: true,
            expiry: deadline,
            holder: walletAddress,
            nonce,
            spender,
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
      } catch (error) {
        if (isUserRejectedRequest(error)) {
          throw Errors.userRejectedAllowance();
        }
        throw Errors.execution(`Failed to sign permit: ${formatUnknownError(error)}`, {
          service: 'wallet',
          details: {
            tokenAddress: cur.tokenAddress,
            permitVariant: cur.permitVariant,
          },
        });
      }
    }
    case PermitVariant.PolygonEMT: {
      const funcSig = encodeFunctionData({
        abi: ERC20ABI,
        args: [spender, value],
        functionName: 'approve',
      });
      try {
        return await client.signTypedData({
          account,
          domain: {
            name,
            salt: polygonDomainSalt,
            verifyingContract: contract.address,
            version: cur.permitContractVersion.toString(10),
          },
          types: {
            EIP712Domain: PolygonDomain,
            MetaTransaction: [
              { name: 'nonce', type: 'uint256' },
              { name: 'from', type: 'address' },
              { name: 'functionSignature', type: 'bytes' },
            ],
          },
          primaryType: 'MetaTransaction',
          message: {
            from: walletAddress,
            functionSignature: funcSig,
            nonce,
          },
        });
      } catch (error) {
        if (isUserRejectedRequest(error)) {
          throw Errors.userRejectedAllowance();
        }
        throw Errors.execution(`Failed to sign permit: ${formatUnknownError(error)}`, {
          service: 'wallet',
          details: {
            tokenAddress: cur.tokenAddress,
            permitVariant: cur.permitVariant,
          },
        });
      }
    }
    default: {
      throw new PermitCreationError('Permits are unsupported on this currency');
    }
  }
}
