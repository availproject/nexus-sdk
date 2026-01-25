# V2 Middleware Integration Gaps

## Analysis Summary

The SDK has **partial** V2 middleware integration. Here's what's implemented and what's missing:

## ✅ What's Already Implemented

1. **Middleware Utility Functions** (`src/sdk/ca-base/utils/middleware.utils.ts`):
   - ✅ `getBalancesFromMiddleware` - Fetches balances via middleware REST API
   - ✅ `createApprovalsViaMiddleware` - Creates approvals via middleware WebSocket
   - ✅ `submitRffToMiddleware` - Submits RFF via middleware REST API
   - ✅ `getRffFromMiddleware` - Gets RFF status via middleware REST API
   - ✅ `listRffsFromMiddleware` - Lists RFFs via middleware REST API

2. **Bridge Handler V2 Support** (`src/sdk/ca-base/requestHandlers/bridge.ts`):
   - ✅ `executeV2ViaMiddleware` - Executes bridge using middleware
   - ✅ `processRFFv2Middleware` - Submits RFF via middleware
   - ✅ `createApprovalsViaMiddleware` - Creates approvals via middleware
   - ✅ `waitForFillV2` - Waits for RFF fulfillment using statekeeper

3. **Configuration**:
   - ✅ `NetworkConfig` has `MIDDLEWARE_URL` and `useV2Middleware` fields
   - ✅ Config defaults to V1 (`useV2Middleware: false`)

## ❌ What's Missing

### 1. **Balance Fetching Not Integrated with V2**

**Issue**: The `getBalances` function in `src/sdk/ca-base/utils/balance.utils.ts` always uses V1 VSC API, regardless of the `useV2Middleware` flag.

**Current Code** (line 36):
```typescript
getEVMBalancesForAddress(input.vscDomain, input.evmAddress),
```

**Required**: Should conditionally use V2:
```typescript
input.useV2Middleware
  ? getEVMBalancesForAddressV2(input.middlewareUrl, input.evmAddress)
  : getEVMBalancesForAddress(input.vscDomain, input.evmAddress),
```

**Impact**:
- `sdk.getBalancesForBridge()` calls `_getUnifiedBalances()` → calls `getBalances()` → uses V1 API
- Bridge intent building in `buildIntent()` calls `getBalances()` → uses V1 API
- Swap operations call `getBalances()` → uses V1 API

**Files to Update**:
1. `src/sdk/ca-base/utils/balance.utils.ts` - Update `getBalances` signature and implementation
2. `src/sdk/ca-base/ca.ts` - Pass middleware config to `getBalances`
3. `src/sdk/ca-base/requestHandlers/bridge.ts` - Pass middleware config to `getBalances`
4. `src/sdk/ca-base/requestHandlers/bridgeMax.ts` - Pass middleware config to `getBalances`
5. `src/sdk/ca-base/swap/route.ts` - Pass middleware config to `getBalances`

### 2. **Bridge Execution Not Using V2 by Default**

**Issue**: The `BridgeHandler.execute()` method defaults to V1 cosmos chain logic.

**Current Flow**:
```typescript
// In sdk/ca-base/ca.ts
protected _createBridgeHandler(params, options) {
  return new BridgeHandler(params, options);
}

// User calls sdk.bridge() → calls handler.execute() → uses V1
```

**Required**: Should detect `useV2Middleware` and call appropriate method:
```typescript
// Should call:
this.options.networkConfig.useV2Middleware
  ? handler.executeV2()  // This already exists!
  : handler.execute()
```

**Files to Update**:
1. `src/sdk/ca-base/ca.ts` - Check `useV2Middleware` flag in `_createBridgeHandler`

### 3. **Types Export**

**Issue**: V2 middleware types are not exported from main SDK entry point.

**Required**: Add to `src/index.ts`:
```typescript
export type {
  V2BalanceResponse,
  V2ApprovalsByChain,
  V2ApprovalOperation,
  V2ApprovalRequest,
  V2ApprovalResponse,
  V2MiddlewareRffRequest,
  V2MiddlewareRffPayload,
} from './commons';
```

## 🔧 Required Fixes

### Priority 1: Critical for V2 Functionality

1. **Fix Balance Fetching**
   - Update `getBalances` to accept middleware config
   - Conditionally use V2 API when `useV2Middleware: true`
   - Update all call sites

2. **Fix Bridge Execution**
   - Update CA class to call `executeV2()` when `useV2Middleware: true`

