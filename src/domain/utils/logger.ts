import type { AnyValue } from '@opentelemetry/api-logs';
import { telemetryLogger } from '../../services/telemetry';

export const LOG_LEVEL = {
  DEBUG: 1,
  ERROR: 4,
  INFO: 2,
  NOLOGS: 5,
  WARNING: 3,
} as const;

export const LOG_LEVEL_NAME: Record<LogLevel, string> = {
  [LOG_LEVEL.DEBUG]: 'DEBUG',
  [LOG_LEVEL.ERROR]: 'ERROR',
  [LOG_LEVEL.INFO]: 'INFO',
  [LOG_LEVEL.NOLOGS]: 'NOLOGS',
  [LOG_LEVEL.WARNING]: 'WARNING',
};

type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];
type ExceptionReporter = (message: string) => void;

interface LoggerState {
  exceptionReporter: ExceptionReporter | null;
  logger: Logger;
  logLevel: LogLevel;
}

const sendException = (msg: string) => {
  if (!state.exceptionReporter) return;
  try {
    state.exceptionReporter(msg);
  } catch (reportErr) {
    console.error('[LOGGER] Exception reporter threw:', reportErr);
  }
};

export const setLogLevel = (level: LogLevel) => {
  state.logLevel = level;
  state.logger.setLevel(level);
};

export const getLogger = () => {
  return state.logger;
};

/**
 * Vendored (TypeScript) minimal logger core inspired by loglevel:
 * https://github.com/pimterry/loglevel
 * Original package license: MIT
 */
type ConsoleMethod = (...args: unknown[]) => void;
type ConsoleLike = Partial<
  Record<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'log', ConsoleMethod>
>;
const noop: ConsoleMethod = () => {
  // intentional noop
};

type ErrorRecord = {
  name?: string;
  message?: string;
  stack?: string;
  [key: string]: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toErrorRecord = (err: unknown): ErrorRecord | undefined => {
  if (err == null) return undefined;
  if (err instanceof Error) {
    const out: ErrorRecord = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };

    // Preserve custom enumerable fields from custom error classes
    for (const [key, value] of Object.entries(err as unknown as Record<string, unknown>)) {
      if (!(key in out)) out[key] = value;
    }
    return out;
  }

  if (typeof err === 'string') return { message: err };
  if (isRecord(err)) return { ...err };
  return { message: String(err) };
};

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

const defaultConsoleMethodFactory = (level: LogLevel): ConsoleMethod => {
  if (level === LOG_LEVEL.NOLOGS) return noop;
  const c = console as ConsoleLike;
  const preferred =
    level === LOG_LEVEL.DEBUG
      ? (c.debug ?? c.log)
      : level === LOG_LEVEL.INFO
        ? (c.info ?? c.log)
        : level === LOG_LEVEL.WARNING
          ? (c.warn ?? c.log)
          : (c.error ?? c.log);
  return (preferred ?? noop).bind(console);
};

class Logger {
  private readonly prefix = 'NEXUS_SDK';
  private methodFactory: (level: LogLevel) => ConsoleMethod = defaultConsoleMethodFactory;
  private methods: Record<LogLevel, ConsoleMethod> = {
    [LOG_LEVEL.DEBUG]: noop,
    [LOG_LEVEL.INFO]: noop,
    [LOG_LEVEL.WARNING]: noop,
    [LOG_LEVEL.ERROR]: noop,
    [LOG_LEVEL.NOLOGS]: noop,
  };

  constructor() {
    this.rebuildMethods();
  }

  setMethodFactory(factory: (level: LogLevel) => ConsoleMethod): void {
    this.methodFactory = factory;
    this.rebuildMethods();
  }

  setLevel(level: LogLevel): void {
    state.logLevel = level;
    this.rebuildMethods();
  }

  getLevel(): LogLevel {
    return state.logLevel;
  }

