import type {
  CreateSafeExecuteTxRequest,
  CreateSafeExecuteTxResponse,
  EnsureSafeAccountRequest,
  EnsureSafeAccountResponse,
  GetSafeAccountAddressRequest,
  GetSafeAccountAddressResponse,
} from './types';

// Minimal axios surface this client uses — keeps the dependency narrow so consumers can pass any
// axios-compatible POST-capable instance (the v2 SDK's createMiddlewareClient creates this with
// axios.create()).
export type SafeHttpClient = {
  post: <T>(url: string, body: unknown) => Promise<{ data: T }>;
};

export type SafeMiddlewareClient = {
  getSafeAccountAddress: (
    req: GetSafeAccountAddressRequest
  ) => Promise<GetSafeAccountAddressResponse>;
  ensureSafeAccount: (req: EnsureSafeAccountRequest) => Promise<EnsureSafeAccountResponse>;
  createSafeExecuteTx: (req: CreateSafeExecuteTxRequest) => Promise<CreateSafeExecuteTxResponse>;
};

export function createSafeMiddlewareClient(http: SafeHttpClient): SafeMiddlewareClient {
  return {
    async getSafeAccountAddress(req) {
      const res = await http.post<GetSafeAccountAddressResponse>(
        '/api/v1/get-safe-account-address',
        req
      );
      return res.data;
    },
    async ensureSafeAccount(req) {
      const res = await http.post<EnsureSafeAccountResponse>('/api/v1/ensure-safe-account', req);
      return res.data;
    },
    async createSafeExecuteTx(req) {
      const res = await http.post<CreateSafeExecuteTxResponse>(
        '/api/v1/create-safe-execute-tx',
        req
      );
      return res.data;
    },
  };
}
