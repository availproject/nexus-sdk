import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  type Hex,
  keccak256,
  numberToHex,
  type PrivateKeyAccount,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { type Chain, getLogger } from '../commons';
import type { Tx } from '../commons/types/swap-types';
import { Errors } from '../core/errors';
import { switchChain } from '../core/utils';
import { MULTI_SEND_ABI, SAFE_ABI } from './safe.abi';
import {
  COMPAT_FALLBACK_HANDLER,
  ENSURE_AUTH_TYPEHASH,
  MULTI_SEND_CALL_ONLY,
  SAFE_DOMAIN_TYPEHASH,
  SAFE_OPERATION_CALL,
  SAFE_OPERATION_DELEGATECALL,
  SAFE_PROXY_FACTORY,
  SAFE_PROXY_INIT_CODE_HASH,
  SAFE_SALT_NONCE,
  SAFE_TX_TYPEHASH,
  SAFE_ZERO_ADDRESS,
  type SafeOperation,
} from './safe.constants';

const logger = getLogger();

export type SafeTxFields = {
  baseGas: bigint;
  data: Hex;
  gasPrice: bigint;
  gasToken: Hex;
  nonce: bigint;
  operation: SafeOperation;
  refundReceiver: Hex;
  safeTxGas: bigint;
  to: Hex;
  value: bigint;
};

export type SafeExecuteTx = SafeTxFields & {
  chainId: number;
  safeAddress: Hex;
  signature: Hex;
};

export const buildSafeInitializer = (owner: Hex): Hex =>
  encodeFunctionData({
    abi: SAFE_ABI,
    args: [
      [owner],
      1n,
      SAFE_ZERO_ADDRESS,
      '0x',
      COMPAT_FALLBACK_HANDLER,
      SAFE_ZERO_ADDRESS,
      0n,
      SAFE_ZERO_ADDRESS,
    ],
    functionName: 'setup',
  });

export const predictSafeAccountAddress = (owner: Hex): Hex => {
  const initializer = buildSafeInitializer(owner);
  const salt = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }],
      [keccak256(initializer), SAFE_SALT_NONCE]
    )
  );

  return getContractAddress({
    bytecodeHash: SAFE_PROXY_INIT_CODE_HASH,
    from: SAFE_PROXY_FACTORY,
    opcode: 'CREATE2',
    salt,
  });
};

const packMultiSendCall = (call: Tx): Hex => {
  if ((call.data.length - 2) % 2 !== 0) {
    throw Errors.internal(`MultiSend call data has odd hex length: ${call.data}`);
  }
  return concatHex([
    numberToHex(SAFE_OPERATION_CALL, { size: 1 }),
    call.to,
    numberToHex(call.value, { size: 32 }),
    numberToHex((call.data.length - 2) / 2, { size: 32 }),
    call.data,
  ]);
};

export const buildMultiSendPayload = (calls: Tx[]): Hex =>
  encodeFunctionData({
    abi: MULTI_SEND_ABI,
    args: [concatHex(calls.map(packMultiSendCall))],
    functionName: 'multiSend',
  });

export const hashSafeTx = ({
  chainId,
  fields,
  safeAddress,
}: {
  chainId: number;
  fields: SafeTxFields;
  safeAddress: Hex;
}): Hex => {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint8' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [
        SAFE_TX_TYPEHASH,
        fields.to,
        fields.value,
        keccak256(fields.data),
        fields.operation,
        fields.safeTxGas,
        fields.baseGas,
        fields.gasPrice,
        fields.gasToken,
        fields.refundReceiver,
        fields.nonce,
      ]
    )
  );
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [SAFE_DOMAIN_TYPEHASH, BigInt(chainId), safeAddress]
    )
  );

  return keccak256(concatHex(['0x1901', domainSeparator, structHash]));
};

// Ensure-auth deliberately uses a raw 32-byte digest signed by the ephemeral with
// `wallet.ephemeral.sign({ hash })`, NOT EIP-712 typed data and NOT signMessage. The signed
// payload itself binds chainId, owner, safeAddress, saltNonce, and deadline, and ca-node verifies
// by recomputing the same digest and recovering the signer. SafeTx (below) uses real EIP-712 via
// `signTypedData` because Safe's contract validates against its on-chain domain separator. Don't
// "harmonise" these two by switching ensure-auth to typed data — that breaks cross-repo verification.
export const hashEnsureAuthorization = ({
  chainId,
  deadline,
  owner,
  safeAddress,
  saltNonce,
}: {
  chainId: number;
  deadline: bigint;
  owner: Hex;
  safeAddress: Hex;
  saltNonce: bigint;
}): Hex =>
  keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [ENSURE_AUTH_TYPEHASH, BigInt(chainId), owner, safeAddress, saltNonce, deadline]
    )
  );

