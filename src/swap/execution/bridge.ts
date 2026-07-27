import {
  encodeMayanRouteData,
  getRoutesDataFromQuote,
  toMayanDepositRequest,
  VAULT_ABI_MAYAN,
} from '@avail-project/nexus-types/rff';
import Decimal from 'decimal.js';
import { encodeFunctionData, erc20Abi, type Hex, type PublicClient, parseSignature } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { ERC20PermitABI } from '../../abi/erc20';
import { EVMVaultABI } from '../../abi/vault';
import { submitRFFToMiddleware, waitForFill } from '../../bridge/executor';
import { type Chain, DEFAULT_FILL_TIMEOUT_MINUTES, getLogger } from '../../domain';
import {
  ERROR_CODES,
  Errors,
  ExecutionError,
  formatUnknownError,
  NexusError,
  UserActionError,
} from '../../domain/errors';
import { PermitVariant } from '../../domain/permits';
import { isNativeAddress } from '../../services/addresses';
import { confirmStepReceipt, switchChain } from '../../services/evm';
import { createExplorerTxURL } from '../../services/explorer';
import { mulDecimals } from '../../services/math';
import { quoteMayanLegs } from '../../services/mayan';
import { createRequestFromIntent } from '../../services/rff';
import {
  createSafeExecuteTxFromCalls,
  ensureSafeForEphemeral,
  type SafeCall,
} from '../../services/safe';
import {
  createCaliburExecuteTxFromCalls,
  createSBCTxFromCalls,
  requireSuccessfulSbcResult,
  type SBCCall,
} from '../../services/sbc';
import {
  createBridgeDepositStepId,
  createEoaToEphemeralTransferStepId,
} from '../../services/step-ids';
import { withTimingSpan } from '../../services/timing';
import { createSwapBridgeIntent } from '../bridge-intent';
import { predictSafeAccountAddress } from '../safe/predict';
import type { BridgeAsset, ExecutionContext, SBCResult, SwapMetadata, SwapRoute } from '../types';
import { chainSupports7702 } from '../wallet/capabilities';
import { resolvePreparedFundingTransferCalls } from './eoa-to-ephemeral';
import { dispatchSafeSource } from './safe-dispatch';

const logger = getLogger();

// Loose view of a Mayan quote for tracing (effectiveAmountIn / minReceived live on the vendored
// Mayan Quote type and aren't worth importing just to log).
const asRecord = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;

const resolveChain = (chainList: ExecutionContext['chainList'], chainId: number): Chain =>
  chainList.getChainByID(chainId);

// Bridge fill recipient resolution:
//   - `destinationDirectEoa` (no destination swap step) → user's EOA, no wrapper
//   - 7702 destination + destination swap step → ephemeral (Calibur runs the swap)
//   - non-7702 destination + destination swap step → predicted Safe (Safe.execTransaction
//     runs the swap, delivers to EOA)
const resolveBridgeRecipient = (input: {
  destinationDirectEoa: boolean;
  destinationChain: Chain;
  eoaAddress: Hex;
  ephemeralAddress: Hex;
}): Hex => {
  if (input.destinationDirectEoa) return input.eoaAddress;
  if (chainSupports7702(input.destinationChain)) return input.ephemeralAddress;
  return predictSafeAccountAddress(input.ephemeralAddress).address;
};

// 5 minute window — matches v1's BRIDGE_VAULT_PERMIT_DEADLINE_MINUTES. Permit deadline expiry
// has historically been a source of flake; do not drop below 3 minutes.
const BRIDGE_VAULT_PERMIT_DEADLINE_SECONDS = 5n * 60n;
const MAX_BRIDGE_FUNDING_ATTEMPTS = 3;

const isRetryableFundingPreparationError = (
  error: unknown,
  authorizationKind: 'permit' | 'approve' | 'none'
): boolean => {
  if (authorizationKind !== 'permit') return false;
  if (!(error instanceof NexusError)) return true;
  return error.context.service === 'rpc';
};

const withFundingStepContext = (error: NexusError, chainId: number): NexusError => {
  if (error.context.stepId !== undefined) return error;

  if (error instanceof ExecutionError) {
    return new ExecutionError(error.code, error.message, {
      context: {
        operation: error.context.operation,
        service: error.context.service,
        chainId,
        stepId: createEoaToEphemeralTransferStepId(chainId),
        stepType: 'eoa_to_ephemeral_transfer',
      },
      details: error.details,
    });
  }
  if (error instanceof UserActionError) {
    return new UserActionError(error.code, error.message, {
      context: {
        operation: error.context.operation,
        service: error.context.service,
        chainId,
        stepId: createEoaToEphemeralTransferStepId(chainId),
        stepType: 'eoa_to_ephemeral_transfer',
      },
      details: error.details,
    });
  }
  return error;
};

// A structured per-chain failure means middleware did not broadcast the SBC. Re-submit the exact
// signed payload so nonce/deadline/signature stay stable. Transport failures are intentionally not
// caught because the broadcast outcome is ambiguous; a successful result hands its hash to the
// caller's existing receipt wait.
const submitBridgeFundingSbc = async (
  sbcTx: Awaited<ReturnType<typeof createSBCTxFromCalls>>,
  chainId: number,
  context: string,
  middlewareClient: ExecutionContext['middlewareClient']
): Promise<Hex> => {
  for (let attempt = 1; attempt <= MAX_BRIDGE_FUNDING_ATTEMPTS; attempt++) {
    const results = await middlewareClient.submitSBCs([sbcTx]);
    const result = results.find((entry) => entry.chainId === chainId);
    const shouldRetry = result?.errored === true && attempt < MAX_BRIDGE_FUNDING_ATTEMPTS;

    if (!shouldRetry) {
      return requireSuccessfulSbcResult(results, chainId, context);
    }

    const erroredResult = result as SBCResult<true>;
    logger.debug('swap.execute.bridge.funding_sbc.retrying', {
      chainId,
      attempt,
      maxAttempts: MAX_BRIDGE_FUNDING_ATTEMPTS,
      middlewareCode: erroredResult.code,
      middlewareSubcode: erroredResult.subcode,
      errorId: erroredResult.errorId,
    });
  }

  throw Errors.internal(`Unreachable bridge funding SBC retry state for chain ${chainId}`);
};

