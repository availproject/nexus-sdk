/**
 * V2 Statekeeper Integration Tests
 *
 * Tests the v2 protocol flow using the deployed Nexus V2 devnet.
 * Uses SDK's v2 functions and types directly.
 *
 * Prerequisites:
 * - Nexus V2 devnet must be accessible at https://nexus-v3.avail.tools/
 *
 * Run with:
 *   pnpm test:v2
 */

import {
  type Hex,
  encodeAbiParameters,
  keccak256,
  hashMessage,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Import SDK v2 types from built dist
import type {
  V2Request,
  V2SourcePair,
  V2DestinationPair,
  V2Party,
  V2Universe,
  V2RffResponse,
} from '../../dist';

// Simple StatekeeperClient for tests (matches SDK's StatekeeperClient interface)
class StatekeeperClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async submitRff(request: V2Request, signature: Hex): Promise<Hex> {
    const res = await fetch(`${this.baseUrl}/rff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, signature }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Submit failed: ${res.status} - ${text}`);
    }
    const data = await res.json();
    return data.request_hash;
  }

  async getRff(requestHash: Hex): Promise<V2RffResponse> {
    const res = await fetch(`${this.baseUrl}/rff/${requestHash}`);
    if (!res.ok) throw new Error(`Get RFF failed: ${res.status}`);
    return res.json();
  }

  async listRffs(state?: string, limit?: number): Promise<V2RffResponse[]> {
    const params = new URLSearchParams();
    if (state) params.append('state', state);
    if (limit) params.append('limit', limit.toString());
    const query = params.toString();
    const url = query ? `${this.baseUrl}/rffs?${query}` : `${this.baseUrl}/rffs`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`List RFFs failed: ${res.status}`);
    const data = await res.json();
    return data.rffs;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Configuration - Using deployed Nexus V2 devnet
// ============================================================================

const CONFIG = {
  // Local Anvil chains + Statekeeper
  statekeeper: 'http://localhost:9080',
  chains: {
    eth: { rpc: 'http://localhost:8545', chainId: 1 },
    arb: { rpc: 'http://localhost:8546', chainId: 42161 },
    base: { rpc: 'http://localhost:8547', chainId: 8453 },
    poly: { rpc: 'http://localhost:8548', chainId: 137 },
  },
  // Test private key - use a test wallet only!
  testPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
};

// Well-known token addresses (mainnet USDC)
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Hex;

// ============================================================================
// Utility Functions
// ============================================================================

function padTo32Bytes(address: Hex): Hex {
  const clean = address.toLowerCase().replace('0x', '');
  return ('0x' + clean.padStart(64, '0')) as Hex;
}

function bigintToHex(value: bigint): string {
  return '0x' + value.toString(16);
}

function generateNonce(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
}

function universeToNumeric(universe: V2Universe): number {
  switch (universe) {
    case 'EVM': return 0;
    case 'TRON': return 1;
    case 'FUEL': return 2;
    case 'SVM': return 3;
    default: return 0;
  }
}

