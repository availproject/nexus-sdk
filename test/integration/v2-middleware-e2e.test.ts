/**
 * V2 Middleware E2E Integration Test
 *
 * Tests the V2 middleware client functions for balance fetching, approvals, and RFF submission.
 * This test requires:
 * - Local Anvil chains running on ports 8546 (ARB), 8548 (POLY)
 * - Middleware service running on http://localhost:3000
 * - forge CLI available for contract deployment
 *
 * Run with:
 *   pnpm test:v2:middleware
 */

import { execSync } from 'child_process';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  erc20Abi,
  maxUint256,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getBalancesFromMiddleware,
  createApprovalsViaMiddleware,
  submitRffToMiddleware,
  getRffFromMiddleware,
  listRffsFromMiddleware,
} from '../../src/sdk/ca-base/utils/middleware.utils';
import type {
  V2ApprovalsByChain,
  V2MiddlewareRffPayload,
} from '../../src/commons';

// ============================================================================
// Configuration
// ============================================================================

const MIDDLEWARE_URL = 'http://localhost:3000';
const VAULT_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

const CHAINS = [
  { chainId: 42161, port: 8546, name: 'Arbitrum' },
  { chainId: 137, port: 8548, name: 'Polygon' },
];

const deployer = privateKeyToAccount(DEPLOYER_KEY);

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
// Utility Functions
// ============================================================================

