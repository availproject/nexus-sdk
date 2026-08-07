import { type Hex, maxUint256 } from 'viem';
import { Errors, formatUnknownError } from '../domain/errors';
import { runNonBlocking } from '../services/non-blocking';
import type {
  ExecutableIntentQuote,
  IntentAllowanceHookData,
  IntentAllowanceSelection,
  IntentEvent,
  IntentHookData,
  IntentNativeTransactionInstruction,
  IntentResult,
  IntentSource,
  IntentStatus,
  IntentSubmitRequest,
  IntentSubmitResponse,
  IntentTransaction,
} from './types';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 120_000;

type RunIntentInput = {
  requestQuote: () => Promise<ExecutableIntentQuote>;
  refreshQuote?: (sources?: IntentSource[]) => Promise<ExecutableIntentQuote>;
  onIntent?: (data: IntentHookData) => void | Promise<void>;
  onAllowance?: (data: IntentAllowanceHookData) => void | Promise<void>;
  onEvent?: (event: IntentEvent) => void;
  pollingIntervalMs?: number;
  timeoutMs?: number;
};

type RunIntentDeps = {
  explorerUrl: string;
  approve: (
    instruction: ExecutableIntentQuote['execution']['allowances'][number],
    amountRaw: bigint
  ) => Promise<IntentTransaction>;
  sign: (message: Hex) => Promise<Hex>;
  sendNative: (
    instruction: IntentNativeTransactionInstruction,
    signature: Hex
  ) => Promise<IntentTransaction>;
  submit: (request: IntentSubmitRequest) => Promise<IntentSubmitResponse>;
  getStatus: (id: Hex) => Promise<IntentStatus>;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const explorerLink = (baseUrl: string, id: Hex) => `${baseUrl.replace(/\/$/, '')}/explore/${id}`;

const assertFresh = (quote: ExecutableIntentQuote, now: number) => {
  if (quote.quote.expiresAt * 1_000 <= now) {
    throw Errors.backend(`Intent quote ${quote.quote.id} expired before submission`, {
      service: 'middleware',
      details: { quoteId: quote.quote.id, expiresAt: quote.quote.expiresAt },
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
      const refreshed = await input.refreshQuote(sources);
      assertFresh(refreshed, now());
      current = refreshed;
      emit({ type: 'quote', quote: current.quote });
      return current.quote;
    };

    Promise.resolve(input.onIntent?.({ quote: current.quote, allow, deny, refresh })).catch(reject);
  });

  return current;
};

const selectionAmount = (selection: IntentAllowanceSelection, minimum: bigint): bigint => {
  let amount: bigint;
  try {
    amount = selection === 'min' ? minimum : selection === 'max' ? maxUint256 : BigInt(selection);
  } catch {
    throw Errors.invalidInput(`Invalid allowance amount: ${String(selection)}`);
  }
  if (amount < minimum) {
    throw Errors.invalidInput(`Allowance amount ${amount} is below the required amount ${minimum}`);
  }
  return amount;
};

const resolveAllowanceAmounts = async (
  quote: ExecutableIntentQuote,
  hook?: RunIntentInput['onAllowance']
): Promise<bigint[]> => {
  const required = quote.execution.allowances.filter((entry) => entry.deficitRaw > 0n);
  if (required.length === 0) return [];
  if (!hook) return required.map((entry) => entry.requiredRaw);

  const selections = await new Promise<IntentAllowanceSelection[]>((resolve, reject) => {
    const allow = (values?: IntentAllowanceSelection[]) => {
      const resolved = values ?? required.map(() => 'min' as const);
      if (resolved.length !== required.length) {
        reject(Errors.invalidAllowance(required.length, resolved.length));
        return;
      }
      resolve(resolved);
    };
    const deny = () => reject(Errors.userRejectedAllowance());
    Promise.resolve(
      hook({ allowances: required.map(({ approval: _approval, ...entry }) => entry), allow, deny })
    ).catch(reject);
  });

  return selections.map((selection, index) =>
    selectionAmount(selection, required[index]?.requiredRaw ?? 0n)
  );
};

export const runIntent = async (
  input: RunIntentInput,
  deps: RunIntentDeps
): Promise<IntentResult> => {
  const now = deps.now ?? Date.now;
  const wait = deps.sleep ?? sleep;
  const emit = (event: IntentEvent) =>
    runNonBlocking('IntentEventEmitFailed', () => input.onEvent?.(event), {
      eventType: event.type,
    });
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
      ...(error === undefined ? {} : { error: formatUnknownError(error) }),
    });
  };

  let executable = await input.requestQuote();
  assertFresh(executable, now());
  emit({ type: 'quote', quote: executable.quote });
  executable = await resolveIntentApproval(executable, input, emit, now);
  assertFresh(executable, now());

  const approvals = executable.execution.allowances.filter((entry) => entry.deficitRaw > 0n);
  const approvalAmounts = await resolveAllowanceAmounts(executable, input.onAllowance);
  const approvalTransactions: IntentTransaction[] = [];
  for (let index = 0; index < approvals.length; index += 1) {
    const instruction = approvals[index];
    if (!instruction) continue;
    const stepId = `approval:${instruction.chainId}:${instruction.tokenAddress}`;
    emitStep(executable, stepId, 'started');
    try {
      approvalTransactions.push(
        await deps.approve(instruction, approvalAmounts[index] ?? instruction.requiredRaw)
      );
      emitStep(executable, stepId, 'completed');
    } catch (error) {
      emitStep(executable, stepId, 'failed', error);
      throw error;
    }
  }

  emitStep(executable, 'intent-signature', 'started');
  let signature: Hex;
  try {
    signature = await deps.sign(executable.execution.signing.message);
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
    try {
      const transaction = await deps.sendNative(instruction, signature);
      nativeTransactions.push(transaction);
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
      rffSignature: signature,
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
    const status = await deps.getStatus(executable.quote.id);
    const statusEvent: IntentEvent = {
      type: 'status',
      status: status.status,
      substatus: status.substatus,
      intentId: status.id,
    };
    if (status.status === 'fulfilled') {
      emitStep(executable, 'intent-fulfillment', 'completed');
      emit(statusEvent);
      return {
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
        details: { quoteId: status.id, substatus: status.substatus },
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
