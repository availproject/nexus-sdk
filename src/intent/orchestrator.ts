import type { Hex } from 'viem';
import { ERROR_CODES, Errors, formatUnknownError, NexusError } from '../domain/errors';
import { runNonBlocking } from '../services/non-blocking';
import type { IntentReporting } from './telemetry';
import type {
  ExecutableIntentQuote,
  IntentApprovalInstruction,
  IntentEvent,
  IntentHookData,
  IntentNativeTransactionInstruction,
  IntentPlanStep,
  IntentRequiredSignature,
  IntentResult,
  IntentSource,
  IntentStatus,
  IntentSubmitRequest,
  IntentSubmitResponse,
  IntentSubmittedSignature,
  IntentTransaction,
} from './types';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 120_000;

type RunIntentInput = {
  requestQuote: () => Promise<ExecutableIntentQuote>;
  refreshQuote?: (sources?: IntentSource[]) => Promise<ExecutableIntentQuote>;
  onIntent?: (data: IntentHookData) => void | Promise<void>;
  onEvent?: (event: IntentEvent) => void;
  pollingIntervalMs?: number;
  timeoutMs?: number;
  reporting?: IntentReporting;
};

type RunIntentDeps = {
  explorerUrl: string;
  approve: (
    instruction: ExecutableIntentQuote['execution']['allowances'][number],
    amountRaw: bigint
  ) => Promise<IntentTransaction>;
  confirmApproval: (transaction: IntentTransaction) => Promise<IntentTransaction>;
  sign: (instruction: IntentRequiredSignature) => Promise<Hex>;
  sendNative: (
    instruction: IntentNativeTransactionInstruction,
    signature: Hex,
    onSubmitted?: (txHash?: Hex) => void
  ) => Promise<IntentTransaction>;
  submit: (request: IntentSubmitRequest) => Promise<IntentSubmitResponse>;
  getStatus: (id: Hex) => Promise<IntentStatus>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const explorerLink = (baseUrl: string, id: Hex) => `${baseUrl.replace(/\/$/, '')}/explore/${id}`;

const intentStepError = (error: unknown, step: IntentPlanStep) => {
  const message = formatUnknownError(error);
  if (!(error instanceof NexusError)) {
    return {
      name: error instanceof Error ? error.name : 'Error',
      message,
    };
  }
  return {
    name: error.name,
    message,
    category: error.category,
    code: error.code,
    service: error.context.service,
    stepId: error.context.stepId ?? step.id,
    stepType: error.context.stepType ?? step.type,
    chainId:
      typeof error.context.chainId === 'bigint'
        ? error.context.chainId.toString()
        : (error.context.chainId ?? ('chainId' in step ? step.chainId : undefined)),
    details: error.details,
  };
};

const assertFresh = (quote: ExecutableIntentQuote, now: number) => {
  if (quote.quote.expiresAt * 1_000 <= now) {
    throw Errors.backend(`Intent quote ${quote.quote.id} expired before submission`, {
      service: 'middleware',
      details: {
        quoteId: quote.quote.id,
        expiresAt: quote.quote.expiresAt,
        reasonBucket: 'expired',
      },
    });
  }
};

const resolveIntentApproval = async (
  initial: ExecutableIntentQuote,
  input: RunIntentInput,
  emit: (event: IntentEvent) => void,
  now: () => number
): Promise<ExecutableIntentQuote> => {
  if (!input.onIntent) return initial;
  let current = initial;
  let accepted = false;

  await new Promise<void>((resolve, reject) => {
    const allow = () => {
      accepted = true;
      resolve();
    };
    const deny = () => reject(Errors.userDeniedIntent());
    const refresh = async (sources?: IntentSource[]) => {
      if (accepted || !input.refreshQuote) return current.quote;
      let refreshed: ExecutableIntentQuote;
      try {
        refreshed = await input.refreshQuote(sources);
        assertFresh(refreshed, now());
      } catch (error) {
        input.reporting?.refreshFailed(error);
        throw error;
      }
      current = refreshed;
      emit({ type: 'quote', quote: current.quote });
      return current.quote;
    };

    Promise.resolve(
      input.onIntent?.({
        quote: current.quote,
        allow,
        deny,
        refresh,
        ...(input.reporting ? { attemptId: input.reporting.attemptId } : {}),
      })
    ).catch(reject);
  });

  return current;
};

export const runIntent = async (
  input: RunIntentInput,
  deps: RunIntentDeps
): Promise<IntentResult> => {
  const now = deps.now ?? Date.now;
  const wait = deps.sleep ?? sleep;
  const emit = (event: IntentEvent) => {
    input.reporting?.observe(event);
    runNonBlocking('IntentEventEmitFailed', () => input.onEvent?.(event), {
      eventType: event.type,
    });
  };
  let committed = false;
  const emitStep = (
    quote: ExecutableIntentQuote,
    stepId: string,
    state: 'started' | 'completed' | 'failed',
    error?: unknown
  ) => {
    const step = quote.quote.plan.steps.find((entry) => entry.id === stepId);
    if (!step) return;
    emit({
      type: 'step',
      step,
      state,
      committed,
      ...(error === undefined
        ? {}
        : { error: formatUnknownError(error), errorDetails: intentStepError(error, step) }),
    });
  };

  let executable = await input.requestQuote();
  assertFresh(executable, now());
  emit({ type: 'quote', quote: executable.quote });
  executable = await resolveIntentApproval(executable, input, emit, now);
  assertFresh(executable, now());

  const approvals = executable.execution.allowances.filter((entry) => entry.deficitRaw > 0n);
  const confirmations: Promise<{
    instruction: IntentApprovalInstruction;
    transaction: IntentTransaction;
    state: 'confirmed' | 'reverted' | 'unconfirmed';
  }>[] = [];
  let approvalFailure:
    | { error: unknown; instruction: IntentApprovalInstruction; service: 'wallet' | 'rpc' }
    | undefined;
  const signatures: IntentSubmittedSignature[] = [];
  for (const instruction of approvals) {
    if (approvalFailure) break;
    const stepId = `approval:${instruction.chainId}:${instruction.tokenAddress}`;
    emitStep(executable, stepId, 'started');
    try {
      if (instruction.authorizationType === 'permit') {
        const requirement = executable.execution.requiredSignatures.find(
          (entry) =>
            entry.kind === 'sourceApproval' &&
            entry.chainId === instruction.chainId &&
            entry.tokenAddress === instruction.tokenAddress
        );
        if (!requirement) {
          throw Errors.backend('Missing Better Intent source approval signature', {
            service: 'middleware',
          });
        }
        const { data: _data, ...envelope } = requirement;
        signatures.push({ ...envelope, signature: await deps.sign(requirement) });
        emitStep(executable, stepId, 'completed');
      } else {
        const transaction = await deps.approve(instruction, instruction.requiredRaw);
        input.reporting?.transaction('approval', transaction);
        // Handle failures immediately so an RPC rejection cannot go unhandled while
        // the next wallet prompt is open. Receipt checks do not hold the wallet queue.
        confirmations.push(
          Promise.resolve()
            .then(() => deps.confirmApproval(transaction))
            .then(
              (confirmed) => {
                emitStep(executable, stepId, 'completed');
                return { instruction, transaction: confirmed, state: 'confirmed' as const };
              },
              (error: unknown) => {
                approvalFailure ??= { error, instruction, service: 'rpc' };
                emitStep(executable, stepId, 'failed', error);
                return {
                  instruction,
                  transaction,
                  state:
                    error instanceof NexusError &&
                    error.code === ERROR_CODES.EXEC_TX_ONCHAIN_REVERTED
                      ? ('reverted' as const)
                      : ('unconfirmed' as const),
                };
              }
            )
        );
      }
    } catch (error) {
      emitStep(executable, stepId, 'failed', error);
      approvalFailure ??= { error, instruction, service: 'wallet' };
      break;
    }
  }

  // Settle every submitted transaction even if a later wallet action was rejected.
  const outcomes = await Promise.all(confirmations);
  if (approvalFailure) {
    const { error, instruction, service } = approvalFailure;
    const failure =
      error instanceof NexusError
        ? error
        : Errors.execution(formatUnknownError(error), { service });
    const ErrorType = failure.constructor as new (
      ...args: ConstructorParameters<typeof NexusError>
    ) => NexusError;
    throw new ErrorType(failure.code, failure.message, {
      context: {
        ...failure.context,
        chainId: instruction.chainId,
        stepId: `approval:${instruction.chainId}:${instruction.tokenAddress}`,
        stepType:
          instruction.authorizationType === 'permit'
            ? 'source_approval_signature'
            : 'erc20_approval',
      },
      details: {
        ...failure.details,
        approvals: outcomes.map(({ instruction, transaction, state }) => ({
          chainId: transaction.chainId,
          tokenAddress: instruction.tokenAddress,
          spender: instruction.spender,
          txHash: transaction.txHash,
          txExplorerUrl: transaction.txExplorerUrl,
          state,
        })),
      },
    });
  }
  const approvalTransactions = outcomes.map(({ transaction }) => transaction);

  emitStep(executable, 'intent-signature', 'started');
  let signature: Hex;
  try {
    assertFresh(executable, now());
    const requirement = executable.execution.requiredSignatures.find(
      (entry) => entry.kind === 'intent'
    );
    if (!requirement) {
      throw Errors.backend('Missing Better Intent intent signature', { service: 'middleware' });
    }
    signature = await deps.sign(requirement);
    const { data: _data, ...envelope } = requirement;
    signatures.unshift({ ...envelope, signature });
    const hasErc20Source =
      executable.execution.nativeTransactions.length < executable.quote.input.length;
    if (hasErc20Source) {
      committed = true;
      input.reporting?.commit();
    }
    emitStep(executable, 'intent-signature', 'completed');
  } catch (error) {
    emitStep(executable, 'intent-signature', 'failed', error);
    throw error;
  }

  const nativeTransactions: IntentTransaction[] = [];
  const nativeTxReceipts: Array<{ sourceIndex: number; txHash: Hex }> = [];
  for (const instruction of executable.execution.nativeTransactions) {
    const stepId = `native:${instruction.chainId}:${instruction.sourceIndex}`;
    emitStep(executable, stepId, 'started');
    let broadcastReported = false;
    try {
      const transaction = await deps.sendNative(instruction, signature, (txHash) => {
        committed = true;
        input.reporting?.commit();
        if (txHash) {
          input.reporting?.transaction('source', {
            chainId: instruction.chainId,
            txHash,
          });
          broadcastReported = true;
        }
      });
      nativeTransactions.push(transaction);
      if (!broadcastReported) input.reporting?.transaction('source', transaction);
      nativeTxReceipts.push({ sourceIndex: instruction.sourceIndex, txHash: transaction.txHash });
      emitStep(executable, stepId, 'completed');
    } catch (error) {
      emitStep(executable, stepId, 'failed', error);
      throw error;
    }
  }

  emitStep(executable, 'intent-submission', 'started');
  try {
    await deps.submit({
      provider: executable.execution.provider,
      rff: executable.execution.rff,
      signatures,
      ...(nativeTxReceipts.length > 0 ? { nativeTxReceipts } : {}),
    });
    emitStep(executable, 'intent-submission', 'completed');
  } catch (error) {
    emitStep(executable, 'intent-submission', 'failed', error);
    throw error;
  }

  emitStep(executable, 'intent-fulfillment', 'started');
  const deadline = now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  while (now() <= deadline) {
    let status: IntentStatus;
    try {
      status = await deps.getStatus(executable.quote.id);
    } catch (error) {
      emitStep(executable, 'intent-fulfillment', 'failed', error);
      throw error;
    }
    const statusEvent: IntentEvent = {
      type: 'status',
      status: status.status,
      substatus: status.substatus,
      intentId: status.id,
      legs: status.legs,
    };
    if (status.status === 'fulfilled') {
      emitStep(executable, 'intent-fulfillment', 'completed');
      emit(statusEvent);
      return {
        ...(input.reporting ? { attemptId: input.reporting.attemptId } : {}),
        intentId: executable.quote.id,
        intentExplorerUrl: explorerLink(deps.explorerUrl, executable.quote.id),
        quote: executable.quote,
        status,
        approvals: approvalTransactions,
        nativeTransactions,
      };
    }
    if (status.status === 'expired') {
      const error = Errors.backend(`Intent ${status.id} expired before fulfillment`, {
        service: 'middleware',
        details: { quoteId: status.id, substatus: status.substatus, reasonBucket: 'expired' },
      });
      emitStep(executable, 'intent-fulfillment', 'failed', error);
      emit(statusEvent);
      throw error;
    }
    emit(statusEvent);
    await wait(input.pollingIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  }

  const timeout = Errors.liquidityTimeout(executable.quote.id);
  emitStep(executable, 'intent-fulfillment', 'failed', timeout);
  throw timeout;
};
