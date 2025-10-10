export const LOG_LEVEL = {
  DEBUG: 1,
  ERROR: 4,
  INFO: 2,
  NOLOGS: 5,
  WARNING: 3,
};

type ExceptionReporter = ((msg: string) => void) | null;
export const setExceptionReporter = (reporter: (msg: string) => void): void => {
  state.exceptionReporter = reporter;
};

const sendException = (msg: string) => {
  if (state.exceptionReporter) {
    state.exceptionReporter(msg);
  }
};

export const setLogLevel = (level: number): void => {
  state.logLevel = level;
};

export const getLogger = (): Logger => {
  return state.logger;
};

class Logger {
  private prefix = "XAR_CA_SDK";

  consoleLog(level: number, message: string, params: unknown): void {
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

  debug(message: string, params: unknown = {}): void {
    this.internalLog(LOG_LEVEL.DEBUG, message, params);
  }

  error(message: string, err: unknown): void {
    if (err instanceof Error) {
      this.internalLog(LOG_LEVEL.ERROR, message, err.message);
      sendException(JSON.stringify({ error: err.message, message }));
      return;
    }
    if (typeof err == "string") {
      this.internalLog(LOG_LEVEL.ERROR, message, err);
      sendException(JSON.stringify({ error: err, message }));
    }
  }

  info(message: string, params: unknown = {}): void {
    this.internalLog(LOG_LEVEL.INFO, message, params);
  }

  internalLog(level: number, message: string, params: unknown): void {
    const logMessage = `[${this.prefix}] Msg: ${message}\n`;

    this.consoleLog(level, logMessage, params);
  }

  warn(message: string, params: unknown = {}): void {
    this.internalLog(LOG_LEVEL.WARNING, message, params);
  }
}

const state: {
  exceptionReporter: ExceptionReporter | null;
  logger: Logger;
  logLevel: number;
} = {
  exceptionReporter: null,
  logger: new Logger(),
  logLevel: LOG_LEVEL.NOLOGS,
};
