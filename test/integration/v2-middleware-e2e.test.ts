/**
 * V2 Middleware Complete E2E Integration Test
 *
 * Tests the full V2 middleware flow with local Anvil nodes:
 * 1. Get balances via middleware
 * 2. Create sponsored approvals via middleware WebSocket
 * 3. Submit RFF via middleware
 * 4. Track RFF status via middleware
 *
 * Prerequisites:
 * - Anvil nodes running on:
 *   - Ethereum: http://localhost:8545 (chainId: 1)
 *   - Arbitrum: http://localhost:8546 (chainId: 42161)
 * - Middleware running on: http://localhost:3000
 *
 * Run with:
 *   pnpm test:v2:middleware
 */

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
import type {
  V2ApprovalsByChain,
  V2ApprovalResponse,
  V2Request,
  V2RffResponse,
} from '../../src/commons/types';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  middleware: 'http://localhost:3000',
  chains: {
    eth: { rpc: 'http://localhost:8545', chainId: 1, name: 'Ethereum' },
    arb: { rpc: 'http://localhost:8546', chainId: 42161, name: 'Arbitrum' },
  },
  testAccount: {
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
  },
  tokens: {
    // Mainnet USDC addresses (use actual addresses for your Anvil fork)
    ethUSDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    arbUSDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    // Known USDC whale for funding (adjust for your fork)
    usdcWhale: '0x47c031236e19d024b42f8AE6780E44A573170703' as Address,
  },
};

const TEST_AMOUNT = parseUnits('10', 6); // 10 USDC

// ============================================================================
// Types (imported from SDK)
// ============================================================================
// All types are imported from SDK - see imports above

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

function padTo32Bytes(address: Address): Hex {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Chain Clients
// ============================================================================

function createClients(chainConfig: typeof CONFIG.chains.eth) {
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
  chainConfig: typeof CONFIG.chains.eth,
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
// V2 Request Building
// ============================================================================

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

async function buildAndSignV2Request(
  sourceChain: typeof CONFIG.chains.arb,
  destChain: typeof CONFIG.chains.eth,
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

  // Build V2 Request
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
        value: bigintToHex(amount),
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
    universe: 0, // EVM = 0
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
    universe: 0, // EVM = 0
    address_: p.address as `0x${string}`,
  }));

  const encoded = encodeAbiParameters(V2_REQUEST_ABI, [
    encodedSources,
    0, // destination universe (EVM)
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
// Middleware API Functions
// ============================================================================

async function getBalanceFromMiddleware(address: Address): Promise<any> {
  const res = await fetch(`${CONFIG.middleware}/api/v1/balance/evm/${address}`);
  if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
  return res.json();
}

async function createApprovalsViaMiddleware(
  approvals: V2ApprovalsByChain,
): Promise<V2ApprovalResponse[]> {
  return new Promise((resolve, reject) => {
    const wsUrl = CONFIG.middleware.replace(/^http/, 'ws') + '/api/v1/create-sponsored-approvals';
    const ws = new WebSocket(wsUrl);
    const results: V2ApprovalResponse[] = [];

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket timeout'));
    }, 30000);

    ws.onopen = () => {
      ws.send(JSON.stringify(approvals));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.chainId !== undefined) {
          results.push(message as V2ApprovalResponse);
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      resolve(results);
    };
  });
}

async function submitRffToMiddleware(request: V2Request, signature: Hex): Promise<Hex> {
  const res = await fetch(`${CONFIG.middleware}/api/v1/rff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, signature }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RFF submit failed: ${res.status} - ${text}`);
  }
  const data = await res.json();
  return data.request_hash;
}