// Non-7702 bridge funding/allowance, shared by the Nexus deposit batch and the Mayan approve:
//  1. transfer(ephemeral, depositValue) — Safe moves the COT to the ephemeral
//  2. permit(ephemeral → vault)          — ephemeral grants the vault transferFrom via EIP-2612
// (the deposit itself is appended by the Nexus path, or sponsored by the middleware for Mayan).
const buildSafeTransferAndPermitCalls = async (input: {
  asset: BridgeAsset;
  depositValue: bigint;
  vaultAddress: Hex;
  chain: Chain;
  chainList: ExecutionContext['chainList'];
  ephemeralWallet: PrivateKeyAccount;
  publicClient: PublicClient;
  deadline: bigint;
}): Promise<SafeCall[]> => {
  const token = input.chainList.getTokenByAddress(input.chain.id, input.asset.contractAddress);
  const permitVariant = token?.permitVariant;
  if (!permitVariant || permitVariant === PermitVariant.Unsupported) {
    throw Errors.tokenNotSupported(
      input.asset.contractAddress,
      input.chain.id,
      'permit required for non-7702 bridge deposit'
    );
  }
  // v1's createPermitOnlyApprovalTx only supports EIP-2612 canonical.
  if (permitVariant !== PermitVariant.EIP2612Canonical) {
    throw Errors.tokenNotSupported(
      input.asset.contractAddress,
      input.chain.id,
      '(2612 details not found)'
    );
  }
  const permitContractVersion = token?.permitVersion ?? 1;

  const [name, nonce] = (await Promise.all([
    input.publicClient.readContract({
      address: input.asset.contractAddress,
      abi: erc20Abi,
      functionName: 'name',
    }),
    input.publicClient.readContract({
      address: input.asset.contractAddress,
      abi: ERC20PermitABI,
      functionName: 'nonces',
      args: [input.ephemeralWallet.address],
    }),
  ])) as [string, bigint];

  const sigHex = await input.ephemeralWallet.signTypedData({
    domain: {
      chainId: BigInt(input.chain.id),
      name,
      verifyingContract: input.asset.contractAddress,
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
      spender: input.vaultAddress,
      value: input.depositValue,
      nonce,
      deadline: input.deadline,
    },
  });
  const parsedSig = parseSignature(sigHex);
  const v = Number(
    parsedSig.v ?? (parsedSig.yParity != null ? Number(parsedSig.yParity) + 27 : 27)
  );

  return [
    {
      to: input.asset.contractAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [input.ephemeralWallet.address, input.depositValue],
      }),
    },
    {
      to: input.asset.contractAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20PermitABI,
        functionName: 'permit',
        args: [
          input.ephemeralWallet.address,
          input.vaultAddress,
          input.depositValue,
          input.deadline,
          v,
          parsedSig.r,
          parsedSig.s,
        ],
      }),
    },
  ];
};

// Safe-path bridge deposit (non-7702 source). Seam 1 bridges the actual Safe balance, so the batch
// is just transfer → permit → deposit with no trailing Sweeper (the deposit drains the Safe):
//
//  1. transfer(ephemeral, depositValue)   — Safe moves the full COT to ephemeral
//  2. permit(ephemeral → vault)            — ephemeral signs EIP-2612 granting vault transferFrom
//  3. vault.deposit(...)                   — vault.transferFrom(ephemeral, vault, depositValue)
const buildSafeBridgeDepositCalls = async (input: {
  asset: BridgeAsset;
  depositValue: bigint;
  vaultAddress: Hex;
  chain: Chain;
  chainList: ExecutionContext['chainList'];
  ephemeralWallet: PrivateKeyAccount;
  publicClient: PublicClient;
  depositRequest:
    | Parameters<(typeof EVMVaultABI)[0] extends { name: 'deposit' } ? never : never>
    | unknown;
  signature: Hex;
  chainIndex: number;
  deadline: bigint;
}): Promise<SafeCall[]> => {
  const calls: SafeCall[] = [
    ...(await buildSafeTransferAndPermitCalls({
      asset: input.asset,
      depositValue: input.depositValue,
      vaultAddress: input.vaultAddress,
      chain: input.chain,
      chainList: input.chainList,
      ephemeralWallet: input.ephemeralWallet,
      publicClient: input.publicClient,
      deadline: input.deadline,
    })),
    {
      to: input.vaultAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: EVMVaultABI,
        functionName: 'deposit',
        // depositRequest shape comes from createRequestFromIntent; passed through unchanged.
        args: [input.depositRequest, input.signature, BigInt(input.chainIndex)] as never,
      }),
    },
  ];

  // No COT sweep: Seam 1 bridges the actual Safe balance, so transfer(ephemeral, depositValue) moves
  // the full COT and the deposit drains it — nothing residual stays at the Safe. The surplus is
  // consolidated at the destination, not returned per source chain.
  return calls;
};

