export const LOG_LEVEL = {
  DEBUG: 1,
  ERROR: 4,
  INFO: 2,
  NOLOGS: 5,
  WARNING: 3,
} as const;

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
  private prefix: string = 'NEXUS_SDK';

  consoleLog(level: LogLevel, message: string, params?: unknown) {
    if (level < state.logLevel) {
      return;
    }

    switch (level) {
      case LOG_LEVEL.DEBUG:
        console.debug(`[DEBUG]`, message, params);
        break;
      case LOG_LEVEL.ERROR:
        console.error(`[ERROR]`, message, params);
        break;
      case LOG_LEVEL.INFO:
        console.info(`[INFO]`, message, params);
        break;
      case LOG_LEVEL.WARNING:
        console.warn(`[WARN]`, message, params);
        break;
      default:
        console.log(`[LOG]`, message, params);
    }
  }

  debug(message: string, params: unknown = {}) {
    this.internalLog(LOG_LEVEL.DEBUG, message, params);
  }

  error(message: string, err?: Error | string) {
    if (err instanceof Error) {
      this.internalLog(LOG_LEVEL.ERROR, message, err.message);
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
    this.consoleLog(level, logMessage, params);
  }

  warn(message: string, params: unknown = {}) {
    this.internalLog(LOG_LEVEL.WARNING, message, params);
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
