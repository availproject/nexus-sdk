import {
  bytesToBigInt,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  type PublicClient,
  padHex,
  parseAbi,
  parseAbiParameters,
  toHex,
} from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { Chain, ChainListType } from '../../domain';
import {
  BackendError,
  ERROR_CODES,
  Errors,
  ExecutionError,
  formatUnknownError,
} from '../../domain/errors';
import { PermitVariant } from '../../domain/permits';
import { confirmStepReceipt } from '../../services/evm';
import type { SafeCall } from '../../services/safe';
import { createBridgeDepositStepId } from '../../services/step-ids';
import type {
  MiddlewareSbcSubmitterClient,
  SbcAuthorization,
  SbcResult,
  SbcTransaction,
} from '../../transport/middleware';
import { buildEphemeralPermitCall } from './ephemeral-permit';

const CALIBUR_DEADLINE_SECONDS = 15n * 60n;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}` as Hex;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}` as Hex;

const BATCHED_CALL_TYPES = {
  SignedBatchedCall: [
    { name: 'batchedCall', type: 'BatchedCall' },
    { name: 'nonce', type: 'uint256' },
    { name: 'keyHash', type: 'bytes32' },
    { name: 'executor', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
  BatchedCall: [
    { name: 'calls', type: 'Call[]' },
    { name: 'revertOnFailure', type: 'bool' },
  ],
  Call: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

export const CALIBUR_EXECUTE_ABI = parseAbi([
  'function execute((((address to,uint256 value,bytes data)[] calls,bool revertOnFailure) batchedCall,uint256 nonce,bytes32 keyHash,address executor,uint256 deadline) signedBatchedCall,bytes wrappedSignature)',
]);

const toHex32 = (value: bigint | number): Hex => padHex(toHex(value), { size: 32 });

const readVaultAllowance = async (input: {
  tokenAddress: Hex;
  owner: Hex;
  vaultAddress: Hex;
  chainId: number;
  publicClient: PublicClient;
}): Promise<bigint> => {
  try {
    return await input.publicClient.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [input.owner, input.vaultAddress],
    });
  } catch (error) {
    throw new ExecutionError(
      ERROR_CODES.EXEC_ERC20_ALLOWANCE_READ_FAILED,
      `Failed to read ephemeral vault allowance: ${formatUnknownError(error)}`,
      {
        context: { service: 'rpc', chainId: input.chainId },
        details: {
          tokenAddress: input.tokenAddress,
          owner: input.owner,
          vaultAddress: input.vaultAddress,
        },
      }
    );
  }
};

export const buildCaliburVaultApprovalCall = (input: {
  tokenAddress: Hex;
  vaultAddress: Hex;
  depositValue: bigint;
}): SafeCall => ({
  to: input.tokenAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [input.vaultAddress, input.depositValue],
  }),
});

const getCaliburAuthorization = async (input: {
  chainId: number;
  caliburAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: Pick<PublicClient, 'getCode' | 'getTransactionCount'>;
}): Promise<SbcAuthorization[]> => {
  const code = await input.publicClient.getCode({ address: input.ephemeralWallet.address });
  const expectedCode = concatHex(['0xef0100', input.caliburAddress]);
  if (code?.toLowerCase() === expectedCode.toLowerCase()) return [];

  const nonce = await input.publicClient.getTransactionCount({
    address: input.ephemeralWallet.address,
  });
  const authorization = await input.ephemeralWallet.signAuthorization({
    contractAddress: input.caliburAddress,
    chainId: input.chainId,
    nonce,
  });

  return [
    {
      chainId: toHex32(input.chainId),
      address: input.caliburAddress,
      nonce: authorization.nonce ?? nonce,
      r: padHex(authorization.r, { size: 32 }),
      s: padHex(authorization.s, { size: 32 }),
      v: authorization.yParity ?? 0,
    },
  ];
};

const signCaliburApprovalTransaction = async (input: {
  approvalCall: SafeCall;
  chainId: number;
  caliburAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: Pick<PublicClient, 'getCode' | 'getTransactionCount'>;
}): Promise<SbcTransaction> => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = bytesToBigInt(randomBytes) << 64n;
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + CALIBUR_DEADLINE_SECONDS;
  const message = {
    batchedCall: {
      calls: [input.approvalCall],
      revertOnFailure: true,
    },
    nonce,
    keyHash: ZERO_BYTES32,
    executor: ZERO_ADDRESS,
    deadline,
  };
  const signature = await input.ephemeralWallet.signTypedData({
    domain: {
      name: 'Calibur',
      version: '1.0.0',
      chainId: input.chainId,
      verifyingContract: input.ephemeralWallet.address,
      salt: padHex(input.caliburAddress, { size: 32 }),
    },
    types: BATCHED_CALL_TYPES,
    primaryType: 'SignedBatchedCall',
    message,
  });
  const authorizationList = await getCaliburAuthorization(input);

  return {
    chainId: input.chainId,
    address: input.ephemeralWallet.address,
    nonce: toHex32(nonce),
    keyHash: ZERO_BYTES32,
    deadline: toHex32(deadline),
    calls: [
      {
        to: input.approvalCall.to,
        value: toHex32(input.approvalCall.value),
        data: input.approvalCall.data,
      },
    ],
    revertOnFailure: true,
    signature: encodeAbiParameters(parseAbiParameters('bytes, bytes'), [signature, '0x']),
    authorizationList: authorizationList.length > 0 ? authorizationList : undefined,
  };
};