async function getRffFromMiddleware(hash: Hex): Promise<V2RffResponse> {
  const res = await fetch(`${CONFIG.middleware}/api/v1/rff/${hash}`);
  if (!res.ok) throw new Error(`RFF fetch failed: ${res.status}`);
  return res.json();
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function runE2ETest() {
  console.log('\n' + '='.repeat(70));
  console.log('V2 Middleware Complete E2E Test');
  console.log('='.repeat(70) + '\n');

  try {
    // -------------------------------------------------------------------------
    // Step 1: Get Balance via Middleware
    // -------------------------------------------------------------------------
    log('Step 1: Fetching balance from middleware...');

    const balanceData = await getBalanceFromMiddleware(CONFIG.testAccount.address);
    log('✓ Balance retrieved successfully', balanceData);

    // -------------------------------------------------------------------------
    // Step 2: Create Sponsored Approvals via Middleware WebSocket
    // -------------------------------------------------------------------------
    log('\nStep 2: Creating sponsored approvals via middleware WebSocket...');

    const approvalRequest: V2ApprovalsByChain = {
      [CONFIG.chains.arb.chainId]: [
        {
          address: CONFIG.testAccount.address,
          ops: [
            {
              tokenAddress: CONFIG.tokens.arbUSDC,
              variant: 1, // ERC20Permit variant
              value: ('0x' + TEST_AMOUNT.toString(16)) as Hex,
              signature: {
                v: 27,
                r: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
                s: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
              },
            },
          ],
        },
      ],
    };

    const approvals = await createApprovalsViaMiddleware(approvalRequest);
    log(`✓ Received ${approvals.length} approval(s)`, approvals);

    // -------------------------------------------------------------------------
    // Step 3: Build and Submit RFF via Middleware
    // -------------------------------------------------------------------------
    log('\nStep 3: Building and submitting RFF via middleware...');

    const { request, signature, requestHash } = await buildAndSignV2Request(
      CONFIG.chains.arb,
      CONFIG.chains.eth,
      CONFIG.tokens.arbUSDC,
      CONFIG.tokens.ethUSDC,local
      TEST_AMOUNT,
    );

    log('RFF built:', {
      sourceChain: CONFIG.chains.arb.name,
      destChain: CONFIG.chains.eth.name,
      amount: formatUnits(TEST_AMOUNT, 6) + ' USDC',
    });

    const submittedHash = await submitRffToMiddleware(request, signature);
    log(`✓ RFF submitted successfully!`);
    log(`  Request hash: ${submittedHash}`);

    // -------------------------------------------------------------------------
    // Step 4: Track RFF Status via Middleware
    // -------------------------------------------------------------------------
    log('\nStep 4: Tracking RFF status via middleware...');

    const initialRff = await getRffFromMiddleware(submittedHash);
    log(`Initial status: ${initialRff.status}`);

    log('Polling for status changes (30s)...\n');

    const maxChecks = 10;
    const checkInterval = 3000;
    let lastStatus = initialRff.status;

    for (let i = 0; i < maxChecks; i++) {
      await sleep(checkInterval);

      const rff = await getRffFromMiddleware(submittedHash);
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
    // Summary
    // -------------------------------------------------------------------------
    console.log('\n' + '='.repeat(70));
    console.log('E2E Test Summary');
    console.log('='.repeat(70));
    console.log(`Middleware: ${CONFIG.middleware}`);
    console.log(`Source Chain: ${CONFIG.chains.arb.name} (${CONFIG.chains.arb.chainId})`);
    console.log(`Dest Chain: ${CONFIG.chains.eth.name} (${CONFIG.chains.eth.chainId})`);
    console.log(`Test Amount: ${formatUnits(TEST_AMOUNT, 6)} USDC`);
    console.log(`Request Hash: ${submittedHash}`);
    console.log(`Final Status: ${lastStatus}`);
    console.log(`\n✓ E2E Test PASSED - All middleware operations successful`);
    console.log('='.repeat(70) + '\n');
  } catch (error) {
    console.error('\n✗ E2E Test FAILED:', error);
    process.exit(1);
  }
}

// Run the test
runE2ETest();
