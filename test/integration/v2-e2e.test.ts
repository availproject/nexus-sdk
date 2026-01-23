/**
 * V2 End-to-End Integration Test
 *
 * Tests the full v2 RFF flow with the deployed Nexus V2 devnet (mainnet forks).
 * Uses SDK's v2 functions and types directly.
 *
 * Flow:
 * 1. Check prerequisites (statekeeper + chains are accessible)
 * 2. Fund test account with tokens using cast impersonation
 * 3. Build and sign V2 RFF using SDK utilities
 * 4. Submit RFF to statekeeper
 * 5. Poll for status changes
 * 6. Verify balance changes (if solver is running)
 *
 * Prerequisites:
 * - Nexus V2 devnet at https://nexus-v3.avail.tools/
 * - cast CLI available (for impersonation)
 *
 * Run with:
 *   pnpm test:v2:e2e
 */

import { execSync } from 'child_process';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  encodeAbiParameters,
  keccak256,
  hashMessage,
  erc20Abi,
  type Hex,
  type Address,
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
// Configuration - Using deployed Nexus V2 devnet (mainnet forks)
// ============================================================================

const CONFIG = {
  // Deployed Nexus V2 infrastructure
  statekeeper: 'http://localhost:9080',
  chains: {
    eth: { rpc: 'http://localhost:8545', chainId: 1, name: 'Ethereum' },
    arb: { rpc: 'http://localhost:8546', chainId: 42161, name: 'Arbitrum' },
    base: { rpc: 'http://localhost:8547', chainId: 8453, name: 'Base' },
    poly: { rpc: 'http://localhost:8548', chainId: 137, name: 'Polygon' },
  },
  // Test account (Anvil default account 0)
  testAccount: {
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
  },
  // Mainnet USDC addresses (same on all chains for simplicity in tests)
  tokens: {
    // Arbitrum USDC
    arbUSDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    // Base USDC
    baseUSDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
    // Known USDC whale on Arbitrum (for impersonation)
    arbUSDCWhale: '0x47c031236e19d024b42f8AE6780E44A573170703' as Address,
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

function log(msg: string, data?: unknown) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${timestamp}] ${msg}`);
  if (data)
    console.log(
      '  ',
      JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
    );
}

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
  return BigInt(
    '0x' +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
  );
}

function universeToNumeric(universe: V2Universe): number {
  switch (universe) {
    case 'EVM':
      return 0;
    case 'TRON':
      return 1;
    case 'FUEL':
      return 2;
    case 'SVM':
      return 3;
    default:
      return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Execute cast command safely
function castExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new Error(`Cast command failed: ${cmd}`);
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
// Chain Clients
// ============================================================================

function createClients(chainConfig: typeof CONFIG.chains.arb) {
  const account = privateKeyToAccount(CONFIG.testAccount.privateKey);

  const publicClient = createPublicClient({
    transport: http(chainConfig.rpc),
  });

  const walletClient = createWalletClient({
    account,
    transport: http(chainConfig.rpc),
  });

  return { publicClient, walletClient, account };
}

async function getTokenBalance(
  chainConfig: typeof CONFIG.chains.arb,
  tokenAddress: Address,
  accountAddress: Address,
): Promise<bigint> {
  const { publicClient } = createClients(chainConfig);

  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [accountAddress],
  });

  return balance;
}

// ============================================================================
// Fund Test Account using Cast Impersonation
// ============================================================================

async function fundTestAccountWithCast(
  chainRpc: string,
  tokenAddress: Address,
  whaleAddress: Address,
  recipientAddress: Address,
  amount: bigint,
): Promise<boolean> {
  log(`Funding ${recipientAddress} with ${formatUnits(amount, 6)} tokens via impersonation...`);

  try {
    // Impersonate whale and transfer tokens
    const transferCmd = `cast send ${tokenAddress} "transfer(address,uint256)" ${recipientAddress} ${amount.toString()} --rpc-url ${chainRpc} --unlocked --from ${whaleAddress}`;
    castExec(transferCmd);
    log('✓ Tokens transferred successfully');
    return true;
  } catch (error) {
    log(`✗ Failed to fund account: ${error}`);
    return false;
  }
}

// ============================================================================
// Build and Sign V2 Request
// ============================================================================

async function buildAndSignV2Request(
  sourceChain: typeof CONFIG.chains.arb,
  destChain: typeof CONFIG.chains.base,
  sourceToken: Address,
  destToken: Address,
  amount: bigint,
): Promise<{
  request: V2Request;
  signature: Hex;
  requestHash: Hex;
}> {
  const account = privateKeyToAccount(CONFIG.testAccount.privateKey);
  const userAddress32 = padTo32Bytes(CONFIG.testAccount.address);
  const sourceToken32 = padTo32Bytes(sourceToken);
  const destToken32 = padTo32Bytes(destToken);

  const nonce = generateNonce();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

  // Build V2 Request: Source chain → Destination chain
  const request: V2Request = {
    sources: [
      {
        universe: 'EVM',
        chain_id: bigintToHex(BigInt(sourceChain.chainId)),
        contract_address: sourceToken32,
        value: bigintToHex(amount),
        fee: '0x0',
      },
    ],
    destination_universe: 'EVM',
    destination_chain_id: bigintToHex(BigInt(destChain.chainId)),
    recipient_address: userAddress32,
    destinations: [
      {
        contract_address: destToken32,
        value: bigintToHex(amount), // Same amount (fees handled by protocol)
      },
    ],
    nonce: bigintToHex(nonce),
    expiry: bigintToHex(expiry),
    parties: [
      {
        universe: 'EVM',
        address: userAddress32,
      },
    ],
  };

  // Encode for signing
  const encodedSources = request.sources.map((s) => ({
    universe: universeToNumeric(s.universe),
    chainID: BigInt(s.chain_id),
    contractAddress: s.contract_address as `0x${string}`,
    value: BigInt(s.value),
    fee: BigInt(s.fee),
  }));

  const encodedDestinations = request.destinations.map((d) => ({
    contractAddress: d.contract_address as `0x${string}`,
    value: BigInt(d.value),
  }));

  const encodedParties = request.parties.map((p) => ({
    universe: universeToNumeric(p.universe),
    address_: p.address as `0x${string}`,
  }));

  const encoded = encodeAbiParameters(V2_REQUEST_ABI, [
    encodedSources,
    universeToNumeric(request.destination_universe),
    BigInt(request.destination_chain_id),
    request.recipient_address as `0x${string}`,
    encodedDestinations,
    nonce,
    expiry,
    encodedParties,
  ]);

  const hash = keccak256(encoded);
  const signature = await account.signMessage({ message: { raw: hash } });
  const requestHash = hashMessage({ raw: hash });

  return {
    request,
    signature: signature as Hex,
    requestHash: requestHash as Hex,
  };
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function runE2ETest() {
  console.log('\n' + '='.repeat(60));
  console.log('V2 End-to-End Integration Test (Deployed Devnet)');
  console.log('='.repeat(60) + '\n');

  const sourceChain = CONFIG.chains.arb;
  const destChain = CONFIG.chains.base;
  const testAmount = parseUnits('10', 6); // 10 USDC (6 decimals)

  // Use SDK's StatekeeperClient
  const statekeeper = new StatekeeperClient(CONFIG.statekeeper);

  try {
    // -------------------------------------------------------------------------
    // Step 1: Check Prerequisites
    // -------------------------------------------------------------------------
    log('Step 1: Checking prerequisites...');

    // Check statekeeper
    const healthy = await statekeeper.checkHealth();
    if (!healthy) {
      throw new Error('Statekeeper is not accessible at ' + CONFIG.statekeeper);
    }
    log('✓ Statekeeper is healthy');

    // Check chains are accessible
    for (const [name, chain] of Object.entries(CONFIG.chains)) {
      try {
        const chainId = castExec(`cast chain-id --rpc-url ${chain.rpc}`);
        log(`✓ ${chain.name} (${name}) accessible, chainId: ${chainId}`);
      } catch {
        log(`✗ ${chain.name} is NOT accessible at ${chain.rpc}`);
        throw new Error(`Chain ${name} is not accessible`);
      }
    }

    // -------------------------------------------------------------------------
    // Step 2: Check/Fund Test Account
    // -------------------------------------------------------------------------
    log('\nStep 2: Checking test account balances...');

    const sourceBalanceBefore = await getTokenBalance(
      sourceChain,
      CONFIG.tokens.arbUSDC,
      CONFIG.testAccount.address,
    );
    log(`Source (Arbitrum USDC) balance: ${formatUnits(sourceBalanceBefore, 6)} USDC`);

    // Try to fund if needed (only works if Anvil allows impersonation)
    if (sourceBalanceBefore < testAmount) {
      log('Insufficient balance, attempting to fund via impersonation...');
      const funded = await fundTestAccountWithCast(
        sourceChain.rpc,
        CONFIG.tokens.arbUSDC,
        CONFIG.tokens.arbUSDCWhale,
        CONFIG.testAccount.address,
        testAmount * 2n, // Fund 2x the test amount
      );
      if (!funded) {
        log('Warning: Could not fund account. Test will continue but may fail on actual transfer.');
      }
    }

    const sourceBalanceAfterFunding = await getTokenBalance(
      sourceChain,
      CONFIG.tokens.arbUSDC,
      CONFIG.testAccount.address,
    );
    log(`Source balance after funding attempt: ${formatUnits(sourceBalanceAfterFunding, 6)} USDC`);

    // -------------------------------------------------------------------------
    // Step 3: Build and Sign V2 RFF
    // -------------------------------------------------------------------------
    log('\nStep 3: Building and signing V2 RFF...');

    const { request, signature, requestHash } = await buildAndSignV2Request(
      sourceChain,
      destChain,
      CONFIG.tokens.arbUSDC,
      CONFIG.tokens.baseUSDC,
      testAmount,
    );

    log('RFF built successfully:', {
      sourceChain: sourceChain.name,
      destChain: destChain.name,
      sourceToken: CONFIG.tokens.arbUSDC,
      destToken: CONFIG.tokens.baseUSDC,
      amount: formatUnits(testAmount, 6) + ' USDC',
      computedHash: requestHash.slice(0, 20) + '...',
    });

    // -------------------------------------------------------------------------
    // Step 4: Submit RFF to Statekeeper
    // -------------------------------------------------------------------------
    log('\nStep 4: Submitting RFF to statekeeper...');

    const submittedHash = await statekeeper.submitRff(request, signature);
    log(`✓ RFF submitted successfully!`);
    log(`  Request hash: ${submittedHash}`);

    // -------------------------------------------------------------------------
    // Step 5: Poll for Status Changes
    // -------------------------------------------------------------------------
    log('\nStep 5: Polling RFF status...');

    const initialRff = await statekeeper.getRff(submittedHash);
    log(`Initial status: ${initialRff.status}`);

    log('Waiting for status changes (30s timeout)...');
    log('(Status will remain "created" if solver is not running)\n');

    const statusCheckInterval = 3000; // 3 seconds
    const maxChecks = 10;

    let lastStatus = initialRff.status;
    for (let i = 0; i < maxChecks; i++) {
      await sleep(statusCheckInterval);

      const rff = await statekeeper.getRff(submittedHash);
      if (rff.status !== lastStatus) {
        log(`Status changed: ${lastStatus} → ${rff.status}`);
        lastStatus = rff.status;
      } else {
        process.stdout.write('.');
      }

      if (rff.status === 'fulfilled' || rff.status === 'expired') {
        console.log('');
        break;
      }
    }
    console.log('');

    log(`Final status: ${lastStatus}`);

    // -------------------------------------------------------------------------
    // Step 6: Check Final Balances
    // -------------------------------------------------------------------------
    log('\nStep 6: Checking final balances...');

    const sourceBalanceAfter = await getTokenBalance(
      sourceChain,
      CONFIG.tokens.arbUSDC,
      CONFIG.testAccount.address,
    );

    const destBalance = await getTokenBalance(
      destChain,
      CONFIG.tokens.baseUSDC,
      CONFIG.testAccount.address,
    );

    log(`Source (Arbitrum) balance: ${formatUnits(sourceBalanceAfter, 6)} USDC`);
    log(`Destination (Base) balance: ${formatUnits(destBalance, 6)} USDC`);

    if (sourceBalanceAfterFunding > 0n) {
      const sourceChange = sourceBalanceAfterFunding - sourceBalanceAfter;
      log(`Source balance change: -${formatUnits(sourceChange, 6)} USDC`);
    }

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log('E2E Test Summary');
    console.log('='.repeat(60));
    console.log(`Statekeeper: ${CONFIG.statekeeper}`);
    console.log(`Source Chain: ${sourceChain.name} (${sourceChain.chainId})`);
    console.log(`Dest Chain: ${destChain.name} (${destChain.chainId})`);
    console.log(`Test Amount: ${formatUnits(testAmount, 6)} USDC`);
    console.log(`Request Hash: ${submittedHash}`);
    console.log(`Final Status: ${lastStatus}`);
    console.log(`Test Account: ${CONFIG.testAccount.address}`);

    if (lastStatus === 'fulfilled') {
      console.log('\n✓ E2E Test PASSED - RFF was fulfilled');
    } else if (lastStatus === 'created' || lastStatus === 'deposited') {
      console.log('\n○ E2E Test PARTIAL - RFF submitted but not fulfilled');
      console.log('  (This is expected if solver is not running)');
    } else {
      console.log('\n✗ E2E Test - RFF reached terminal state: ' + lastStatus);
    }

    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('\n✗ E2E Test FAILED:', error);
    process.exit(1);
  }
}

// Run the test
runE2ETest();