const resolveFundingTransferCalls = async (
  asset: BridgeAsset,
  ctx: Pick<
    ExecutionContext,
    | 'chainList'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'onProgress'
    | 'preparedExecution'
    | 'publicClientList'
    | 'timing'
  >
) => {
  if (asset.eoaBalance.lte(0)) {
    logger.debug('swap.execute.bridge.funding.skipped', {
      chainId: asset.chainID,
      tokenAddress: asset.contractAddress,
    });
    return [];
  }

  const transfer = ctx.preparedExecution?.eoaToEphemeralTransfers.find(
    (entry) =>
      entry.reason === 'bridge' &&
      entry.chainId === asset.chainID &&
      entry.tokenAddress.toLowerCase() === asset.contractAddress.toLowerCase()
  );

  if (!transfer) {
    const message = `Missing bridge funding transfer for chain ${asset.chainID}`;
    logger.debug('swap.execute.bridge.funding.missing', {
      chainId: asset.chainID,
      tokenAddress: asset.contractAddress,
    });
    ctx.onProgress?.({
      stepType: 'eoa_to_ephemeral_transfer',
      chainId: asset.chainID,
      state: 'failed',
      error: message,
    });
    throw new ExecutionError(ERROR_CODES.EXECUTION_ERROR, message, {
      context: {
        service: 'wallet',
        stepId: createEoaToEphemeralTransferStepId(asset.chainID),
        stepType: 'eoa_to_ephemeral_transfer',
        chainId: asset.chainID,
      },
    });
  }

  const chain = resolveChain(ctx.chainList, asset.chainID);
  const publicClient = ctx.publicClientList.get(asset.chainID);
  const authorizationKind = transfer.authorization?.kind ?? 'none';

  logger.debug('swap.execute.bridge.funding.started', {
    chainId: asset.chainID,
    tokenAddress: asset.contractAddress,
    authorizationKind,
    amountRaw: transfer.amount.toString(),
  });
  if (transfer.authorization) {
    ctx.onProgress?.({
      stepType: 'eoa_to_ephemeral_transfer',
      chainId: asset.chainID,
      state: 'wallet_prompted',
    });
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_BRIDGE_FUNDING_ATTEMPTS; attempt++) {
    try {
      const calls = await resolvePreparedFundingTransferCalls({
        transfer,
        tokenDecimals: asset.decimals,
        chain,
        eoaAddress: ctx.eoaAddress,
        eoaWallet: ctx.eoaWallet,
        publicClient,
      });
      logger.debug('swap.execute.bridge.funding.completed', {
        chainId: asset.chainID,
        tokenAddress: asset.contractAddress,
        authorizationKind,
        callCount: calls.length,
        attempt,
      });
      return calls;
    } catch (error) {
      lastError = error;
      if (
        attempt === MAX_BRIDGE_FUNDING_ATTEMPTS ||
        !isRetryableFundingPreparationError(error, authorizationKind)
      ) {
        break;
      }
      logger.debug('swap.execute.bridge.funding.retrying', {
        chainId: asset.chainID,
        tokenAddress: asset.contractAddress,
        authorizationKind,
        attempt,
        maxAttempts: MAX_BRIDGE_FUNDING_ATTEMPTS,
        error: formatUnknownError(error),
      });
    }
  }

  const message = `Failed to prepare bridge funding transfer for chain ${asset.chainID}`;
  logger.error('executeSwapBridge:funding_transfer:failed', lastError, {
    chainId: asset.chainID,
    tokenAddress: asset.contractAddress,
    authorizationKind,
  });
  ctx.onProgress?.({
    stepType: 'eoa_to_ephemeral_transfer',
    chainId: asset.chainID,
    state: 'failed',
    error: formatUnknownError(lastError),
  });
  if (lastError instanceof NexusError) {
    throw withFundingStepContext(lastError, asset.chainID);
  }
  throw new ExecutionError(
    ERROR_CODES.EXECUTION_ERROR,
    `${message}: ${formatUnknownError(lastError)}`,
    {
      context: {
        service: 'wallet',
        stepId: createEoaToEphemeralTransferStepId(asset.chainID),
        stepType: 'eoa_to_ephemeral_transfer',
        chainId: asset.chainID,
      },
      details: {
        tokenAddress: asset.contractAddress,
        authorizationKind,
      },
    }
  );
};

const hasEoaFunding = (asset: BridgeAsset) => asset.eoaBalance.gt(0);

// EOA-submitted payable native bridge deposit, shared by the Nexus and Mayan paths. Native value
// can't be relayed/sponsored, so the EOA submits the deposit itself: Calibur execute{value} on a
// 7702 chain (bootstrapping delegation once if needed), or Safe.execTransaction{value} via
// dispatchSafeSource on a non-7702 chain. `depositCall` is the pre-encoded payable deposit /
// depositMayan call.
const submitNativeBridgeDepositViaEoa = async (params: {
  asset: BridgeAsset;
  chain: Chain;
  depositCall: SBCCall;
  depositValue: bigint;
  ctx: Pick<
    ExecutionContext,
    | 'cache'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'middlewareClient'
    | 'publicClientList'
  >;
}): Promise<Hex> => {
  const { asset, chain, depositCall, depositValue, ctx } = params;
  const publicClient = ctx.publicClientList.get(asset.chainID);

  if (!chainSupports7702(chain)) {
    const safeResult = await dispatchSafeSource({
      chain,
      chainId: asset.chainID,
      calls: [depositCall],
      nativeValue: depositValue,
      ephemeralWallet: ctx.ephemeralWallet,
      eoaWallet: ctx.eoaWallet,
      eoaAddress: ctx.eoaAddress,
      publicClient,
      middleware: ctx.middlewareClient,
    });
    return safeResult.txHash;
  }

  // 7702: EOA submits Calibur execute{value}; bootstrap delegation first when the ephemeral isn't
  // delegated yet (a pure same-token native bridge runs no prior source swap on this chain).
  const hasDelegatedAuth =
    ctx.cache?.hasAuthCodeSet(ctx.ephemeralWallet.address, asset.chainID) ?? false;
  if (!hasDelegatedAuth) {
    const bootstrapSbcTx = await createSBCTxFromCalls({
      calls: [],
      chainID: asset.chainID,
      ephemeralAddress: ctx.ephemeralWallet.address,
      ephemeralWallet: ctx.ephemeralWallet,
      publicClient,
    });
    const bootstrapResults = await ctx.middlewareClient.submitSBCs([bootstrapSbcTx]);
    const bootstrapHash = requireSuccessfulSbcResult(
      bootstrapResults,
      asset.chainID,
      'Native bridge deposit auth bootstrap'
    );
    await confirmStepReceipt(publicClient, bootstrapHash, asset.chainID, {
      stepId: createBridgeDepositStepId(asset.chainID),
      stepType: 'bridge_deposit',
      label: 'Native bridge deposit auth bootstrap',
    });
    ctx.cache?.markAuthCodeSet?.(ctx.ephemeralWallet.address, asset.chainID);
  }
  const tx = await createCaliburExecuteTxFromCalls({
    calls: [depositCall],
    chainID: asset.chainID,
    ephemeralAddress: ctx.ephemeralWallet.address,
    ephemeralWallet: ctx.ephemeralWallet,
    value: depositValue,
  });
  await switchChain(ctx.eoaWallet, chain);
  return ctx.eoaWallet.sendTransaction({
    account: ctx.eoaAddress,
    to: tx.to,
    data: tx.data,
    value: tx.value,
    chain,
  });
};

