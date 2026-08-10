import type {
  CreateSafeExecuteTxRequest,
  CreateSafeExecuteTxResponse,
  CreateSafeExecuteTxV2Request,
  CreateSafeExecuteTxV2Response,
  EnsureSafeAccountRequest,
  EnsureSafeAccountResponse,
  EnsureSafeAccountV2Request,
  EnsureSafeAccountV2Response,
  GetSafeAccountAddressRequest,
  GetSafeAccountAddressResponse,
  GetSafeAccountAddressV2Request,
  GetSafeAccountAddressV2Response,
} from './types';

// Minimal axios surface this client uses — keeps the dependency narrow so consumers can pass any
// axios-compatible POST-capable instance (the v2 SDK's createMiddlewareClient creates this with
// axios.create()).
export type SafeHttpClient = {
  post: <T>(url: string, body: unknown) => Promise<{ data: T }>;
};

/** @deprecated V1 Safe middleware contract. Use SafeMiddlewareClientV2. */
export type SafeMiddlewareClient = {
  getSafeAccountAddress: (
    req: GetSafeAccountAddressRequest
  ) => Promise<GetSafeAccountAddressResponse>;
  ensureSafeAccount: (req: EnsureSafeAccountRequest) => Promise<EnsureSafeAccountResponse>;
  createSafeExecuteTx: (req: CreateSafeExecuteTxRequest) => Promise<CreateSafeExecuteTxResponse>;
};

export type SafeMiddlewareClientV2 = {
  getSafeAccountAddress: (
    req: GetSafeAccountAddressV2Request
  ) => Promise<GetSafeAccountAddressV2Response>;
  ensureSafeAccount: (req: EnsureSafeAccountV2Request) => Promise<EnsureSafeAccountV2Response>;
  createSafeExecuteTx: (
    req: CreateSafeExecuteTxV2Request
  ) => Promise<CreateSafeExecuteTxV2Response>;
};

/** @deprecated Uses legacy /api/v1 Safe endpoints. Use createSafeMiddlewareClientV2. */
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

export function createSafeMiddlewareClientV2(http: SafeHttpClient): SafeMiddlewareClientV2 {
  return {
    async getSafeAccountAddress(req) {
      const res = await http.post<GetSafeAccountAddressV2Response>(
        '/api/v2/get-safe-account-address',
        req
      );
      return res.data;
    },
    async ensureSafeAccount(req) {
      const res = await http.post<EnsureSafeAccountV2Response>('/api/v2/ensure-safe-account', req);
      return res.data;
    },
    async createSafeExecuteTx(req) {
      const res = await http.post<CreateSafeExecuteTxV2Response>(
        '/api/v2/create-safe-execute-tx',
        req
      );
      return res.data;
    },
  };
}
