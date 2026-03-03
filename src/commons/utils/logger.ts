import type { AnyValue } from '@opentelemetry/api-logs';
import { telemetryLogger } from '../../sdk/ca-base/telemetry';

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

export const setExceptionReporter = (reporter: ExceptionReporter) => {
  state.exceptionReporter = reporter;
};

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
};

export const getLogger = () => {
  return state.logger;
};

class Logger {
  private prefix = 'NEXUS_SDK';

  consoleLog(level: LogLevel, message: string, params?: unknown) {
    if (level < state.logLevel) {
      return;
    }

    switch (level) {
      case LOG_LEVEL.DEBUG:
        console.debug('[DEBUG]', message, params);
        break;
      case LOG_LEVEL.ERROR:
        console.error('[ERROR]', message, params);
        break;
      case LOG_LEVEL.INFO:
        console.info('[INFO]', message, params);
        break;
      case LOG_LEVEL.WARNING:
        console.warn('[WARN]', message, params);
        break;
      default:
        console.log('[LOG]', message, params);
    }
  }

  debug(message: string, params: unknown = {}) {
    this.internalLog(LOG_LEVEL.DEBUG, message, params);
  }

  error(message: string, err?: unknown, params: unknown = {}) {
    if (err instanceof Error) {
      this.internalLog(LOG_LEVEL.ERROR, message, params);
      sendException(JSON.stringify({ error: err.message, message }));
      return;
    }
    if (typeof err === 'string') {
      this.internalLog(LOG_LEVEL.ERROR, message, err);
      sendException(JSON.stringify({ error: err, message }));
    } else {
      this.internalLog(LOG_LEVEL.ERROR, message, undefined);
      sendException(JSON.stringify({ message }));
    }
  }

  info<T>(message: string, params: T = {} as T) {
    this.internalLog(LOG_LEVEL.INFO, message, params);
  }

  internalLog(level: LogLevel, message: string, params?: unknown) {
    const logMessage = `[${this.prefix}] Msg: ${message}\n`;
    if (level === LOG_LEVEL.ERROR || level === LOG_LEVEL.WARNING) {
      const cause =
        params && typeof params === 'object' && 'cause' in params
          ? (params as Error).cause
          : 'unknown|not_mapped';
      try {
        telemetryLogger?.emit({
          body: message,
          severityNumber: level,
          severityText: LOG_LEVEL_NAME[level],
          attributes: {
            cause: cause as AnyValue,
          },
        });
      } catch (error) {
        console.error('Failed to send telemetry logs: ', error);
      }
    }
    this.consoleLog(level, logMessage, params);
  }

  warn(message: string, params: unknown = {}) {
    this.internalLog(LOG_LEVEL.WARNING, message, params);
  }

  timer(label?: string) {
    if (LOG_LEVEL.DEBUG < state.logLevel) {
      return { end: () => {} };
    }
    const timerLabel = `[${this.prefix}] Timer: ${label}`;
    console.time(timerLabel);
    
    return {
      end: () => {
        console.timeEnd(timerLabel);
      }
    };
  }
}

const state: LoggerState = {
  exceptionReporter: null,
  logger: new Logger(),
  logLevel: LOG_LEVEL.NOLOGS,
};

// Export a default logger instance for convenience
export const logger = getLogger();

// Export type for external use
export type { LogLevel, ExceptionReporter };