function cast(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function toBytes32(addr: Hex): Hex {
  const hex = addr.replace(/^0x/, '');
  return `0x${hex.padStart(64, '0')}` as Hex;
}

async function deployMockToken(port: number): Promise<Address> {
  const result = JSON.parse(
    cast(`forge create src/tests/MockPermitToken.sol:MockPermitToken --private-key ${DEPLOYER_KEY} --rpc-url http://localhost:${port} --broadcast --json`)
  );
  return result.deployedTo as Address;
}

async function mintTokens(port: number, token: Address, to: Address, amount: bigint) {
  cast(`cast send ${token} "mint(address,uint256)" ${to} ${amount.toString()} --private-key ${DEPLOYER_KEY} --rpc-url http://localhost:${port} --gas-limit 1000000`);
}

async function getBalance(port: number, token: Address, address: Address): Promise<bigint> {
  const client = createPublicClient({ transport: http(`http://localhost:${port}`) });
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

async function signPermit(chainId: number, token: Address, nonce: bigint) {
  const domain = {
    name: 'USD Coin',
    version: '1',
    chainId: BigInt(chainId),
    verifyingContract: token,
  };
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  const message = {
    owner: deployer.address,
    spender: VAULT_ADDRESS,
    value: maxUint256,
    nonce,
    deadline: maxUint256,
  };
  const signature = await deployer.signTypedData({
    domain,
    types,
    primaryType: 'Permit',
    message,
  });
  return {
    v: parseInt(signature.slice(130, 132), 16),
    r: `0x${signature.slice(2, 66)}` as Hex,
    s: `0x${signature.slice(66, 130)}` as Hex,
  };
}

// ============================================================================
// Main Test Suite
// ============================================================================

async function runTests() {
  console.log('\n' + '='.repeat(50));
  console.log('V2 Middleware E2E Integration Tests');
  console.log('='.repeat(50) + '\n');

  const runner = new TestRunner();
  const deployedTokens: Record<number, Address> = {};

  console.log(`Test wallet: ${deployer.address}`);
  console.log(`Middleware: ${MIDDLEWARE_URL}\n`);

  // -------------------------------------------------------------------------
  // Setup: Deploy tokens and mint
  // -------------------------------------------------------------------------
  console.log('\n[Setup] Deploying test environment');

  for (const chain of CHAINS) {
    process.stdout.write(`  Deploying token on ${chain.name}... `);
    try {
      deployedTokens[chain.chainId] = await deployMockToken(chain.port);
      console.log(`\x1b[32m✓\x1b[0m ${deployedTokens[chain.chainId]}`);

      const mintAmount = parseUnits('1000', 6);
      process.stdout.write(`  Minting ${formatUnits(mintAmount, 6)} tokens... `);
      await mintTokens(chain.port, deployedTokens[chain.chainId], deployer.address, mintAmount);
      console.log('\x1b[32m✓\x1b[0m');
    } catch (error) {
      console.log('\x1b[31m✗ FAILED\x1b[0m');
      console.error('    Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  console.log('\n=== Setup complete ===\n');

  // -------------------------------------------------------------------------
  // Test 1: Fetch balances
  // -------------------------------------------------------------------------
  console.log('\n[1] Balance Fetching');

  await runner.test('Fetch balances via middleware', async () => {
    const balances = await getBalancesFromMiddleware(MIDDLEWARE_URL, deployer.address, 0);

    if (!Array.isArray(balances)) {
      throw new Error('Expected balances to be an array');
    }
    if (balances.length === 0) {
      throw new Error('Expected balances array to have items');
    }

    const arbBalance = balances.find(b => {
      const chainIdNum = Number(BigInt('0x' + Array.from(b.chain_id).map(x => x.toString(16).padStart(2, '0')).join('')));
      return chainIdNum === 42161;
    });

    if (!arbBalance) {
      throw new Error('Expected to find Arbitrum balance');
    }
    if (arbBalance.currencies.length === 0) {
      throw new Error('Expected currencies array to have items');
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: Create approvals
  // -------------------------------------------------------------------------
  console.log('\n[2] Approval Creation');

  await runner.test('Create approvals via middleware', async () => {
    const approvals: V2ApprovalsByChain = {};

    for (const chain of CHAINS) {
      approvals[chain.chainId] = [{
        address: deployer.address,
        ops: [{
          tokenAddress: deployedTokens[chain.chainId],
          variant: 1,
          value: null,
          signature: await signPermit(chain.chainId, deployedTokens[chain.chainId], 0n),
        }],
      }];
    }

    const results = await createApprovalsViaMiddleware(MIDDLEWARE_URL, approvals);

    if (results.length !== CHAINS.length) {
      throw new Error(`Expected ${CHAINS.length} results, got ${results.length}`);
    }
    for (const result of results) {
      if (result.errored) {
        throw new Error('Expected result to not be errored');
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(result.txHash)) {
        throw new Error(`Invalid txHash format: ${result.txHash}`);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: Submit RFF
  // -------------------------------------------------------------------------
  console.log('\n[3] RFF Submission');

  let submittedHash: Hex | null = null;

  await runner.test('Submit RFF via middleware', async () => {
    const sourceChain = CHAINS[0];
    const destChain = CHAINS[1];
    const amount = parseUnits('100', 6);

    const rffRequest: V2MiddlewareRffPayload['request'] = {
      sources: [{
        universe: 'EVM',
        chain_id: toBytes32(`0x${sourceChain.chainId.toString(16)}` as Hex),
        contract_address: toBytes32(deployedTokens[sourceChain.chainId]),
        value: `0x${amount.toString(16)}`,
        fee: '0x0',
      }],
      destination_universe: 'EVM',
      destination_chain_id: toBytes32(`0x${destChain.chainId.toString(16)}` as Hex),
      recipient_address: toBytes32(deployer.address),
      destinations: [{
        contract_address: toBytes32(deployedTokens[destChain.chainId]),
        value: `0x${amount.toString(16)}`,
      }],
      nonce: `0x${BigInt(Date.now()).toString(16)}`,
      expiry: `0x${BigInt(Math.floor(Date.now() / 1000) + 3600).toString(16)}`,
      parties: [{
        universe: 'EVM',
        address: toBytes32(deployer.address),
      }],
    };

    const signature = await deployer.signMessage({ message: 'test' }); // Placeholder
    const payload: V2MiddlewareRffPayload = { request: rffRequest, signature };

    const response = await submitRffToMiddleware(MIDDLEWARE_URL, payload);
    if (!/^0x[a-fA-F0-9]{64}$/.test(response.request_hash)) {
      throw new Error(`Invalid request_hash format: ${response.request_hash}`);
    }
    submittedHash = response.request_hash as Hex;
    console.log(`    Hash: ${submittedHash.slice(0, 20)}...`);
  });

  // -------------------------------------------------------------------------
  // Test 4: Retrieve RFF
  // -------------------------------------------------------------------------
  console.log('\n[4] RFF Retrieval');

  await runner.test('Get RFF by hash', async () => {
    if (!submittedHash) throw new Error('No submitted hash');

    const rff = await getRffFromMiddleware(MIDDLEWARE_URL, submittedHash);
    if (rff.request_hash !== submittedHash) {
      throw new Error(`Expected request_hash to match: ${rff.request_hash} !== ${submittedHash}`);
    }
    if (rff.status !== 'created') {
      throw new Error(`Expected status to be "created", got "${rff.status}"`);
    }
    console.log(`    Status: ${rff.status}`);
  });

  // -------------------------------------------------------------------------
  // Test 5: List RFFs
  // -------------------------------------------------------------------------
  console.log('\n[5] RFF Listing');

  await runner.test('List RFFs from middleware', async () => {
    const rffs = await listRffsFromMiddleware(MIDDLEWARE_URL, {
      status: 'created',
      limit: 10,
    });

    if (!rffs.rffs) {
      throw new Error('Expected rffs property to be defined');
    }
    if (!Array.isArray(rffs.rffs)) {
      throw new Error('Expected rffs to be an array');
    }
    console.log(`    Found ${rffs.rffs.length} RFFs`);
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const success = runner.summary();
  process.exit(success ? 0 : 1);
}

// Run tests
runTests().catch(console.error);
