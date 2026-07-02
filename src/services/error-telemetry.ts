/**
 * Boundary OTel emission for SDK operations.
 *
 * `reportOperationError(...)` is called from every public-method catch (and from the two
 * exported utility helpers) to produce a single, flattened OTel log record per failure.
 *
 * Design (see ai-error-otel.md rev 10):
 *   1. Sanitize params/options first (bigint→string, hex truncation, signature redaction,
 *      depth + array caps, drop functions/providers).
 *   2. Flatten an explicit allow-list of real public field names onto top-level attributes
 *      (`params.toChainId`, `options.slippageTolerance`, etc.) so SigNoz alerts can filter
 *      without JSON parsing.
 *   3. Retain the full sanitized blob as `params.raw` / `options.raw` for forensics.
 *   4. Emit `error.{name,category,code,service,message,context.*,details,stack}`
 *      with `operation` + `operation.id` correlating to the client's PerformanceTracker id
 *      (or the sentinel `'no_analytics'` for utility helpers). Errors are flat — no cause
 *      chain, so no `error.chain` / `error.rootCause.*`.
 *
 * Emits via the live `telemetryLogger` binding from `./telemetry`. No-ops silently if the
 * logger is null (pre-`initialize()`). Wraps emit in try/catch so telemetry never crashes the
 * SDK.
 */

import { type AnyValueMap, SeverityNumber } from '@opentelemetry/api-logs';
import type { OperationName } from '../domain/errors';
import { NexusError } from '../domain/errors';
import { telemetryLogger } from './telemetry';

export interface ReportOperationErrorInput {
  operation: OperationName;
  /** PerformanceTracker id from `analytics.startOperation(...)`, or the literal `'no_analytics'` for utility-helper boundaries. */
  operationId: string;
  params?: unknown;
  options?: unknown;
  error: unknown;
}

// ── Flattening allow-list — real public field names verified against the SDK types.
// Adding a queryable field requires updating BOTH the public param/option type AND this list.

export const PARAMS_FLATTEN_KEYS = [
  // bridge / transfer / bridgeAndExecute (BridgeParams, TransferParams, BridgeAndExecuteParams)
  'toChainId',
  'toTokenSymbol',
  'toAmountRaw',
  'toNativeAmountRaw',
  'recipient',
  'sources',
  // swap (SwapExactInParams, SwapExactOutParams, SwapAndExecuteParams)
  'toTokenAddress',
  // execute (ExecuteParams, BridgeAndExecuteParams)
  'to',
  'gasPrice',
  'enableTransactionPolling',
  'transactionTimeout',
  'waitForReceipt',
  'receiptTimeout',
  'requiredConfirmations',
  // bridgeAndExecute-only
  'recentApprovalTxHash',
] as const;

export const OPTIONS_FLATTEN_KEYS = [
  // BridgeOperationOptions / BridgeAndExecuteOptions
  'fillTimeoutMinutes',
  // SwapOperationOptions / SwapAndExecuteOptions
  'slippageTolerance',
] as const;

// ── Sanitizer ────────────────────────────────────────────────────────────────

const MAX_DEPTH = 4;
const MAX_ARRAY_LENGTH = 32;
const HEX_REDACT_LENGTH = 12;
const REDACTED = '[redacted]';
const DEPTH_OVERFLOW = '[depth>4]';

const REDACT_KEYS = new Set(['signature', 'signatures', 'privateKey', 'mnemonic']);
const HEX_LENGTH_KEYS = new Set(['abi', 'bytecode', 'calldata', 'data']);

const isHexLong = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) && value.length > HEX_REDACT_LENGTH;

const truncateHex = (value: string): string => `${value.slice(0, 6)}…${value.slice(-4)}`;

const looksLikeProvider = (value: object): boolean =>
  ('request' in value && typeof (value as { request: unknown }).request === 'function') ||
  ('send' in value && typeof (value as { send: unknown }).send === 'function');

const shouldDropValue = (value: unknown): boolean => {
  if (typeof value === 'function') return true;
  if (value instanceof Promise) return true;
  if (value instanceof WeakMap || value instanceof WeakSet) return true;
  if (typeof value === 'object' && value !== null && looksLikeProvider(value)) return true;
  return false;
};

