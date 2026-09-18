import { encodeFunctionData, type Hex, type PublicClient, parseSignature } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { ERC20PermitABI } from '../../abi/erc20';
import type { Chain, ChainListType } from '../../domain';
import { Errors } from '../../domain/errors';
import { PermitVariant } from '../../domain/permits';
import { getPermitDomainName } from '../../services/allowance-utils';
import { getPermitVariantAndVersion } from '../../services/permits';

export const buildEphemeralPermitCall = async (input: {
  tokenAddress: Hex;
  amount: bigint;
  spender: Hex;
  chain: Chain;
  chainList: ChainListType;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: PublicClient;
  deadline: bigint;
}) => {
  const token = (() => {
    try {
      return input.chainList.getTokenByAddress(input.chain.id, input.tokenAddress);
    } catch {
      return undefined;
    }
  })();
  // Native-only deployment metadata can omit Arc's ERC-20 USDC interface. Probe its permit support
  // and domain version on-chain, while preserving explicit metadata for listed bridge tokens.
  const { permitVariant, permitContractVersion } = token
    ? { permitVariant: token.permitVariant, permitContractVersion: token.permitVersion ?? 1 }
    : await getPermitVariantAndVersion({
        chainId: input.chain.id,
        tokenAddress: input.tokenAddress,
        chainList: input.chainList,
        publicClient: input.publicClient,
      });
  if (!permitVariant || permitVariant === PermitVariant.Unsupported) {
    throw Errors.tokenNotSupported(
      input.tokenAddress,
      input.chain.id,
      'permit required for Safe V2 bridge custody'
    );
  }
  if (permitVariant !== PermitVariant.EIP2612Canonical) {
    throw Errors.tokenNotSupported(input.tokenAddress, input.chain.id, '(2612 details not found)');
  }

  const [name, nonce] = (await Promise.all([
    getPermitDomainName(input.tokenAddress, input.publicClient),
    input.publicClient.readContract({
      address: input.tokenAddress,
      abi: ERC20PermitABI,
      functionName: 'nonces',
      args: [input.ephemeralWallet.address],
    }),
  ])) as [string, bigint];

  const signature = parseSignature(
    await input.ephemeralWallet.signTypedData({
      domain: {
        chainId: BigInt(input.chain.id),
        name,
        verifyingContract: input.tokenAddress,
        version: permitContractVersion.toString(10),
      },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: input.ephemeralWallet.address,
        spender: input.spender,
        value: input.amount,
        nonce,
        deadline: input.deadline,
      },
    })
  );
  const v = Number(
    signature.v ?? (signature.yParity != null ? Number(signature.yParity) + 27 : 27)
  );

  return {
    to: input.tokenAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20PermitABI,
      functionName: 'permit',
      args: [
        input.ephemeralWallet.address,
        input.spender,
        input.amount,
        input.deadline,
        v,
        signature.r,
        signature.s,
      ],
    }),
  };
};
