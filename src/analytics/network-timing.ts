import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { TimingSpanHooks } from '../domain';

type NetworkTimingOptions = {
  timing?: TimingSpanHooks;
  enabled?: boolean;
  spanName?: string;
};

const DEFAULT_SPAN_NAME = 'network.middleware.request';
const noop = () => {
  // intentional noop
};

export const installAxiosNetworkTiming = (
  client: AxiosInstance,
  options?: NetworkTimingOptions
): (() => void) => {
  const timing = options?.timing;
  const enabled = options?.enabled === true && !!timing;
  if (!enabled) {
    return noop;
  }

  const spanByRequest = new WeakMap<InternalAxiosRequestConfig, string>();
  const spanName = options?.spanName ?? DEFAULT_SPAN_NAME;

  const requestInterceptorId = client.interceptors.request.use((config) => {
    try {
      const spanId = timing.startSpan(spanName, {
        tags: {
          method: (config.method ?? 'GET').toUpperCase(),
          url: config.url ?? '',
        },
      });
      if (spanId) {
        spanByRequest.set(config, spanId);
      }
    } catch {
      // timing must never break requests
    }
    return config;
  });

  const finalize = (
    config: InternalAxiosRequestConfig | undefined,
    result: { success: boolean; error?: Error }
  ) => {
    if (!config) return;
    const spanId = spanByRequest.get(config);
    if (!spanId) return;
    try {
      timing.endSpan(spanId, result);
    } catch {
      // timing must never break requests
    }
    spanByRequest.delete(config);
  };

  const responseInterceptorId = client.interceptors.response.use(
    (response: AxiosResponse) => {
      finalize(response.config, { success: true });
      return response;
    },
    (error: AxiosError) => {
      finalize(error.config, {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return Promise.reject(error);
    }
  );

  return () => {
    try {
      client.interceptors.request.eject(requestInterceptorId);
      client.interceptors.response.eject(responseInterceptorId);
    } catch {
      // noop
    }
  };
};
