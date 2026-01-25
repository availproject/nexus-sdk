# 🚀 Nexus SDK V2 Middleware Test App

A React + Vite + TypeScript test application for validating the Nexus SDK V2 middleware integration.

## Features

- ✅ Visual test runner for V2 middleware APIs
- ✅ Real-time test execution with status indicators
- ✅ Detailed test results with expandable data views
- ✅ Configuration panel for reviewing setup
- ✅ Modern, responsive UI with gradient design

## Prerequisites

Before running the test app, ensure you have:

1. **Middleware** running on `http://localhost:3000`
2. **Statekeeper** running on `http://localhost:9080`
3. **Node.js** v18+ and **pnpm** installed

## Installation

The dependencies are already installed during the Vite scaffold. If you need to reinstall:

```bash
pnpm install
```

## Running the App

Start the development server:

```bash
pnpm dev
```

The app will be available at `http://localhost:5173`

## Test Suite

The app includes automated tests for:

### Test 1: Middleware Health Check
Verifies the middleware service is running and responsive.

**Endpoint**: `GET /`

**Expected**: `{ "status": "ok" }`

### Test 2: Fetch Balances via Middleware
Tests the balance fetching functionality through the middleware V2 API.

**Endpoint**: `GET /api/v1/balance/evm/{address}`

**Expected**: Balance data for multiple chains (Ethereum, Polygon, Base, Arbitrum)

### Test 3: Statekeeper Health Check
Verifies the statekeeper service is running and responsive.

**Endpoint**: `GET /health`

**Expected**: Health status response

## Configuration

The test app uses these hardcoded configurations (editable in source):

- **Middleware URL**: `http://localhost:3000`
- **Statekeeper URL**: `http://localhost:9080`
- **Test Account**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (Anvil default)

To modify these, edit `src/components/V2MiddlewareTest.tsx`:

```typescript
const CONFIG = {
  middleware: 'http://localhost:3000',
  statekeeper: 'http://localhost:9080',
  testAccount: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Hex,
};
```

## Usage

1. **Start the app**: `pnpm dev`
2. **Navigate to Test Suite tab** (default view)
3. **Click "Run All Tests"** button
4. **View results** in real-time as tests execute
5. **Expand data** sections to see detailed API responses
6. **Reset** to clear results and run again

## UI Components

### Tabs
- **Test Suite**: Main testing interface
- **Configuration**: View current configuration settings

### Test Runner
- **Run All Tests**: Execute all tests sequentially
- **Reset**: Clear test results and start fresh

### Test Status Indicators
- ⏸️ **Pending**: Test not yet run
- ⏳ **Running**: Test currently executing
- ✅ **Success**: Test passed
- ❌ **Error**: Test failed

## Extending Tests

To add more tests, edit `src/components/V2MiddlewareTest.tsx`:

```typescript
const [tests, setTests] = useState<TestResult[]>([
  { name: 'Test 1: Middleware Health Check', status: 'pending' },
  { name: 'Test 2: Fetch Balances via Middleware', status: 'pending' },
  { name: 'Test 3: Statekeeper Health Check', status: 'pending' },
  // Add your new test here:
  { name: 'Test 4: Your New Test', status: 'pending' },
]);

// Then add the test logic in runAllTests():
const test4Pass = await runTest(3, async () => {
  // Your test logic here
  return {
    message: '✓ Test passed',
    data: responseData,
  };
});
```

## Building for Production

Build the optimized production bundle:

```bash
pnpm build
```

Preview the production build:

```bash
pnpm preview
```

## Project Structure

```
test-app/
├── src/
│   ├── components/
│   │   ├── V2MiddlewareTest.tsx     # Main test component
│   │   └── V2MiddlewareTest.css     # Test component styles
│   ├── App.tsx                       # Main app component
│   ├── App.css                       # App styles
│   ├── main.tsx                      # Entry point
│   └── index.css                     # Global styles
├── package.json                      # Dependencies
├── vite.config.ts                    # Vite configuration
├── tsconfig.json                     # TypeScript config
└── README.md                         # This file
```

## Dependencies

- **@avail-project/nexus-core**: Local SDK (file:..)
- **react**: ^19.2.0
- **react-dom**: ^19.2.0
- **viem**: ^2.44.4
- **axios**: ^1.13.2
- **@vitejs/plugin-react**: ^5.1.1
- **typescript**: ~5.9.3

## Troubleshooting

### Middleware Connection Errors

If you see "Network Error" or "ERR_CONNECTION_REFUSED":

1. Verify middleware is running: `curl http://localhost:3000/`
2. Check CORS is enabled in middleware
3. Ensure port 3000 is not blocked

### Statekeeper Connection Errors

If statekeeper tests fail:

1. Verify statekeeper is running: `curl http://localhost:9080/health`
2. Check statekeeper logs for errors
3. Ensure port 9080 is available

### Accept Header Validation Errors (422)

If you get validation errors:

1. Verify axios is sending `Accept: application/json` header
2. Check middleware API requirements
3. Review `V2MiddlewareTest.tsx` axios config

## Development

This app was created with Vite for fast development and hot module replacement.

**Start dev server with HMR**:
```bash
pnpm dev
```

**Run linter**:
```bash
pnpm lint
```

## License

MIT

## Related Documentation

- [V2 Integration Complete](../V2_INTEGRATION_COMPLETE.md)
- [V2 Implementation Summary](../docs/V2_IMPLEMENTATION_SUMMARY.md)
- [V2 Bugs Fixed](../docs/V2_BUGS_FIXED.md)