/** Recursive sanitizer. Visits the value and produces a JSON-safe shape. */
export const sanitize = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) return DEPTH_OVERFLOW;

  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return isHexLong(value) ? truncateHex(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (shouldDropValue(value)) return undefined;

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      const head = value.slice(0, MAX_ARRAY_LENGTH).map((v) => sanitize(v, depth + 1));
      head.push(`…(${value.length - MAX_ARRAY_LENGTH} more)`);
      return head;
    }
    return value.map((v) => sanitize(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (REDACT_KEYS.has(key)) {
        out[key] = REDACTED;
        continue;
      }
      if (HEX_LENGTH_KEYS.has(key) && isHexLong(raw)) {
        // `B` here is a length marker (matches the plan example `[hex:402B]` for a 402-char hex string)
        // rather than literal bytes; SigNoz operators read it as "blob of N units, redacted".
        out[key] = `[hex:${raw.length}B]`;
        continue;
      }
      if (shouldDropValue(raw)) continue;
      out[key] = sanitize(raw, depth + 1);
    }
    return out;
  }

  return String(value);
};

/** Stringify a sanitized value, handling bigint + circular refs. */
const safeStringify = (input: unknown): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(input, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
};

// ── Flattening ───────────────────────────────────────────────────────────────

type Attrs = Record<string, unknown>;

const flattenInto = (
  attrs: Attrs,
  prefix: 'params' | 'options',
  sanitized: unknown,
  keys: readonly string[]
): void => {
  if (sanitized === null || sanitized === undefined || typeof sanitized !== 'object') return;
  const record = sanitized as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value === undefined) continue;
    attrs[`${prefix}.${key}`] = value;
  }
};

// ── Error attribute extraction ───────────────────────────────────────────────

const truncatedStack = (error: unknown, frames = 5): string | undefined => {
  if (error instanceof Error && typeof error.stack === 'string') {
    return error.stack.split('\n').slice(0, frames).join('\n');
  }
  return undefined;
};

const extractErrorAttrs = (attrs: Attrs, error: unknown): void => {
  // Identity
  if (error instanceof Error) {
    attrs['error.name'] = error.name || 'Error';
    attrs['error.message'] = error.message;
  } else {
    attrs['error.name'] = 'Error';
    attrs['error.message'] = String(error);
  }

  if (error instanceof NexusError) {
    attrs['error.category'] = error.category;
    attrs['error.code'] = error.code;
    if (error.context.service !== undefined) {
      attrs['error.service'] = error.context.service;
    }
    if (error.context.stepId !== undefined) {
      attrs['error.context.stepId'] = error.context.stepId;
    }
    if (error.context.stepType !== undefined) {
      attrs['error.context.stepType'] = error.context.stepType;
    }
    if (error.context.chainId !== undefined) {
      attrs['error.context.chainId'] =
        typeof error.context.chainId === 'bigint'
          ? error.context.chainId.toString()
          : error.context.chainId;
    }
    if (error.details !== undefined) {
      attrs['error.details'] = safeStringify(sanitize(error.details));
    }
  }

  const stack = truncatedStack(error);
  if (stack !== undefined) attrs['error.stack'] = stack;
};

// ── Entry point ──────────────────────────────────────────────────────────────

export const reportOperationError = (input: ReportOperationErrorInput): void => {
  if (!telemetryLogger) return;

  try {
    const attrs: Attrs = {
      operation: input.operation,
      'operation.id': input.operationId,
    };

    extractErrorAttrs(attrs, input.error);

    if (input.params !== undefined) {
      const sanitizedParams = sanitize(input.params);
      attrs['params.raw'] = safeStringify(sanitizedParams);
      flattenInto(attrs, 'params', sanitizedParams, PARAMS_FLATTEN_KEYS);
    }

    if (input.options !== undefined) {
      const sanitizedOptions = sanitize(input.options);
      attrs['options.raw'] = safeStringify(sanitizedOptions);
      flattenInto(attrs, 'options', sanitizedOptions, OPTIONS_FLATTEN_KEYS);
    }

    const message = input.error instanceof Error ? input.error.message : String(input.error);
    telemetryLogger.emit({
      body: message,
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      attributes: attrs as AnyValueMap,
    });
  } catch (emitErr) {
    // Never let the boundary crash the SDK.
    console.error('reportOperationError: emit failed', emitErr);
  }
};
