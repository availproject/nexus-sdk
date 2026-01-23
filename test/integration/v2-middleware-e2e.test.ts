/**
 * V2 Middleware Integration Test
 *
 * Tests the V2 middleware API endpoints are accessible.
 * This test requires:
 * - Middleware service running on http://localhost:3000
 *
 * Run with:
 *   pnpm test:v2:middleware
 */

import { type Hex, type Address } from 'viem';

// ============================================================================
// Configuration
// ============================================================================

const MIDDLEWARE_URL = 'http://localhost:3000';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Hex;

// ============================================================================
// Simple Test Runner
// ============================================================================

class TestRunner {
  private passed = 0;
  private failed = 0;

  async test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`  ${name}... `);
    try {
      await fn();
      console.log('\x1b[32m✓ PASSED\x1b[0m');
      this.passed++;
    } catch (error) {
      console.log('\x1b[31m✗ FAILED\x1b[0m');
      console.error('    Error:', error instanceof Error ? error.message : error);
      this.failed++;
    }
  }

  summary() {
    console.log('\n' + '='.repeat(50));
    console.log(`Results: ${this.passed} passed, ${this.failed} failed`);
    console.log('='.repeat(50));
    return this.failed === 0;
  }
}

// ============================================================================
// WebSocket Helper
// ============================================================================

function testWebSocketConnection(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, 5000);

    ws.onopen = () => {
      clearTimeout(timeout);
      ws.close();
      resolve();
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
  });
}

// ============================================================================
// Main Test Suite
// ============================================================================

async function runTests() {
  console.log('\n' + '='.repeat(50));
  console.log('V2 Middleware API Integration Tests');
  console.log('='.repeat(50) + '\n');

  const runner = new TestRunner();

  console.log(`Test address: ${TEST_ADDRESS}`);
  console.log(`Middleware: ${MIDDLEWARE_URL}`);
  console.log(`USDC: ${USDC_ADDRESS}\n`);

  // -------------------------------------------------------------------------
  // Test 1: GET /api/v1/balance/evm/:address
  // -------------------------------------------------------------------------
  console.log('\n[1] Balance Endpoint');

  await runner.test('GET /api/v1/balance/evm/:address returns response', async () => {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/balance/evm/${TEST_ADDRESS}`);
    if (!res.ok) {
      throw new Error(`Expected 200, got ${res.status}`);
    }
    const data = await res.json();
    if (!data) {
      throw new Error('Expected response data');
    }
    console.log(`    Status: ${res.status}`);
  });

  // -------------------------------------------------------------------------
  // Test 2: WSS /api/v1/create-sponsored-approvals
  // -------------------------------------------------------------------------
  console.log('\n[2] WebSocket Approval Endpoint');

  await runner.test('WSS /api/v1/create-sponsored-approvals connects', async () => {
    const wsUrl = MIDDLEWARE_URL.replace('http://', 'ws://').replace('https://', 'wss://');
    await testWebSocketConnection(`${wsUrl}/api/v1/create-sponsored-approvals`);
    console.log('    Connection: OK');
  });

  // -------------------------------------------------------------------------
  // Test 3: POST /api/v1/rff
  // -------------------------------------------------------------------------
  console.log('\n[3] RFF Submit Endpoint');

  await runner.test('POST /api/v1/rff endpoint exists (400 on invalid data is OK)', async () => {
    // Send minimal invalid payload to check endpoint exists
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/rff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: {}, signature: '0x' }),
    });

    // Endpoint should exist (200, 400, or 422 are all valid)
    if (res.status === 404) {
      throw new Error('Endpoint not found');
    }
    console.log(`    Status: ${res.status} (endpoint exists)`);
  });

  // -------------------------------------------------------------------------
  // Test 4: GET /api/v1/rff/:hash
  // -------------------------------------------------------------------------
  console.log('\n[4] RFF Get Endpoint');

  await runner.test('GET /api/v1/rff/:hash endpoint exists (404 is OK)', async () => {
    // Use a dummy hash to check endpoint exists
    const dummyHash = '0x' + '0'.repeat(64);
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/rff/${dummyHash}`);

    // 404 is expected for non-existent hash, but endpoint should exist
    // Only fail if we get unexpected errors like 500
    if (res.status >= 500) {
      throw new Error(`Unexpected server error: ${res.status}`);
    }
    console.log(`    Status: ${res.status} (endpoint exists)`);
  });

  // -------------------------------------------------------------------------
  // Test 5: GET /api/v1/rff/list
  // -------------------------------------------------------------------------
  console.log('\n[5] RFF List Endpoint');

  await runner.test('GET /api/v1/rff/list endpoint exists', async () => {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/rff/list?limit=1`);

    // Endpoint should exist (404 means not found, anything else means it exists)
    if (res.status === 404) {
      throw new Error('Endpoint not found');
    }
    // 400 is valid (may need different query params)
    // 200 is valid (success)
    // 500+ would be unexpected server error
    if (res.status >= 500) {
      throw new Error(`Unexpected server error: ${res.status}`);
    }
    console.log(`    Status: ${res.status} (endpoint exists)`);
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const success = runner.summary();
  process.exit(success ? 0 : 1);
}

// Run tests
runTests().catch(console.error);
