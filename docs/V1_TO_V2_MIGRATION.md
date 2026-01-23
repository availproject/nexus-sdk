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
