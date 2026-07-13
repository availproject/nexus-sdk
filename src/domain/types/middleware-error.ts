// The middleware's typed error contract. The server returns this envelope as the body of every
// HTTP error, and embeds it per-item in SBC/approval result arrays. Mirrored here (not published in
// `@avail-project/nexus-types`) so the SDK can capture `code`/`subcode`/`errorId` for SigNoz
// correlation and frontend branching. Parsing is lenient (see `middleware.ts`) so unknown/new
// server codes are captured verbatim rather than rejected.

export const MIDDLEWARE_ERROR_CODES = [
  'INVALID_REQUEST',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'CONFIGURATION_ERROR',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
  'RPC_ERROR',
  'SIMULATION_FAILED',
  'TRANSACTION_REVERTED',
  'QUOTE_UNAVAILABLE',
  'PRICE_UNAVAILABLE',
  'GAS_UNAVAILABLE',
  'CHAIN_NOT_SUPPORTED',
  'TOKEN_NOT_SUPPORTED',
  'INTERNAL_ERROR',
] as const;

export type MiddlewareErrorCode = (typeof MIDDLEWARE_ERROR_CODES)[number];

export type MiddlewareErrorEnvelope = {
  code: MiddlewareErrorCode;
  message: string;
  errorId: string;
  subcode?: string;
  details?: Record<string, unknown>;
};