export const signSafeTx = async ({
  chainId,
  ephemeralWallet,
  fields,
  safeAddress,
}: {
  chainId: number;
  ephemeralWallet: PrivateKeyAccount;
  fields: SafeTxFields;
  safeAddress: Hex;
}): Promise<Hex> =>
  ephemeralWallet.signTypedData({
    domain: {
      chainId,
      verifyingContract: safeAddress,
    },
    message: fields,
    primaryType: 'SafeTx',
    types: {
      SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
  });

const buildBaseFields = (input: {
  data: Hex;
  nonce: bigint;
  operation: SafeOperation;
  to: Hex;
  value: bigint;
}): SafeTxFields => ({
  baseGas: 0n,
  data: input.data,
  gasPrice: 0n,
  gasToken: SAFE_ZERO_ADDRESS,
  nonce: input.nonce,
  operation: input.operation,
  refundReceiver: SAFE_ZERO_ADDRESS,
  safeTxGas: 0n,
  to: input.to,
  value: input.value,
});

export const createSafeExecuteTxFromCalls = async ({
  calls,
  chainId,
  ephemeralWallet,
  publicClient,
  safeAddress,
}: {
  calls: Tx[];
  chainId: number;
  ephemeralWallet: PrivateKeyAccount;
  publicClient: PublicClient;
  safeAddress: Hex;
}): Promise<SafeExecuteTx> => {
  const nonce = await publicClient.readContract({
    abi: SAFE_ABI,
    address: safeAddress,
    functionName: 'nonce',
  });
  const fields = buildBaseFields({
    data: buildMultiSendPayload(calls),
    nonce,
    operation: SAFE_OPERATION_DELEGATECALL,
    to: MULTI_SEND_CALL_ONLY,
    value: 0n,
  });

  return {
    ...fields,
    chainId,
    safeAddress,
    signature: await signSafeTx({ chainId, ephemeralWallet, fields, safeAddress }),
  };
};

// `actualAddress` is split from `eoaWallet` because viem's WalletClient does not always have an
// `.account` configured (e.g., JSON-RPC accounts where the upstream wallet owns the key). We pass
// the EOA address explicitly into `writeContract`'s `account` parameter to match the convention
// established by the 7702 `caliburExecute` path. Caller is responsible for keeping `actualAddress`
// consistent with the wallet it ultimately signs through.
export const createSafeExecuteEOASubmittedTx = async ({
  actualAddress,
  calls,
  chain,
  ephemeralWallet,
  eoaWallet,
  nativeValue,
  publicClient,
  safeAddress,
}: {
  actualAddress: Hex;
  calls: Tx[];
  chain: Chain;
  ephemeralWallet: PrivateKeyAccount;
  eoaWallet: WalletClient;
  nativeValue: bigint;
  publicClient: PublicClient;
  safeAddress: Hex;
}): Promise<Hex> => {
  // Native value invariants:
  // - Single-call path (operation=CALL): SafeTx.value is set to `nativeValue` and forwards
  //   straight to the recipient. The inner call's quoted value (`calls[0].value`) is ignored
  //   in favour of `nativeValue`, so the two MUST match — otherwise we execute against a
  //   different value than the quote was built for. Today's caller (parseQuote for native
  //   inputs) sets calls[0].value = quote.input.amountRaw, but we guard against future drift.
  // - MultiSend path (operation=DELEGATECALL): SafeTx.value is ignored by Safe; the outer tx
  //   funds the Safe with `nativeValue` and each per-tuple `value` forwards from that balance.
  //   Sum of inner values must equal the outer: short → funds stranded; over → inner reverts
  //   on insufficient balance.
  if (nativeValue !== 0n) {
    if (calls.length === 1) {
      if (calls[0].value !== nativeValue) {
        throw Errors.internal(
          `Single-call native value mismatch: outer=${nativeValue}, calls[0].value=${calls[0].value}`
        );
      }
    } else {
      const innerValueSum = calls.reduce((acc, call) => acc + call.value, 0n);
      if (innerValueSum !== nativeValue) {
        throw Errors.internal(
          `MultiSend native value mismatch: outer=${nativeValue}, sum(inner.value)=${innerValueSum}`
        );
      }
    }
  }

  await switchChain(eoaWallet, chain);

  const buildFields = (nonce: bigint) =>
    calls.length === 1
      ? buildBaseFields({
          data: calls[0].data,
          nonce,
          operation: SAFE_OPERATION_CALL,
          to: calls[0].to,
          value: nativeValue,
        })
      : buildBaseFields({
          data: buildMultiSendPayload(calls),
          nonce,
          operation: SAFE_OPERATION_DELEGATECALL,
          to: MULTI_SEND_CALL_ONLY,
          value: 0n,
        });

  const readSafeNonce = () =>
    publicClient.readContract({
      abi: SAFE_ABI,
      address: safeAddress,
      functionName: 'nonce',
    });

  const initialNonce = await readSafeNonce();
  const initialFields = buildFields(initialNonce);
  const initialSignature = await signSafeTx({
    chainId: chain.id,
    ephemeralWallet,
    fields: initialFields,
    safeAddress,
  });

  const buildMetadata = (hash?: Hex) => ({
    chainId: chain.id,
    from: actualAddress,
    safeAddress,
    hash,
  });

  const buildDetail = (txFields: SafeTxFields, txSignature: Hex, hash?: Hex) => ({
    ...buildMetadata(hash),
    calls,
    executeData: {
      to: safeAddress,
      value: nativeValue,
      data: encodeFunctionData({
        abi: SAFE_ABI,
        functionName: 'execTransaction',
        args: [
          txFields.to,
          txFields.value,
          txFields.data,
          txFields.operation,
          txFields.safeTxGas,
          txFields.baseGas,
          txFields.gasPrice,
          txFields.gasToken,
          txFields.refundReceiver,
          txSignature,
        ],
      }),
    },
  });

  const submitAndWait = async (txFields: SafeTxFields, txSignature: Hex) => {
    let hash: Hex;
    try {
      const execArgs = [
        txFields.to,
        txFields.value,
        txFields.data,
        txFields.operation,
        txFields.safeTxGas,
        txFields.baseGas,
        txFields.gasPrice,
        txFields.gasToken,
        txFields.refundReceiver,
        txSignature,
      ] as const;

      // Aggregator routes (e.g. LI.FI on HyperEVM via Eisen) iterate over V3 pools whose
      // tick-crossing path shifts gas use between estimation and inclusion blocks. viem's
      // `writeContract` uses raw `eth_estimateGas` with zero headroom; a small state shift
      // OOGs deep in the inner call tree and unwinds opaquely as Safe GS013. Estimate
      // ourselves and apply a 50% buffer. Pass the real signature so estimateGas executes
      // the inner batch instead of reverting in `checkSignatures`. 1.5M fallback covers
      // the rare estimation revert.
      const gasEstimate = await publicClient
        .estimateContractGas({
          abi: SAFE_ABI,
          account: actualAddress,
          address: safeAddress,
          args: execArgs,
          functionName: 'execTransaction',
          value: nativeValue,
        })
        .catch(() => 1_500_000n);
      const gas = (gasEstimate * 150n) / 100n;

      hash = await eoaWallet.writeContract({
        abi: SAFE_ABI,
        account: actualAddress,
        address: safeAddress,
        args: execArgs,
        chain,
        functionName: 'execTransaction',
        gas,
        value: nativeValue,
      });
    } catch (error) {
      logger.error('[TX_FAIL] safe_execute_eoa_error', error, buildMetadata());
      // Detail at debug level: calldata embeds the user's signature, must not leave the console.
      logger.debug('[TX_FAIL] safe_execute_eoa_error:detail', buildDetail(txFields, txSignature));
      throw error;
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      logger.error(
        '[TX_FAIL] safe_execute_eoa_error',
        new Error(`Safe execTransaction reverted: ${hash}`),
        buildMetadata(hash)
      );
      logger.debug(
        '[TX_FAIL] safe_execute_eoa_error:detail',
        buildDetail(txFields, txSignature, hash)
      );
    }
    return { hash, receipt };
  };

  const first = await submitAndWait(initialFields, initialSignature);
  if (first.receipt.status === 'success') {
    return first.hash;
  }

  // The first attempt reverted. Detect a Safe-nonce race: another execTransaction for this
  // Safe could have landed between our nonce read and our broadcast, bumping the on-chain
  // nonce past `initialNonce`. In that case re-sign with the fresh nonce and retry once.
  // If the on-chain nonce is unchanged, the revert is from another cause (insufficient
  // balance, signer mismatch, etc.) — propagate.
  const postRevertNonce = await readSafeNonce();
  if (postRevertNonce === initialNonce) {
    throw Errors.internal(
      `Safe execTransaction reverted (tx ${first.hash}); on-chain Safe nonce unchanged at ${initialNonce} — revert is unrelated to nonce contention`
    );
  }

  const retryFields = buildFields(postRevertNonce);
  const retrySignature = await signSafeTx({
    chainId: chain.id,
    ephemeralWallet,
    fields: retryFields,
    safeAddress,
  });
  const second = await submitAndWait(retryFields, retrySignature);
  if (second.receipt.status !== 'success') {
    throw Errors.internal(
      `Safe execTransaction reverted on nonce-race retry (initial=${first.hash}, retry=${second.hash})`
    );
  }
  return second.hash;
};
