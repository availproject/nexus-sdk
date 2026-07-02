import {
  type Account,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  type PublicClient,
  parseSignature,
  type WalletClient,
} from 'viem';
import { ERC20PermitABI } from '../../abi/erc20';
import { type Chain, getLogger } from '../../domain';
import { PermitVariant } from '../../domain/permits';
import { signPermitForAddressAndValue } from '../../services/allowance-utils';
import type { PreparedAuthorizationCall, PublicClientList } from '../types';
import type { SwapCache } from './cache';

const logger = getLogger();

const DAI_PERMIT_ABI = [
  {
    type: 'function',
    name: 'permit',
    inputs: [
      { name: 'holder', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'allowed', type: 'bool' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const NONCES_ABI = [
  {
    type: 'function',
    name: 'nonces',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const getSignatureV = (signature: { v?: bigint | number; yParity?: bigint | number }) => {
  const recoveryId =
    signature.v ?? (signature.yParity != null ? Number(signature.yParity) + 27 : undefined);
  if (recoveryId == null) {
    throw new Error('Permit signature missing recovery id');
  }

  const signatureV = Number(recoveryId);
  if (!Number.isInteger(signatureV)) {
    throw new Error('Permit signature missing recovery id');
  }

  return signatureV;
};

const buildPermitCall = async (input: {
  chain: Chain;
  tokenAddress: Hex;
  tokenDecimals: number;
  amount: bigint;
  eoaAddress: Hex;
  eoaWallet: WalletClient;
  ephemeralAddress: Hex;
  publicClient: PublicClient;
  permitVariant: PermitVariant;
  permitContractVersion: number;
}): Promise<Extract<PreparedAuthorizationCall, { kind: 'permit' }>> => {
  const signature = parseSignature(
    await signPermitForAddressAndValue(
      {
        tokenAddress: input.tokenAddress,
        decimals: input.tokenDecimals,
        permitVariant: input.permitVariant,
        permitContractVersion: input.permitContractVersion,
      },
      input.chain,
      input.eoaWallet,
      input.publicClient,
      { address: input.eoaAddress, type: 'json-rpc' } as Account,
      input.ephemeralAddress,
      input.amount
    )
  );
  const signatureV = getSignatureV(signature);
  const deadline = 2n ** 256n - 1n;
  let call: Extract<PreparedAuthorizationCall, { kind: 'permit' }>['call'];

  switch (input.permitVariant) {
    case PermitVariant.EIP2612Canonical:
      call = {
        to: input.tokenAddress,
        data: encodeFunctionData({
          abi: ERC20PermitABI,
          functionName: 'permit',
          args: [
            input.eoaAddress,
            input.ephemeralAddress,
            input.amount,
            deadline,
            signatureV,
            signature.r,
            signature.s,
          ],
        }),
        value: 0n,
      };
      break;
    case PermitVariant.DAI:
    case PermitVariant.Polygon2612: {
      const nonce = await input.publicClient.readContract({
        address: input.tokenAddress,
        abi: NONCES_ABI,
        functionName: 'nonces',
        args: [input.eoaAddress],
      });
      call = {
        to: input.tokenAddress,
        data: encodeFunctionData({
          abi: DAI_PERMIT_ABI,
          functionName: 'permit',
          args: [
            input.eoaAddress,
            input.ephemeralAddress,
            nonce,
            deadline,
            true,
            signatureV,
            signature.r,
            signature.s,
          ],
        }),
        value: 0n,
      };
      break;
    }
    case PermitVariant.PolygonEMT: {
      const approveCallData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [input.ephemeralAddress, input.amount],
      });
      call = {
        to: input.tokenAddress,
        data: encodeFunctionData({
          abi: ERC20PermitABI,
          functionName: 'executeMetaTransaction',
          args: [input.eoaAddress, approveCallData, signature.r, signature.s, signatureV],
        }),
        value: 0n,
      };
      break;
    }
    default:
      throw new Error(`Unsupported permit variant ${input.permitVariant}`);
  }

  return {
    kind: 'permit',
    call,
    permit: {
      signature: `0x${signature.r.slice(2)}${signature.s.slice(2)}${signatureV
        .toString(16)
        .padStart(2, '0')}` as Hex,
      permitVariant: input.permitVariant,
      permitContractVersion: input.permitContractVersion,
    },
  };
};

export const buildTransferAuthorization = async (input: {
  chain: Chain;
  tokenAddress: Hex;
  tokenDecimals: number;
  amount: bigint;
  eoaAddress: Hex;
  eoaWallet: WalletClient;
  ephemeralAddress: Hex;
  publicClientList: PublicClientList;
  cache: SwapCache;
  eagerPermit: boolean;
}): Promise<PreparedAuthorizationCall | null> => {
  const chainId = input.chain.id;
  const currentAllowance = input.cache.getAllowance(
    input.tokenAddress,
    input.eoaAddress,
    input.ephemeralAddress,
    chainId
  );
  const permit = input.cache.getPermit(input.tokenAddress, chainId);
  const decision =
    currentAllowance >= input.amount
      ? 'none'
      : !permit || permit.permitVariant === PermitVariant.Unsupported
        ? 'approve'
        : 'permit';

  logger.debug('buildTransferAuthorization:decision', {
    chainId,
    tokenAddress: input.tokenAddress,
    eoaAddress: input.eoaAddress,
    ephemeralAddress: input.ephemeralAddress,
    currentAllowance: currentAllowance.toString(),
    requiredAllowance: input.amount.toString(),
    permitVariant: permit?.permitVariant ?? PermitVariant.Unsupported,
    permitContractVersion: permit?.permitContractVersion ?? 0,
    eagerPermit: input.eagerPermit,
    decision,
  });

  if (currentAllowance >= input.amount) {
    return null;
  }
  if (!permit || permit.permitVariant === PermitVariant.Unsupported) {
    return {
      // Marker: unsupported permits require a paid EOA approve(spender=ephemeral)
      // before the SBC transferFrom path can execute.
      kind: 'approve',
      call: {
        to: input.tokenAddress,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [input.ephemeralAddress, input.amount],
        }),
        value: 0n,
      },
      permit: null,
    };
  }

  if (!input.eagerPermit) {
    return {
      kind: 'permit',
      call: null,
      permit: {
        signature: null,
        permitVariant: permit.permitVariant,
        permitContractVersion: permit.permitContractVersion,
      },
    };
  }

  return buildPermitCall({
    chain: input.chain,
    tokenAddress: input.tokenAddress,
    tokenDecimals: input.tokenDecimals,
    amount: input.amount,
    eoaAddress: input.eoaAddress,
    eoaWallet: input.eoaWallet,
    ephemeralAddress: input.ephemeralAddress,
    publicClient: input.publicClientList.get(chainId),
    permitVariant: permit.permitVariant,
    permitContractVersion: permit.permitContractVersion,
  });
};

export const materializePermitAuthorizationCall = async (input: {
  chain: Chain;
  authorization: Extract<PreparedAuthorizationCall, { kind: 'permit' }>;
  tokenAddress: Hex;
  tokenDecimals: number;
  amount: bigint;
  eoaAddress: Hex;
  eoaWallet: WalletClient;
  ephemeralAddress: Hex;
  publicClient: PublicClient;
}) => {
  if (input.authorization.call) {
    return input.authorization.call;
  }

  const resolved = await buildPermitCall({
    chain: input.chain,
    tokenAddress: input.tokenAddress,
    tokenDecimals: input.tokenDecimals,
    amount: input.amount,
    eoaAddress: input.eoaAddress,
    eoaWallet: input.eoaWallet,
    ephemeralAddress: input.ephemeralAddress,
    publicClient: input.publicClient,
    permitVariant: input.authorization.permit.permitVariant,
    permitContractVersion: input.authorization.permit.permitContractVersion,
  });

  input.authorization.call = resolved.call;
  input.authorization.permit.signature = resolved.permit.signature;
  return resolved.call;
};

export const buildDirectApprovalRequest = (input: {
  tokenAddress: Hex;
  amount: bigint;
  eoaAddress: Hex;
  ephemeralAddress: Hex;
  chain: Chain;
}) => ({
  abi: erc20Abi,
  account: input.eoaAddress,
  address: input.tokenAddress,
  args: [input.ephemeralAddress, input.amount] as const,
  chain: input.chain,
  functionName: 'approve' as const,
});
