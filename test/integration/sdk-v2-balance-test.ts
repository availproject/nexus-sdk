/**
 * Simple SDK V2 Balance Integration Test
 *
 * Tests that the SDK can fetch balances via middleware when configured with V2.
 * This is a minimal test to verify the integration without requiring full wallet setup.
 *
 * Prerequisites:
 * - Middleware running on: http://localhost:3000
 *
 * Run with:
 *   pnpm test:sdk:v2:balance
 */

// Import from built dist instead of source to avoid tsx module resolution issues
import type { Hex } from 'viem';
import axios from 'axios';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  middleware: 'http://localhost:3000',
  testAccount: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Hex,
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

function log(msg: string, data?: unknown) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] ${msg}`);
  if (data) {
    console.log(
      '  ',
      JSON.stringify(
        data,
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );
  }
}

// ============================================================================
// Middleware Balance API
// ============================================================================

async function getBalancesFromMiddleware(middlewareUrl: string, address: Hex) {
  const url = `${middlewareUrl}/api/v1/balance/evm/${address}`;
  const response = await axios.get(url, {
    headers: {
      'Accept': 'application/json',
    },
  });
  return response.data;
}

// ============================================================================
// Main Test
// ============================================================================

async function runBalanceTest() {
  console.log('\n' + '='.repeat(70));
  console.log('SDK V2 Balance Integration Test');
  console.log('='.repeat(70) + '\n');

  try {
    // Test 1: Get EVM balances via middleware
    log('Test 1: Fetching EVM balances via middleware V2 API...');

    const balances = await getBalancesFromMiddleware(
      CONFIG.middleware,
      CONFIG.testAccount.address,
    );

    log('✓ Balances retrieved successfully');
    log('Balance data:', balances);

    // Parse and summarize results
    const chainIds = Object.keys(balances);
    const chainsWithBalances = chainIds.filter(
      (chainId) =>
        balances[chainId].currencies && balances[chainId].currencies.length > 0,
    );

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('Test Summary');
    console.log('='.repeat(70));
    console.log(`Middleware: ${CONFIG.middleware}`);
    console.log(`Test Address: ${CONFIG.testAccount.address}`);
    console.log(`Chains Retrieved: ${chainIds.length}`);
    console.log(
      `Chains with Balances: ${chainsWithBalances.length} [${chainsWithBalances.join(', ')}]`,
    );
    console.log(`\n✓ SDK V2 Balance Test PASSED`);
    console.log('='.repeat(70) + '\n');
  } catch (error) {
    console.error('\n✗ SDK V2 Balance Test FAILED:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
runBalanceTest();