// Mayan + ephemeral path: each SBC contains the EOA→ephemeral funding (if any)
// plus a single approve(vault, total) — no vault.deposit, no sweep. We submit
// the SBC and wait for it to be mined BEFORE submitting the RFF, because the
// middleware kicks off its sponsored depositMayan() call asynchronously the
// moment the RFF lands and fails fast if the allowance isn't on-chain yet.
//
// See ai-swap-mayan-bridge-plan.md ("Option A locked, code shape (i)") for the
// design rationale and the SDK / middleware contract this relies on.
const runMayanEphemeralBridge = async (
  intent: ReturnType<typeof createSwapBridgeIntent>,
  bridge: NonNullable<SwapRoute['bridge']>,
  bridgedAssets: BridgeAsset[],
  ctx: Pick<
    ExecutionContext,
    | 'cache'
    | 'chainList'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'middlewareClient'
    | 'onProgress'
    | 'preparedExecution'
    | 'publicClientList'
    | 'timing'
  >,
  metadata: SwapMetadata
): Promise<void> => {
  logger.debug('swap.execute.bridge.mayan_approval.started', {
    chains: bridgedAssets.map((asset) => asset.chainID),
  });

  // Per-leg amounts the RFF will deposit versus the Mayan quote they were sized against.
  logger.debug('swap.execute.bridge.mayan_legs.resolved', {
    destinationChainId: bridge.chainID,
    legs: intent.selectedSources.map((s) => ({
      chainId: s.chain.id,
      token: s.token.contractAddress,
      rffValueRaw: s.amountRaw.toString(),
      mayanEffectiveAmountIn: asRecord(s.mayanQuote).effectiveAmountIn,
      mayanMinReceived: asRecord(s.mayanQuote).minReceived,
    })),
  });

  const runApprove = (asset: BridgeAsset, fundingCalls: SBCCall[]) =>
    (async () => {
      ctx.onProgress?.({ stepType: 'bridge_deposit', chainId: asset.chainID, state: 'started' });

      const totalBalanceRaw = mulDecimals(
        asset.eoaBalance.plus(asset.ephemeralBalance),
        asset.decimals
      );
      const vaultAddress = ctx.chainList.getVaultContractAddress(asset.chainID);
      // The exact allowance this leg grants the vault. If approveRaw < the matching
      // :mayan:legs rffValueRaw, the sponsored depositMayan() will revert "exceeds allowance".
      logger.debug('swap.execute.bridge.mayan_allowance.resolved', {
        chainId: asset.chainID,
        token: asset.contractAddress,
        vault: vaultAddress,
        approveRaw: totalBalanceRaw.toString(),
        eoaBalance: asset.eoaBalance.toFixed(),
        ephemeralBalance: asset.ephemeralBalance.toFixed(),
      });
      const chain = resolveChain(ctx.chainList, asset.chainID);
      let txHash: Hex;
      if (chainSupports7702(chain)) {
        const calls: SBCCall[] = [
          ...fundingCalls,
          {
            to: asset.contractAddress,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [vaultAddress, totalBalanceRaw],
            }),
            value: 0n,
          },
        ];

        const sbcTx = await createSBCTxFromCalls({
          calls,
          chainID: asset.chainID,
          ephemeralAddress: ctx.ephemeralWallet.address,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient: ctx.publicClientList.get(asset.chainID),
        });

        txHash = await submitBridgeFundingSbc(
          sbcTx,
          asset.chainID,
          'Swap bridge approve',
          ctx.middlewareClient
        );
      } else {
        // Non-7702: the sponsored depositMayan pulls the COT from the ephemeral. Move it
        // Safe→ephemeral and grant the vault allowance via permit in one Safe batch. When a source
        // swap funded the Safe the COT already sits there (eoaBalance == 0 ⇒ fundingCalls empty); on
        // the fast path it's still at the EOA, so prepend the EOA→Safe funding (permit + transferFrom)
        // — without it the Safe holds zero and the Safe→ephemeral transfer reverts (GS013).
        const publicClient = ctx.publicClientList.get(asset.chainID);
        const { address: safeAddress } = predictSafeAccountAddress(ctx.ephemeralWallet.address);
        await ensureSafeForEphemeral({
          chainId: asset.chainID,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          middleware: ctx.middlewareClient,
        });
        const deadline =
          BigInt(Math.floor(Date.now() / 1000)) + BRIDGE_VAULT_PERMIT_DEADLINE_SECONDS;
        const safeCalls = [
          ...fundingCalls,
          ...(await buildSafeTransferAndPermitCalls({
            asset,
            depositValue: totalBalanceRaw,
            vaultAddress,
            chain,
            chainList: ctx.chainList,
            ephemeralWallet: ctx.ephemeralWallet,
            publicClient,
            deadline,
          })),
        ];
        const request = await createSafeExecuteTxFromCalls({
          calls: safeCalls,
          chainId: asset.chainID,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          safeAddress,
        });
        const result = await ctx.middlewareClient.createSafeExecuteTx(request);
        txHash = result.txHash;
      }
      const explorerUrl = createExplorerTxURL(txHash, chain.blockExplorers?.default?.url ?? '');

      if (hasEoaFunding(asset)) {
        ctx.onProgress?.({
          stepType: 'eoa_to_ephemeral_transfer',
          chainId: asset.chainID,
          state: 'submitted',
          txHash,
          explorerUrl,
        });
      }
      ctx.onProgress?.({
        stepType: 'bridge_deposit',
        chainId: asset.chainID,
        state: 'submitted',
        txHash,
        explorerUrl,
      });

      await confirmStepReceipt(ctx.publicClientList.get(asset.chainID), txHash, asset.chainID, {
        stepId: createBridgeDepositStepId(asset.chainID),
        stepType: 'bridge_deposit',
        label: 'Bridge approve',
      });

      if (hasEoaFunding(asset)) {
        ctx.onProgress?.({
          stepType: 'eoa_to_ephemeral_transfer',
          chainId: asset.chainID,
          state: 'confirmed',
          txHash,
          explorerUrl,
        });
      }
      ctx.onProgress?.({
        stepType: 'bridge_deposit',
        chainId: asset.chainID,
        state: 'confirmed',
        txHash,
        explorerUrl,
      });
    })();

  const approveTasks: Array<{ chainId: number; task: Promise<void> }> = [];
  let fundingError: unknown;
  for (const asset of bridgedAssets) {
    // Native legs can't be ERC-20-approved or sponsor-deposited — the EOA submits depositMayan for
    // them below (and reports the tx), so skip the approve here.
    if (isNativeAddress(asset.contractAddress)) continue;
    try {
      const fundingCalls = await withTimingSpan(
        ctx.timing,
        'flow.swap.execute.bridge.prepare_funding',
        async () => resolveFundingTransferCalls(asset, ctx),
        { tags: { provider: 'mayan' } }
      );
      approveTasks.push({
        chainId: asset.chainID,
        task: withTimingSpan(
          ctx.timing,
          'flow.swap.execute.bridge.deposit',
          async () => runApprove(asset, fundingCalls),
          { tags: { provider: 'mayan' } }
        ),
      });
    } catch (error) {
      fundingError = error;
      break;
    }
  }
  const approveResults = await Promise.allSettled(approveTasks.map((entry) => entry.task));
  if (fundingError) throw fundingError;
  const failedApprove = approveResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failedApprove) throw failedApprove.reason;

  // Approvals are on-chain; submit the Mayan RFF and let the middleware sponsor
  // depositMayan() for each ERC-20 source (no on-chain action from us beyond
  // this point until the fill arrives).
  ctx.onProgress?.({ stepType: 'bridge_intent_submission', state: 'started' });

  const { depositRequest, rffRequest, signature, requestHash } = await withTimingSpan(
    ctx.timing,
    'flow.swap.execute.bridge.submit_intent',
    async () =>
      createRequestFromIntent(intent, {
        evm: { address: ctx.ephemeralWallet.address, client: ctx.ephemeralWallet },
      }).catch((error) => {
        ctx.onProgress?.({
          stepType: 'bridge_intent_submission',
          state: 'failed',
          error: formatUnknownError(error),
        });
        throw error;
      }),
    { tags: { provider: 'mayan' } }
  );

  const mayanQuotes = intent.selectedSources.flatMap((source) =>
    source.mayanQuote ? [source.mayanQuote] : []
  );

  await withTimingSpan(
    ctx.timing,
    'flow.swap.execute.bridge.submit_intent',
    async () =>
      submitRFFToMiddleware(
        rffRequest,
        signature,
        ctx.middlewareClient,
        requestHash,
        mayanQuotes
      ).catch((error) => {
        ctx.onProgress?.({
          stepType: 'bridge_intent_submission',
          state: 'failed',
          intentRequestHash: requestHash,
          error: formatUnknownError(error),
        });
        throw error;
      }),
    { tags: { provider: 'mayan' } }
  );

  ctx.onProgress?.({
    stepType: 'bridge_intent_submission',
    state: 'completed',
    intentRequestHash: requestHash,
  });

  // Native legs can't be relayed (a sponsored call can't carry `value`), so the EOA submits the
  // payable depositMayan itself and reports each tx so the middleware doesn't also try to deposit it.
  for (const asset of bridgedAssets) {
    if (!isNativeAddress(asset.contractAddress)) continue;
    const chainIndex = depositRequest.sources.findIndex(
      (source) => Number(source.chainID) === asset.chainID
    );
    if (chainIndex < 0) {
      throw Errors.internal(`Deposit request missing source for chain ${asset.chainID}`);
    }
    const mayanQuote = intent.selectedSources.find(
      (source) => source.chain.id === asset.chainID
    )?.mayanQuote;
    if (!mayanQuote) {
      throw Errors.internal(`Mayan quote missing for native source on chain ${asset.chainID}`);
    }
    const chain = resolveChain(ctx.chainList, asset.chainID);
    const vaultAddress = ctx.chainList.getVaultContractAddress(asset.chainID);
    const depositValue = depositRequest.sources[chainIndex].value;
    ctx.onProgress?.({ stepType: 'bridge_deposit', chainId: asset.chainID, state: 'started' });
    const depositCall = {
      to: vaultAddress,
      value: depositValue,
      data: encodeFunctionData({
        abi: VAULT_ABI_MAYAN,
        functionName: 'depositMayan',
        args: [
          toMayanDepositRequest(rffRequest),
          signature,
          BigInt(chainIndex),
          encodeMayanRouteData(await getRoutesDataFromQuote(mayanQuote)),
        ],
      }),
    };
    const txHash = await withTimingSpan(
      ctx.timing,
      'flow.swap.execute.bridge.deposit',
      async () => {
        const submittedTxHash = await submitNativeBridgeDepositViaEoa({
          asset,
          chain,
          depositCall,
          depositValue,
          ctx,
        });
        await confirmStepReceipt(
          ctx.publicClientList.get(asset.chainID),
          submittedTxHash,
          asset.chainID,
          {
            stepId: createBridgeDepositStepId(asset.chainID),
            stepType: 'bridge_deposit',
            label: 'Mayan native bridge deposit',
          }
        );
        await ctx.middlewareClient.reportMayanNativeTx(requestHash, {
          source_index: chainIndex,
          tx_hash: submittedTxHash,
        });
        return submittedTxHash;
      },
      { tags: { provider: 'mayan' } }
    );
    const explorerUrl = createExplorerTxURL(txHash, chain.blockExplorers?.default?.url ?? '');
    ctx.onProgress?.({
      stepType: 'bridge_deposit',
      chainId: asset.chainID,
      state: 'confirmed',
      txHash,
      explorerUrl,
    });
  }

  ctx.onProgress?.({
    stepType: 'bridge_fill',
    state: 'waiting',
    intentRequestHash: requestHash,
  });

  await withTimingSpan(
    ctx.timing,
    'flow.swap.execute.bridge.wait_fill',
    async () =>
      waitForFill({
        requestHash,
        middlewareClient: ctx.middlewareClient,
        dstChain: resolveChain(ctx.chainList, bridge.chainID),
        chainList: ctx.chainList,
        fillTimeoutMinutes: 2,
      }).catch(async (error) => {
        // [DEBUG-LOG] Pull the RFF's per-leg status so the failing leg's depositMayan calldata +
        // revert reason land in the logs alongside the amounts this SDK sized — best-effort.
        let bridgeLegs: unknown;
        try {
          const rff = await ctx.middlewareClient.getRFF(requestHash);
          bridgeLegs = rff.bridgeLegs?.map((leg) => ({
            sourceIndex: leg.sourceIndex,
            status: leg.status,
            txHash: leg.txHash,
            error: leg.error,
          }));
        } catch (fetchError) {
          bridgeLegs = `getRFF failed: ${formatUnknownError(fetchError)}`;
        }
        logger.error('[DEBUG-LOG] executeSwapBridge:mayan:fill_failed', {
          requestHash,
          destinationChainId: bridge.chainID,
          sdkLegs: intent.selectedSources.map((s) => ({
            chainId: s.chain.id,
            token: s.token.contractAddress,
            rffValueRaw: s.amountRaw.toString(),
            mayanMinReceived: asRecord(s.mayanQuote).minReceived,
          })),
          bridgeLegs,
          error: formatUnknownError(error),
        });
        ctx.onProgress?.({
          stepType: 'bridge_fill',
          state: 'failed',
          intentRequestHash: requestHash,
          error: formatUnknownError(error),
        });
        throw error;
      }),
    { tags: { provider: 'mayan' } }
  );

  ctx.onProgress?.({
    stepType: 'bridge_fill',
    state: 'completed',
    intentRequestHash: requestHash,
  });

  metadata.intent_request_hash = requestHash;
  metadata.has_xcs = true;
};

