import type { Hex, PublicClient } from 'viem';
import { ERC20PermitABI } from '../abi/erc20';
import { type ChainListType, ZERO_ADDRESS } from '../domain';
import { type PermitDetails, PermitVariant } from '../domain/permits';

const UNSUPPORTED_PERMIT_DETAILS: PermitDetails = {
  permitVariant: PermitVariant.Unsupported,
  permitContractVersion: 0,
};

type PermitProbeClient = Pick<PublicClient, 'multicall'>;

const getPermitFromChainList = (
  chainList: ChainListType,
  chainId: number,
  tokenAddress: Hex
): PermitDetails | null => {
  try {
    const token = chainList.getTokenByAddress(chainId, tokenAddress);
    if (token.permitVariant != null && token.permitVersion != null) {
      return {
        permitVariant: token.permitVariant as PermitVariant,
        permitContractVersion: token.permitVersion,
      };
    }
  } catch {
    return null;
  }

  return null;
};

const parsePermitVersion = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 1;
  }
  return 1;
};

const probeCanonicalPermit = async (
  client: PermitProbeClient,
  tokenAddress: Hex,
  multicallAddress: Hex
) => {
  const [domainSeparator, nonces, version] = await client.multicall({
    multicallAddress,
    allowFailure: true,
    contracts: [
      {
        address: tokenAddress,
        abi: ERC20PermitABI,
        functionName: 'DOMAIN_SEPARATOR',
      },
      {
        address: tokenAddress,
        abi: ERC20PermitABI,
        functionName: 'nonces',
        args: [ZERO_ADDRESS],
      },
      {
        address: tokenAddress,
        abi: ERC20PermitABI,
        functionName: 'version',
      },
    ],
  });

  return { domainSeparator, nonces, version };
};

export const getPermitVariantAndVersion = async (input: {
  chainId: number;
  tokenAddress: Hex;
  chainList: ChainListType;
  publicClient?: PermitProbeClient | null;
}): Promise<PermitDetails> => {
  const fromChainList = getPermitFromChainList(input.chainList, input.chainId, input.tokenAddress);
  if (fromChainList) {
    return fromChainList;
  }

  if (!input.publicClient || typeof input.publicClient.multicall !== 'function') {
    return UNSUPPORTED_PERMIT_DETAILS;
  }

  try {
    const multicallAddress = input.chainList.getChainByID(input.chainId).multicallAddress;
    const { domainSeparator, nonces, version } = await probeCanonicalPermit(
      input.publicClient,
      input.tokenAddress,
      multicallAddress
    );

    if (domainSeparator.status !== 'success' || nonces.status !== 'success') {
      return UNSUPPORTED_PERMIT_DETAILS;
    }

    return {
      permitVariant: PermitVariant.EIP2612Canonical,
      permitContractVersion: version.status === 'success' ? parsePermitVersion(version.result) : 1,
    };
  } catch {
    return UNSUPPORTED_PERMIT_DETAILS;
  }
};
