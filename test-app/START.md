# 🚀 Quick Start Guide

## Step 1: Ensure Prerequisites

Make sure these services are running:

```bash
# Check middleware (should return {"status":"ok"})
curl http://localhost:3000/

# Check statekeeper (should return health status)
curl http://localhost:9080/health
```

## Step 2: Start the Test App

```bash
cd test-app
pnpm dev
```

The app will start at: **http://localhost:5173**

## Step 3: Run Tests

1. Open http://localhost:5173 in your browser
2. Click the "Run All Tests" button
3. Watch the tests execute in real-time
4. View detailed results for each test

## What the Tests Do

### ✅ Test 1: Middleware Health Check
- Verifies middleware is running
- Endpoint: `GET /`

### ✅ Test 2: Fetch Balances via Middleware
- Tests balance fetching
- Endpoint: `GET /api/v1/balance/evm/{address}`
- Shows balances for Ethereum, Polygon, Base, Arbitrum

### ✅ Test 3: Statekeeper Health Check
- Verifies statekeeper is running
- Endpoint: `GET /health`

## Expected Results

All tests should pass with green checkmarks (✅) if:
- Middleware is running on port 3000
- Statekeeper is running on port 9080
- Services are healthy and responsive

## Troubleshooting

**Port 5173 already in use?**
```bash
# Kill the process using port 5173
lsof -ti:5173 | xargs kill -9
# Then restart
pnpm dev
```

**Middleware not responding?**
```bash
# Check if middleware is running
curl http://localhost:3000/

# If not running, start it in the middleware project:
cd /path/to/middleware
bun run dev
```

**Statekeeper not responding?**
```bash
# Check if statekeeper is running
curl http://localhost:9080/health

# If not running, start it
cd /path/to/statekeeper
./statekeeper
```

## Screenshots

### Test Suite Tab
![Test Suite](docs/screenshots/test-suite.png)

The main test runner with:
- Real-time status indicators
- Duration tracking
- Expandable data views

### Configuration Tab
![Configuration](docs/screenshots/config.png)

View and verify:
- Middleware URL
- Statekeeper URL
- Test account address
- Supported chains

## Next Steps

After verifying the middleware integration works:

1. **Add More Tests**: Edit `src/components/V2MiddlewareTest.tsx`
2. **Test SDK Methods**: Add tests for `sdk.bridge()`, `sdk.getBalances()`, etc.
3. **Add Wallet Integration**: Connect MetaMask for full E2E testing

## Support

For issues or questions:
- Check the main README: `test-app/README.md`
- Review SDK docs: `../docs/`
- Check test app code: `src/components/V2MiddlewareTest.tsx`