  private rebuildMethods(): void {
    const currentLevel = state.logLevel;
    for (const level of [
      LOG_LEVEL.DEBUG,
      LOG_LEVEL.INFO,
      LOG_LEVEL.WARNING,
      LOG_LEVEL.ERROR,
      LOG_LEVEL.NOLOGS,
    ] as const) {
      this.methods[level] = level < currentLevel ? noop : this.methodFactory(level);
    }
  }

  private telemetryLog(level: LogLevel, message: string, context?: unknown, error?: unknown): void {
    if (level !== LOG_LEVEL.ERROR && level !== LOG_LEVEL.WARNING) return;

    const serializedError = toErrorRecord(error);
    const cause =
      isRecord(context) && 'cause' in context ? (context.cause as AnyValue) : 'unknown|not_mapped';

    try {
      telemetryLogger?.emit({
        body: message,
        severityNumber: level,
        severityText: LOG_LEVEL_NAME[level],
        attributes: {
          cause,
          errorMessage: serializedError?.message as AnyValue,
          errorName: serializedError?.name as AnyValue,
          stackTrace: serializedError?.stack as AnyValue,
          context: context as AnyValue,
        },
      });
    } catch (emitErr) {
      console.error('Failed to send telemetry logs: ', emitErr);
    }
  }

  private reportException(message: string, context?: unknown, error?: unknown): void {
    if (!state.exceptionReporter) return;
    const payload = {
      message,
      context,
      error: toErrorRecord(error),
    };
    sendException(safeStringify(payload));
  }

  private write(level: LogLevel, message: string, context?: unknown, error?: unknown): void {
    const prefixed = `[${this.prefix}] ${message}`;
    const method = this.methods[level];

    // Keep native Error object in args so browser/node/RN consoles can render stack traces.
    if (error instanceof Error) {
      if (context !== undefined) {
        method(`[${LOG_LEVEL_NAME[level]}]`, prefixed, context, error);
      } else {
        method(`[${LOG_LEVEL_NAME[level]}]`, prefixed, error);
      }
      return;
    }

    if (error !== undefined) {
      const serializedError = toErrorRecord(error);
      if (context !== undefined) {
        method(`[${LOG_LEVEL_NAME[level]}]`, prefixed, context, serializedError);
      } else {
        method(`[${LOG_LEVEL_NAME[level]}]`, prefixed, serializedError);
      }
      return;
    }

    if (context !== undefined) {
      method(`[${LOG_LEVEL_NAME[level]}]`, prefixed, context);
      return;
    }

    method(`[${LOG_LEVEL_NAME[level]}]`, prefixed);
  }

  debug(message: string, params: unknown = {}): void {
    this.write(LOG_LEVEL.DEBUG, message, params);
  }

  info<T>(message: string, params: T = {} as T): void {
    this.write(LOG_LEVEL.INFO, message, params);
  }

  warn(message: string, params: unknown = {}): void {
    this.telemetryLog(LOG_LEVEL.WARNING, message, params);
    this.write(LOG_LEVEL.WARNING, message, params);
  }

  error(message: string, errOrContext?: unknown, params?: unknown): void {
    // Compatibility behavior:
    // 1) error(message, ErrorLike, context)
    // 2) error(message, contextObject)
    // 3) error(message, "string error")
    let err: unknown;
    let context: unknown;

    if (params !== undefined) {
      err = errOrContext;
      context = params;
    } else if (
      errOrContext instanceof Error ||
      typeof errOrContext === 'string' ||
      errOrContext == null
    ) {
      err = errOrContext;
      context = undefined;
    } else if (isRecord(errOrContext)) {
      err = undefined;
      context = errOrContext;
    } else {
      err = errOrContext;
      context = undefined;
    }

    this.telemetryLog(LOG_LEVEL.ERROR, message, context, err);
    this.write(LOG_LEVEL.ERROR, message, context, err);
    this.reportException(message, context, err);
  }
}

const state: LoggerState = {
  exceptionReporter: null,
  logger: {} as Logger,
  logLevel: LOG_LEVEL.NOLOGS,
};

state.logger = new Logger();

export const logger = getLogger();
export type { LogLevel };