### Priority 2: Nice to Have

1. **Export V2 Types** - For external usage
2. **Add V2 Examples** - Documentation
3. **Add V2 Unit Tests** - Test coverage

## 📝 Implementation Plan

### Step 1: Update Balance Utilities

```typescript
// src/sdk/ca-base/utils/balance.utils.ts

import { getEVMBalancesForAddress, getEVMBalancesForAddressV2 } from '.';

export const getBalances = async (input: {
  evmAddress: Hex;
  chainList: ChainListType;
  removeTransferFee?: boolean;
  filter?: boolean;
  tronAddress?: string;
  isCA?: boolean;
  vscDomain: string;
  networkHint: Environment;
  // New fields:
  useV2Middleware?: boolean;
  middlewareUrl?: string;
}) => {
  const isCA = input.isCA ?? false;
  const removeTransferFee = input.removeTransferFee ?? false;
  const filter = input.filter ?? true;

  const [ankrBalances, evmBalances, tronBalances] = await Promise.all([
    input.networkHint === Environment.FOLLY || isCA
      ? Promise.resolve([])
      : getAnkrBalances(input.evmAddress, input.chainList, removeTransferFee),
    // FIX: Use V2 when middleware is enabled
    input.useV2Middleware && input.middlewareUrl
      ? getEVMBalancesForAddressV2(input.middlewareUrl, input.evmAddress)
      : getEVMBalancesForAddress(input.vscDomain, input.evmAddress),
    input.tronAddress
      ? getTronBalancesForAddress(input.vscDomain, input.tronAddress as Hex)
      : Promise.resolve([]),
  ]);

  // ... rest of function
};
```

### Step 2: Update CA Class

```typescript
// src/sdk/ca-base/ca.ts

protected _getUnifiedBalances = async (includeSwappableBalances = false) => {
  if (!this._evm || this._initStatus !== INIT_STATUS.DONE) {
    throw Errors.sdkNotInitialized();
  }

  const { assets } = await getBalances({
    networkHint: this._networkConfig.NETWORK_HINT,
    evmAddress: (await this._evm.client.requestAddresses())[0],
    chainList: this.chainList,
    filter: false,
    isCA: includeSwappableBalances === false,
    vscDomain: this._networkConfig.VSC_DOMAIN,
    tronAddress: this._tron?.address,
    // FIX: Pass V2 config
    useV2Middleware: this._networkConfig.useV2Middleware,
    middlewareUrl: this._networkConfig.MIDDLEWARE_URL,
  });

  // ... rest
};

// FIX: Use V2 execution when middleware enabled
protected _createBridgeHandler(params, options) {
  const handler = new BridgeHandler(params, options);

  // Return appropriate execute method based on config
  return {
    execute: () =>
      this._networkConfig.useV2Middleware
        ? handler.executeV2()
        : handler.execute(),
    simulate: () => handler.simulate(),
  };
}
```

### Step 3: Update All Other Call Sites

Similar updates needed in:
- `src/sdk/ca-base/requestHandlers/bridge.ts`
- `src/sdk/ca-base/requestHandlers/bridgeMax.ts`
- `src/sdk/ca-base/swap/route.ts`

## 🧪 Testing Strategy

1. **Unit Tests**
   - Test `getBalances` with `useV2Middleware: true` calls middleware
   - Test `getBalances` with `useV2Middleware: false` calls VSC

2. **Integration Tests**
   - SDK initialization with V2 config
   - Full bridge flow with V2 middleware
   - Balance fetching with V2 middleware

3. **E2E Tests**
   - Complete user flow with local middleware
   - Test in `test/integration/sdk-v2-middleware-e2e.test.ts`

## 📊 Completion Status

| Component | Status | Priority |
|-----------|--------|----------|
| Middleware utils | ✅ Complete | - |
| Bridge V2 execution | ✅ Complete | - |
| Balance V2 integration | ❌ Missing | P1 |
| Bridge handler routing | ❌ Missing | P1 |
| Type exports | ❌ Missing | P2 |
| Documentation | ⚠️ Partial | P2 |
| E2E Tests | ✅ Created | P1 |

## 🎯 Next Steps

1. Implement Priority 1 fixes (balance + bridge routing)
2. Run E2E test to verify end-to-end flow
3. Add comprehensive unit tests
4. Update documentation
5. Create migration guide for V1 → V2 users