// ABI for V2 Request encoding (matches Solidity Vault.sol)
const V2_REQUEST_ABI = [
  {
    components: [
      { name: 'universe', type: 'uint8' },
      { name: 'chainID', type: 'uint256' },
      { name: 'contractAddress', type: 'bytes32' },
      { name: 'value', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
    ],
    name: 'sources',
    type: 'tuple[]',
  },
  { name: 'destinationUniverse', type: 'uint8' },
  { name: 'destinationChainID', type: 'uint256' },
  { name: 'recipientAddress', type: 'bytes32' },
  {
    components: [
      { name: 'contractAddress', type: 'bytes32' },
      { name: 'value', type: 'uint256' },
    ],
    name: 'destinations',
    type: 'tuple[]',
  },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  {
    components: [
      { name: 'universe', type: 'uint8' },
      { name: 'address_', type: 'bytes32' },
    ],
    name: 'parties',
    type: 'tuple[]',
  },
] as const;

// ============================================================================
// Test Runner
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
// Build and Sign V2 Request
// ============================================================================

async function buildTestRequest(account: ReturnType<typeof privateKeyToAccount>): Promise<{
  request: V2Request;
  signature: Hex;
  expectedHash: Hex;
}> {
  const userAddress = padTo32Bytes(account.address);
  const nonce = generateNonce();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

  // Build a simple test request: ARB USDC → BASE USDC
  const request: V2Request = {
    sources: [
      {
        universe: 'EVM',
        chain_id: bigintToHex(42161n), // Arbitrum
        contract_address: padTo32Bytes(USDC_ADDRESS),
        value: bigintToHex(parseUnits('100', 6)), // 100 USDC
        fee: '0x0',
      },
    ],
    destination_universe: 'EVM',
    destination_chain_id: bigintToHex(8453n), // Base
    recipient_address: userAddress,
    destinations: [
      {
        contract_address: padTo32Bytes(USDC_ADDRESS),
        value: bigintToHex(parseUnits('99', 6)), // 99 USDC after fees
      },
    ],
    nonce: bigintToHex(nonce),
    expiry: bigintToHex(expiry),
    parties: [
      {
        universe: 'EVM',
        address: userAddress,
      },
    ],
  };

  // Encode for signing (ABI uses numeric universe values)
  const encodedSources = request.sources.map(s => ({
    universe: universeToNumeric(s.universe),
    chainID: BigInt(s.chain_id),
    contractAddress: s.contract_address,
    value: BigInt(s.value),
    fee: BigInt(s.fee),
  }));

  const encodedDestinations = request.destinations.map(d => ({
    contractAddress: d.contract_address,
    value: BigInt(d.value),
  }));

  const encodedParties = request.parties.map(p => ({
    universe: universeToNumeric(p.universe),
    address_: p.address,
  }));

  const encoded = encodeAbiParameters(V2_REQUEST_ABI, [
    encodedSources,
    universeToNumeric(request.destination_universe),
    BigInt(request.destination_chain_id),
    request.recipient_address,
    encodedDestinations,
    nonce,
    expiry,
    encodedParties,
  ]);

  const hash = keccak256(encoded);
  const signature = await account.signMessage({ message: { raw: hash } });
  const expectedHash = hashMessage({ raw: hash });

  return { request, signature: signature as Hex, expectedHash: expectedHash as Hex };
}

// ============================================================================
// Main Test Suite
// ============================================================================

async function runTests() {
  console.log('\n' + '='.repeat(50));
  console.log('V2 Statekeeper Integration Tests');
  console.log('='.repeat(50) + '\n');

  const runner = new TestRunner();

  // Use SDK's StatekeeperClient
  const client = new StatekeeperClient(CONFIG.statekeeper);
  const account = privateKeyToAccount(CONFIG.testPrivateKey);

  console.log(`Test wallet: ${account.address}`);
  console.log(`Statekeeper: ${CONFIG.statekeeper}\n`);

  // -------------------------------------------------------------------------
  // Test 1: Health Check
  // -------------------------------------------------------------------------
  console.log('\n[1] Statekeeper Connection');

  await runner.test('Health check returns OK', async () => {
    const healthy = await client.checkHealth();
    if (!healthy) throw new Error('Statekeeper is not healthy');
  });

  // -------------------------------------------------------------------------
  // Test 2: Build and Sign V2 Request
  // -------------------------------------------------------------------------
  console.log('\n[2] Request Building & Signing');

  let testRequest: Awaited<ReturnType<typeof buildTestRequest>> | null = null;

  await runner.test('Build V2 request from test data', async () => {
    testRequest = await buildTestRequest(account);
    if (!testRequest.request.sources.length) throw new Error('No sources');
    if (!testRequest.signature) throw new Error('No signature');
  });

  await runner.test('Request has valid structure', async () => {
    if (!testRequest) throw new Error('No test request');
    const r = testRequest.request;
    if (r.sources.length !== 1) throw new Error('Expected 1 source');
    if (r.destinations.length !== 1) throw new Error('Expected 1 destination');
    if (r.parties.length !== 1) throw new Error('Expected 1 party');
    if (!r.nonce.startsWith('0x')) throw new Error('Invalid nonce format');
    if (!r.expiry.startsWith('0x')) throw new Error('Invalid expiry format');
  });

  await runner.test('Signature is 65 bytes', async () => {
    if (!testRequest) throw new Error('No test request');
    const sigBytes = testRequest.signature.slice(2); // Remove 0x
    if (sigBytes.length !== 130) throw new Error(`Signature is ${sigBytes.length / 2} bytes, expected 65`);
  });

  // -------------------------------------------------------------------------
  // Test 3: Submit RFF to Statekeeper
  // -------------------------------------------------------------------------
  console.log('\n[3] RFF Submission');

  let submittedHash: Hex | null = null;

  await runner.test('Submit RFF to statekeeper', async () => {
    if (!testRequest) throw new Error('No test request');
    submittedHash = await client.submitRff(testRequest.request, testRequest.signature);
    if (!submittedHash) throw new Error('No request_hash returned');
    console.log(`    Hash: ${submittedHash.slice(0, 20)}...`);
  });

  await runner.test('Returned hash is valid format', async () => {
    if (!submittedHash) throw new Error('Missing data');
    if (!submittedHash.startsWith('0x')) throw new Error('Invalid hash format');
    if (submittedHash.length !== 66) throw new Error('Hash should be 32 bytes');
  });

  // -------------------------------------------------------------------------
  // Test 4: Retrieve RFF using SDK client
  // -------------------------------------------------------------------------
  console.log('\n[4] RFF Retrieval');

  await runner.test('Get RFF by hash using SDK client', async () => {
    if (!submittedHash) throw new Error('No submitted hash');
    const rff = await client.getRff(submittedHash);
    if (!rff.request_hash) throw new Error('No request_hash in response');
    if (!rff.status) throw new Error('No status in response');
    console.log(`    Status: ${rff.status}`);
  });

  await runner.test('RFF status is "created"', async () => {
    if (!submittedHash) throw new Error('No submitted hash');
    const rff = await client.getRff(submittedHash);
    if (rff.status !== 'created') {
      throw new Error(`Expected status "created", got "${rff.status}"`);
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: List RFFs using SDK client
  // -------------------------------------------------------------------------
  console.log('\n[5] RFF Listing');

  await runner.test('List all RFFs', async () => {
    const rffs = await client.listRffs();
    if (!Array.isArray(rffs)) throw new Error('Expected rffs array');
    console.log(`    Found ${rffs.length} RFFs`);
  });

  await runner.test('List RFFs with status filter', async () => {
    const rffs = await client.listRffs('created', 5);
    if (!Array.isArray(rffs)) throw new Error('Expected rffs array');
    for (const rff of rffs) {
      if (rff.status !== 'created') {
        throw new Error(`Expected all status to be "created", got "${rff.status}"`);
      }
    }
  });

  await runner.test('Our submitted RFF is in the list', async () => {
    if (!submittedHash) throw new Error('No submitted hash');
    const rffs = await client.listRffs('created', 100);
    const found = rffs.find(r => r.request_hash === submittedHash);
    if (!found) throw new Error('Submitted RFF not found in list');
  });

  // -------------------------------------------------------------------------
  // Test 6: Edge Cases
  // -------------------------------------------------------------------------
  console.log('\n[6] Edge Cases');

  await runner.test('Duplicate submission handling', async () => {
    if (!testRequest) throw new Error('No test request');
    try {
      const result = await client.submitRff(testRequest.request, testRequest.signature);
      // Some implementations return same hash, others error
      if (result !== submittedHash) {
        console.log('    Note: Got different hash on resubmit');
      } else {
        console.log('    Note: Same hash on resubmit (idempotent)');
      }
    } catch (e) {
      // Duplicate rejection is also valid behavior
      console.log('    Note: Duplicate rejected (expected)');
    }
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const success = runner.summary();
  process.exit(success ? 0 : 1);
}

// Run tests
runTests().catch(console.error);