const requireApprovalTransactionHash = (results: SbcResult[], chainId: number): Hex => {
  const result = results.find((entry) => entry.chainId === chainId);
  if (!result) {
    throw Errors.internal(`Calibur vault approval: missing SBC result for chain ${chainId}`);
  }
  if (!result.errored) return result.txHash;

  throw new BackendError(
    ERROR_CODES.BACKEND_SBC_SUBMIT_FAILED,
    `Calibur vault approval: ${result.message}`,
    {
      context: { service: 'middleware', chainId },
      details: {
        middlewareCode: result.code,
        middlewareSubcode: result.subcode,
        errorId: result.errorId,
        middlewareDetails: result.details,
      },
    }
  );
};

const executeCaliburVaultApproval = async (input: {
  tokenAddress: Hex;
  depositValue: bigint;
  vaultAddress: Hex;
  chain: Chain;
  caliburAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: PublicClient;
  middleware: MiddlewareSbcSubmitterClient;
}): Promise<void> => {
  const approvalCall = buildCaliburVaultApprovalCall(input);
  const transaction = await signCaliburApprovalTransaction({
    approvalCall,
    chainId: input.chain.id,
    caliburAddress: input.caliburAddress,
    ephemeralWallet: input.ephemeralWallet,
    publicClient: input.publicClient,
  });
  const txHash = requireApprovalTransactionHash(
    await input.middleware.submitSBCs([transaction]),
    input.chain.id
  );

  await confirmStepReceipt(input.publicClient, txHash, input.chain.id, {
    stepId: createBridgeDepositStepId(input.chain.id),
    stepType: 'bridge_deposit',
    label: 'Calibur vault approval',
  });

  const allowance = await readVaultAllowance({
    tokenAddress: input.tokenAddress,
    owner: input.ephemeralWallet.address,
    vaultAddress: input.vaultAddress,
    chainId: input.chain.id,
    publicClient: input.publicClient,
  });
  if (allowance < input.depositValue) {
    throw Errors.execution('Calibur vault approval is not visible after confirmation', {
      service: 'rpc',
      chainId: input.chain.id,
      details: {
        tokenAddress: input.tokenAddress,
        vaultAddress: input.vaultAddress,
        expectedAllowance: input.depositValue.toString(),
        actualAllowance: allowance.toString(),
        txHash,
      },
    });
  }
};

export const resolveEphemeralVaultAllowance = async (input: {
  tokenAddress: Hex;
  depositValue: bigint;
  vaultAddress: Hex;
  chain: Chain;
  chainList: ChainListType;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: PublicClient;
  middleware: MiddlewareSbcSubmitterClient;
  deadline: bigint;
}): Promise<SafeCall[]> => {
  const allowance = await readVaultAllowance({
    tokenAddress: input.tokenAddress,
    owner: input.ephemeralWallet.address,
    vaultAddress: input.vaultAddress,
    chainId: input.chain.id,
    publicClient: input.publicClient,
  });
  if (allowance >= input.depositValue) return [];

  const token = input.chainList.getTokenByAddress(input.chain.id, input.tokenAddress);
  if (token.permitVariant === PermitVariant.EIP2612Canonical) {
    return [
      await buildEphemeralPermitCall({
        tokenAddress: input.tokenAddress,
        amount: input.depositValue,
        spender: input.vaultAddress,
        chain: input.chain,
        chainList: input.chainList,
        ephemeralWallet: input.ephemeralWallet,
        publicClient: input.publicClient,
        deadline: input.deadline,
      }),
    ];
  }

  const caliburAddress = input.chain.caliburAddress;
  if (input.chain.swapSupported !== true || input.chain.supports7702 !== true || !caliburAddress) {
    throw Errors.tokenNotSupported(
      input.tokenAddress,
      input.chain.id,
      'permit required for Safe V2 bridge custody'
    );
  }

  await executeCaliburVaultApproval({
    tokenAddress: input.tokenAddress,
    depositValue: input.depositValue,
    vaultAddress: input.vaultAddress,
    chain: input.chain,
    caliburAddress,
    ephemeralWallet: input.ephemeralWallet,
    publicClient: input.publicClient,
    middleware: input.middleware,
  });
  return [];
};