// The route-time Mayan quotes (bridge.mayanQuotesBySource, from enrichMayanBridge) were signed
// against the route's ESTIMATED bridge amounts. A source-swap retry (requoteFailedChains) rebases
// the executed COT output, so the merged bridgedAssets — and the RFF source `value` derived from
// them — drift from what the quote signed. Mayan's SWIFT order is signed for an EXACT input, and the
// middleware rejects the RFF ("Mayan quote amount mismatch for source N") when
// value !== effectiveAmountIn. Re-quote here against the FINAL bridged amounts (identical sizing to
// createSwapBridgeIntent's `amountRaw`) so the signed input matches the deposit exactly; this also
// refreshes the order deadline the source stage may have aged.
export const refreshMayanQuotesForExecution = async (
  bridge: NonNullable<SwapRoute['bridge']>,
  bridgedAssets: BridgeAsset[],
  middlewareClient: ExecutionContext['middlewareClient']
): Promise<NonNullable<SwapRoute['bridge']>> => {
  const quotes = await quoteMayanLegs(middlewareClient, {
    legs: bridgedAssets.map((asset) => ({
      chainId: asset.chainID,
      tokenAddress: asset.contractAddress,
      amountRaw: mulDecimals(asset.eoaBalance.plus(asset.ephemeralBalance), asset.decimals),
    })),
    destination: { chainId: bridge.chainID, tokenAddress: bridge.tokenAddress },
  });
  const grossBridged = bridgedAssets.reduce(
    (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
    new Decimal(0)
  );
  const protectedDelivered = quotes.reduce(
    (sum, quote) => sum.plus(new Decimal(quote.quote.minReceived.toString())),
    new Decimal(0)
  );
  const haircut = Decimal.max(grossBridged.minus(protectedDelivered), new Decimal(0));
  return {
    ...bridge,
    amount: grossBridged,
    amounts: {
      tokenAmount: Decimal.max(protectedDelivered.minus(bridge.amounts.gasInCot), new Decimal(0)),
      gasInCot: bridge.amounts.gasInCot,
      totalAmount: grossBridged,
    },
    estimatedFees: {
      collection: new Decimal(0),
      fulfilment: new Decimal(0),
      caGas: new Decimal(0),
      protocol: haircut,
      solver: new Decimal(0),
    },
    mayanQuotesBySource: new Map(
      quotes.map((quote) => [`${quote.chainId}:${quote.tokenAddress.toLowerCase()}`, quote.quote])
    ),
  };
};

const executeEphemeralBridgePath = async (
  bridge: NonNullable<SwapRoute['bridge']>,
  bridgedAssets: BridgeAsset[],
  ctx: Pick<
    ExecutionContext,
    | 'cache'
    | 'chainList'
    | 'destinationDirectEoa'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'intentExplorerUrl'
    | 'middlewareClient'
    | 'onProgress'
    | 'preparedExecution'
    | 'publicClientList'
    | 'timing'
  >,
  metadata: SwapMetadata
) => {
  const destinationChain = resolveChain(ctx.chainList, bridge.chainID);
  const recipient = resolveBridgeRecipient({
    destinationDirectEoa: ctx.destinationDirectEoa,
    destinationChain,
    eoaAddress: ctx.eoaAddress,
    ephemeralAddress: ctx.ephemeralWallet.address,
  });
  // Mayan: re-quote against the FINAL bridged amounts before building the intent, so the signed
  // order input matches the RFF deposit value exactly (route-time quotes can drift after a
  // source-swap retry). Nexus deposits whatever the executed amount is — no signed quote, no drift.
  const intentBridge =
    bridge.provider === 'mayan'
      ? await withTimingSpan(
          ctx.timing,
          'flow.swap.execute.bridge.refresh_mayan_quotes',
          async () => refreshMayanQuotesForExecution(bridge, bridgedAssets, ctx.middlewareClient),
          { tags: { provider: 'mayan', source_chain_count: bridgedAssets.length } }
        )
      : bridge;
  const intent = createSwapBridgeIntent({
    bridge: intentBridge,
    assets: bridgedAssets,
    chainList: ctx.chainList,
    recipient,
    ephemeralAddress: ctx.ephemeralWallet.address,
  });

  if (intent.provider === 'mayan') {
    await runMayanEphemeralBridge(intent, intentBridge, bridgedAssets, ctx, metadata);
    return;
  }

  ctx.onProgress?.({
    stepType: 'bridge_intent_submission',
    state: 'started',
  });

  const { depositRequest, rffRequest, signature, requestHash } = await withTimingSpan(
    ctx.timing,
    'flow.swap.execute.bridge.submit_intent',
    async () =>
      createRequestFromIntent(intent, {
        evm: { address: ctx.ephemeralWallet.address, client: ctx.ephemeralWallet },
      }).catch((error) => {
        ctx.onProgress?.({
          stepType: 'bridge_intent_submission',
          state: 'failed',
          error: formatUnknownError(error),
        });
        throw error;
      }),
    { tags: { provider: 'nexus' } }
  );

  await withTimingSpan(
    ctx.timing,
    'flow.swap.execute.bridge.submit_intent',
    async () =>
      submitRFFToMiddleware(rffRequest, signature, ctx.middlewareClient, requestHash).catch(
        (error) => {
          ctx.onProgress?.({
            stepType: 'bridge_intent_submission',
            state: 'failed',
            intentRequestHash: requestHash,
            error: formatUnknownError(error),
          });
          throw error;
        }
      ),
    { tags: { provider: 'nexus' } }
  );

  ctx.onProgress?.({
    stepType: 'bridge_intent_submission',
    state: 'completed',
    intentRequestHash: requestHash,
  });

  logger.debug('swap.execute.bridge.funding_batch.started', {
    chains: bridgedAssets.map((asset) => asset.chainID),
    eoaFundedChains: bridgedAssets.filter(hasEoaFunding).map((asset) => asset.chainID),
  });

  const bridgeDepositTasks: Array<{ chainId: number; task: Promise<void> }> = [];

  const startBridgeDepositTask = (asset: BridgeAsset, fundingCalls: SBCCall[]) =>
    (async () => {
      logger.debug('swap.execute.bridge.deposit_sbc_build.started', {
        chainId: asset.chainID,
      });
      ctx.onProgress?.({
        stepType: 'bridge_deposit',
        chainId: asset.chainID,
        state: 'started',
      });

      const chainIndex = depositRequest.sources.findIndex(
        (source) => Number(source.chainID) === asset.chainID
      );
      if (chainIndex < 0) {
        throw Errors.internal(`Deposit request missing source for chain ${asset.chainID}`);
      }

      const chain = resolveChain(ctx.chainList, asset.chainID);
      const vaultAddress = ctx.chainList.getVaultContractAddress(asset.chainID);
      const nativeAsset = isNativeAddress(asset.contractAddress);
      // depositRequest.sources[i].value carries the raw token amount; for a native source that
      // value is the wei the payable deposit must forward to the vault.
      const depositValue = depositRequest.sources[chainIndex].value;
      let txHash: Hex;
      if (nativeAsset) {
        // Phase 1b: native bridge deposits are EOA-submitted payable — the relay can't carry
        // `value`. A single value-inline deposit, no approve/permit/transfer/sweep (native has
        // none of those mechanics; the native is already at the EOA, no funding transfer).
        const nativeDepositCall = {
          to: vaultAddress,
          value: depositValue,
          data: encodeFunctionData({
            abi: EVMVaultABI,
            functionName: 'deposit',
            args: [depositRequest, signature, BigInt(chainIndex)],
          }),
        };
        txHash = await submitNativeBridgeDepositViaEoa({
          asset,
          chain,
          depositCall: nativeDepositCall,
          depositValue,
          ctx,
        });
      } else if (chain && !chainSupports7702(chain)) {
        // Non-7702 source chain → v1's Safe `safe_account` mode batch: per-asset
        // transfer→permit→deposit→approve(Sweeper)→sweep. When a source swap funded the Safe its
        // output already sits there (eoaBalance == 0 ⇒ fundingCalls empty); on the fast path the
        // COT is still at the EOA, so prepend the EOA→Safe funding (permit + transferFrom) — without
        // it the Safe holds zero and the deposit's transfer reverts (GS013).
        const publicClient = ctx.publicClientList.get(asset.chainID);
        const { address: safeAddress } = predictSafeAccountAddress(ctx.ephemeralWallet.address);
        await ensureSafeForEphemeral({
          chainId: asset.chainID,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          middleware: ctx.middlewareClient,
        });
        const deadline =
          BigInt(Math.floor(Date.now() / 1000)) + BRIDGE_VAULT_PERMIT_DEADLINE_SECONDS;
        const safeCalls = [
          ...fundingCalls,
          ...(await buildSafeBridgeDepositCalls({
            asset,
            depositValue: depositRequest.sources[chainIndex].value,
            vaultAddress,
            chain,
            chainList: ctx.chainList,
            ephemeralWallet: ctx.ephemeralWallet,
            publicClient,
            depositRequest,
            signature,
            chainIndex,
            deadline,
          })),
        ];
        const request = await createSafeExecuteTxFromCalls({
          calls: safeCalls,
          chainId: asset.chainID,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          safeAddress,
        });
        const result = await ctx.middlewareClient.createSafeExecuteTx(request);
        txHash = result.txHash;
      } else {
        // 7702 chain: existing Calibur SBC path. Build approve(vault)+deposit+sweep on the
        // ephemeral smart account (msg.sender == ephemeral); funding calls come from the
        // pre-built EOA→ephemeral transfer authorization.
        const calls = [...fundingCalls];
        const totalBalanceRaw = mulDecimals(
          asset.eoaBalance.plus(asset.ephemeralBalance),
          asset.decimals
        );
        calls.push({
          to: asset.contractAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [vaultAddress, totalBalanceRaw],
          }),
          value: 0n,
        });
        calls.push({
          to: vaultAddress,
          data: encodeFunctionData({
            abi: EVMVaultABI,
            functionName: 'deposit',
            args: [depositRequest, signature, BigInt(chainIndex)],
          }),
          value: 0n,
        });
        // No COT sweep: Seam 1 bridges the actual wrapper balance, so approve(vault, total) + deposit
        // drain the ephemeral — nothing residual to sweep. The surplus is consolidated at the
        // destination (EXACT_OUT direct transfer / EXACT_IN grown swap), not returned per source chain.
        const sbcTx = await createSBCTxFromCalls({
          calls,
          chainID: asset.chainID,
          ephemeralAddress: ctx.ephemeralWallet.address,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient: ctx.publicClientList.get(asset.chainID),
        });

        logger.debug('swap.execute.bridge.deposit_sbc_build.completed', {
          chainId: asset.chainID,
        });
        logger.debug('swap.execute.bridge.deposit_sbc_dispatch.started', {
          chainId: asset.chainID,
        });

        txHash = await submitBridgeFundingSbc(
          sbcTx,
          asset.chainID,
          'Swap bridge deposit',
          ctx.middlewareClient
        );

        logger.debug('swap.execute.bridge.deposit_sbc_dispatch.completed', {
          chainId: asset.chainID,
        });
      }
      const explorerUrl = createExplorerTxURL(txHash, chain.blockExplorers?.default?.url ?? '');

      if (hasEoaFunding(asset) && !nativeAsset) {
        ctx.onProgress?.({
          stepType: 'eoa_to_ephemeral_transfer',
          chainId: asset.chainID,
          state: 'submitted',
          txHash,
          explorerUrl,
        });
      }

      ctx.onProgress?.({
        stepType: 'bridge_deposit',
        chainId: asset.chainID,
        state: 'submitted',
        txHash,
        explorerUrl,
      });

      await confirmStepReceipt(ctx.publicClientList.get(asset.chainID), txHash, asset.chainID, {
        stepId: createBridgeDepositStepId(asset.chainID),
        stepType: 'bridge_deposit',
        label: 'Bridge deposit',
      });

      if (hasEoaFunding(asset) && !nativeAsset) {
        ctx.onProgress?.({
          stepType: 'eoa_to_ephemeral_transfer',
          chainId: asset.chainID,
          state: 'confirmed',
          txHash,
          explorerUrl,
        });
      }

      ctx.onProgress?.({
        stepType: 'bridge_deposit',
        chainId: asset.chainID,
        state: 'confirmed',
        txHash,
        explorerUrl,
      });
    })();

  let fundingError: unknown;
  const fundedChains: number[] = [];
  for (const asset of bridgedAssets) {
    try {
      // Native bridge sources are EOA-submitted payable deposits — no EOA→ephemeral transfer.
      const fundingCalls = isNativeAddress(asset.contractAddress)
        ? []
        : await withTimingSpan(
            ctx.timing,
            'flow.swap.execute.bridge.prepare_funding',
            async () => resolveFundingTransferCalls(asset, ctx),
            { tags: { provider: 'nexus' } }
          );
      fundedChains.push(asset.chainID);
      bridgeDepositTasks.push({
        chainId: asset.chainID,
        task: withTimingSpan(
          ctx.timing,
          'flow.swap.execute.bridge.deposit',
          async () => startBridgeDepositTask(asset, fundingCalls),
          { tags: { provider: 'nexus' } }
        ),
      });
    } catch (error) {
      fundingError = error;
      break;
    }
  }

  logger.debug('swap.execute.bridge.funding_batch.completed', {
    chains: fundedChains,
  });

  const depositTaskResults = await Promise.allSettled(bridgeDepositTasks.map(({ task }) => task));
  const failedDepositTasks = depositTaskResults.flatMap((result, index) => {
    const task = bridgeDepositTasks[index];
    if (!task || result.status !== 'rejected') return [];
    return [{ chainId: task.chainId, reason: result.reason }];
  });

  if (fundingError) {
    for (const failure of failedDepositTasks) {
      logger.error('executeSwapBridge:bridge_deposit:failed_before_funding_error', failure.reason, {
        chainId: failure.chainId,
        fundingError: formatUnknownError(fundingError),
      });
    }
    throw fundingError;
  }

  const [failedDepositTask] = failedDepositTasks;
  if (failedDepositTask) {
    throw failedDepositTask.reason;
  }

  ctx.onProgress?.({
    stepType: 'bridge_fill',
    state: 'waiting',
    intentRequestHash: requestHash,
  });

  await withTimingSpan(
    ctx.timing,
    'flow.swap.execute.bridge.wait_fill',
    async () =>
      waitForFill({
        requestHash,
        middlewareClient: ctx.middlewareClient,
        dstChain: resolveChain(ctx.chainList, bridge.chainID),
        chainList: ctx.chainList,
        fillTimeoutMinutes: DEFAULT_FILL_TIMEOUT_MINUTES,
      }).catch((error) => {
        ctx.onProgress?.({
          stepType: 'bridge_fill',
          state: 'failed',
          intentRequestHash: requestHash,
          error: formatUnknownError(error),
        });
        throw error;
      }),
    { tags: { provider: 'nexus' } }
  );

  ctx.onProgress?.({
    stepType: 'bridge_fill',
    state: 'completed',
    intentRequestHash: requestHash,
  });

  metadata.intent_request_hash = requestHash;
  metadata.has_xcs = true;
};

export const executeSwapBridge = async (
  bridge: NonNullable<SwapRoute['bridge']>,
  assets: BridgeAsset[],
  ctx: Pick<
    ExecutionContext,
    | 'cache'
    | 'chainList'
    | 'destinationDirectEoa'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'intentExplorerUrl'
    | 'middlewareClient'
    | 'onProgress'
    | 'preparedExecution'
    | 'publicClientList'
    | 'timing'
  >,
  metadata: SwapMetadata
): Promise<void> => {
  const bridgedAssets = assets
    .filter(
      (asset) =>
        asset.chainID !== bridge.chainID && (asset.eoaBalance.gt(0) || asset.ephemeralBalance.gt(0))
    )
    .sort((left, right) => left.chainID - right.chainID);
  if (bridgedAssets.length === 0) {
    return;
  }

  await executeEphemeralBridgePath(bridge, bridgedAssets, ctx, metadata);
};
