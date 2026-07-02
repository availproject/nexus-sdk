import { Errors, formatUnknownError } from '../domain/errors';
import { logger } from '../domain/utils';

type WsRequestErrorMessages = {
  connectionFailed: string;
  invalidResponse: string;
  setup: string;
  socketError: string;
  timeout: string;
};

type WsRequestControls<T> = {
  close: () => void;
  pushResult: (result: T) => void;
  reject: (error: Error) => void;
  results: T[];
};

type WsRequestOptions<T> = {
  errors: WsRequestErrorMessages;
  label: string;
  onMessage: (message: Record<string, unknown>, controls: WsRequestControls<T>) => void;
  onResult?: (result: T) => void;
  payload: unknown;
  timeoutMs?: number;
  url: string;
};

export const wsRequest = <T>(options: WsRequestOptions<T>): Promise<T[]> => {
  const { errors, label, onMessage, onResult, payload, timeoutMs = 120_000, url } = options;

  return new Promise((resolve, reject) => {
    let settled = false;

    const resolveOnce = (value: T[]) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    try {
      logger.debug(`${label}:connecting`, { wsURL: url });

      const ws = new WebSocket(url);
      const results: T[] = [];
      let isConnected = false;

      const close = () => {
        clearTimeout(timeout);
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
      };

      const timeout = setTimeout(() => {
        logger.error(`${label}:timeout`, { results });
        if (ws.readyState !== WebSocket.CLOSED) {
          close();
          rejectOnce(Errors.internal(errors.timeout));
        }
      }, timeoutMs);

      ws.onopen = () => {
        logger.debug(`${label}:connected`);
        isConnected = true;
        ws.send(JSON.stringify(payload));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as Record<string, unknown>;
          logger.debug(`${label}:message`, { message });

          onMessage(message, {
            close,
            pushResult: (result) => {
              results.push(result);
              onResult?.(result);
            },
            reject: rejectOnce,
            results,
          });
        } catch (error) {
          logger.error(`${label}:parseError`, error);
          close();
          rejectOnce(
            Errors.backend(`${errors.invalidResponse}: ${formatUnknownError(error)}`, {
              service: 'middleware',
            })
          );
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        logger.error(`${label}:error`, error);
        rejectOnce(
          Errors.internal(errors.socketError, {
            error: String(error),
          })
        );
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        logger.debug(`${label}:closed`, { results });
        if (isConnected) {
          resolveOnce(results);
        } else {
          rejectOnce(Errors.internal(errors.connectionFailed));
        }
      };
    } catch (error) {
      logger.error(`${label}:error`, error);
      rejectOnce(
        Errors.backend(`${errors.setup}: ${formatUnknownError(error)}`, {
          service: 'middleware',
        })
      );
    }
  });
};
