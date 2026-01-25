# V1 → V2 Migration Guide

## Overview

V2 replaces msgpack WebSocket APIs with REST/JSON APIs via middleware.

## Breaking Changes

### 1. Configuration

**V1:**
```typescript
{ VSC_DOMAIN: 'vsc-mainnet.availproject.org' }
```

**V2:**
```typescript
{
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: true,
}
```

### 2. Balance Response Format

**V1:** Uint8Array fields, msgpack
**V2:** JSON with string chain IDs as keys

**Migration:** SDK handles conversion automatically

### 3. Approval Format

**V1:** msgpack with Uint8Array
**V2:** JSON with hex strings

**Migration:** SDK handles conversion automatically

### 4. RFF Creation

**V1:** Cosmos submit + VSC WebSocket
**V2:** Single POST to middleware

**Migration:** Use `executeV2()` with `useV2Middleware: true`

## Migration Steps

1. Update config to add `MIDDLEWARE_URL` and `useV2Middleware: true`
2. Ensure middleware is running on localhost:3000
3. No code changes needed - SDK handles protocol differences
4. Test with local devnet first

## Rollback

Set `useV2Middleware: false` to use V1 protocol.

## Test Suite Changes

The V2 integration removes all legacy V1 tests in favor of a single comprehensive E2E test:

### Removed Tests
- `test/integration/v2-statekeeper.test.ts` - Used direct statekeeper API (V1)
- `test/integration/v2-e2e.test.ts` - Used direct statekeeper + cast impersonation (V1)
- `test/integration/v2-rpc-balance.test.ts` - Used VSC balance API (V1)

### New Test
- `test/integration/v2-middleware-e2e.test.ts` - Complete V2 middleware E2E test

The new test demonstrates:
1. Balance retrieval via middleware REST API
2. Approval creation via middleware WebSocket
3. RFF submission via middleware REST API
4. RFF status tracking via middleware REST API

Run with:
```bash
pnpm test:v2:middleware
```

Prerequisites:
- Anvil nodes on ports 8545, 8546
- Middleware on port 3000

For production usage examples, see [Next.js V2 Integration Guide](./NEXTJS_V2_INTEGRATION.md).
