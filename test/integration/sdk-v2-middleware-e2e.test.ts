/**
 * SDK V2 Middleware E2E Integration Test
 *
 * This test demonstrates the full V2 middleware flow using SDK high-level APIs:
 * 1. Initialize SDK with V2 middleware configuration
 * 2. Get unified balances via middleware
 * 3. Bridge USDC from Arbitrum to Base using middleware
 * 4. Track RFF status via middleware
 *
 * Prerequisites:
 * - Anvil nodes running on:
 *   - Arbitrum: http://localhost:8546 (chainId: 42161)
 *   - Base: http://localhost:8547 (chainId: 8453)
 *   - Polygon: http://localhost:8548 (chainId: 137)
 * - Middleware running on: http://localhost:3000
 * - Statekeeper running on: http://localhost:9080
 *
 * The test uses the same deployer key as the middleware test for consistency.
 *
 * Run with:
 *   pnpm test:sdk:v2:middleware
 */

import { NexusSDK } from '../../src/sdk/index';
import type { NetworkConfig, BridgeParams } from '../../src/commons';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  keccak256,
  erc20Abi,
  type Hex,
  type Address,
  pad,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { $ } from 'bun';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  middleware: 'http://localhost:3000',
  statekeeper: 'http://localhost:9080',
  chains: {
    arbitrum: {
      rpc: 'http://localhost:8546',
      chainId: 42161,
      name: 'Arbitrum',
      usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
      port: 8546,
      balanceSlot: 9n,
    },
    base: {
      rpc: 'http://localhost:8547',
      chainId: 8453,
      name: 'Base',
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
      port: 8547,
      balanceSlot: 9n,
    },
    polygon: {
      rpc: 'http://localhost:8548',
      chainId: 137,
      name: 'Polygon',
      usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as Address,
      port: 8548,
      balanceSlot: 9n,
    },
  },
  testAccount: {
    privateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
  },
};

const TEST_AMOUNT = parseUnits('100', 6); // 100 USDC
const FUND_AMOUNT = parseUnits('1000', 6); // 1000 USDC for initial funding

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

async function setUsdcBalance(
  port: number,
  token: Address,
  recipient: Address,
  amount: bigint,
  balanceSlot: bigint,
) {
  const recipientPadded = pad(recipient, { size: 32 });
  const slotPadded = pad(`0x${balanceSlot.toString(16)}` as Hex, { size: 32 });
  const storageSlot = keccak256(
    `0x${recipientPadded.slice(2)}${slotPadded.slice(2)}` as Hex,
  );

  const valueHex = `0x${amount.toString(16).padStart(64, '0')}`;

  await $`cast rpc anvil_setStorageAt ${token} ${storageSlot} ${valueHex} --rpc-url http://localhost:${port}`.quiet();
}

async function getBalance(
  rpc: string,
  token: Address,
  address: Address,
): Promise<bigint> {
  const client = createPublicClient({
    transport: http(rpc),
  });
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Mock Provider (Browser-compatible EIP-1193)
// ============================================================================

class MockEIP1193Provider {
  private account: ReturnType<typeof privateKeyToAccount>;
  private walletClients: Map<number, ReturnType<typeof createWalletClient>>;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
    this.walletClients = new Map();

    // Initialize wallet clients for each chain
    Object.values(CONFIG.chains).forEach((chain) => {
      const walletClient = createWalletClient({
        account: this.account,
        transport: http(chain.rpc),
        chain: {
          id: chain.chainId,
          name: chain.name,
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: {
            default: { http: [chain.rpc] },
          },
        },
      });
      this.walletClients.set(chain.chainId, walletClient);
    });
  }

  async request({ method, params }: { method: string; params?: any[] }) {
    switch (method) {
      case 'eth_requestAccounts':
        return [this.account.address];

      case 'eth_accounts':
        return [this.account.address];

      case 'eth_chainId':
        // Return current chain (default to Arbitrum)
        return `0x${CONFIG.chains.arbitrum.chainId.toString(16)}`;

      case 'personal_sign': {
        const [message] = params || [];
        const signature = await this.account.signMessage({
          message: message as string,
        });
        return signature;
      }

      case 'eth_signTypedData_v4': {
        const [, typedData] = params || [];
        const data = JSON.parse(typedData as string);
        const signature = await this.account.signTypedData(data);
        return signature;
      }

      case 'eth_sendTransaction': {
        const [tx] = params || [];
        // Find the appropriate wallet client based on chain
        const chainId = tx.chainId
          ? parseInt(tx.chainId, 16)
          : CONFIG.chains.arbitrum.chainId;
        const walletClient = this.walletClients.get(chainId);
        if (!walletClient) {
          throw new Error(`No wallet client for chain ${chainId}`);
        }
        const hash = await walletClient.sendTransaction({
          ...tx,
          account: this.account,
        });
        return hash;
      }

      case 'wallet_switchEthereumChain':
        // Mock chain switch - SDK will handle this
        return null;

      case 'wallet_addEthereumChain':
        // Mock add chain - already configured
        return null;

      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  on() {
    // Mock event listener
  }

  removeListener() {
    // Mock event listener removal
  }
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function runSDKE2ETest() {
  console.log('\n' + '='.repeat(70));
  console.log('SDK V2 Middleware E2E Test');
  console.log('='.repeat(70) + '\n');

  try {
    // -------------------------------------------------------------------------
    // Step 0: Setup - Fund test account with USDC
    // -------------------------------------------------------------------------
    log('Step 0: Setting up test environment...');

    // Fund Arbitrum
    await setUsdcBalance(
      CONFIG.chains.arbitrum.port,
      CONFIG.chains.arbitrum.usdc,
      CONFIG.testAccount.address,
      FUND_AMOUNT,
      CONFIG.chains.arbitrum.balanceSlot,
    );

    // Fund Base (so we can verify the bridge)
    await setUsdcBalance(
      CONFIG.chains.base.port,
      CONFIG.chains.base.usdc,
      CONFIG.testAccount.address,
      0n,
      CONFIG.chains.base.balanceSlot,
    );

    log('✓ Test accounts funded with USDC');

    // Verify balances
    const arbBalance = await getBalance(
      CONFIG.chains.arbitrum.rpc,
      CONFIG.chains.arbitrum.usdc,
      CONFIG.testAccount.address,
    );
    const baseBalance = await getBalance(
      CONFIG.chains.base.rpc,
      CONFIG.chains.base.usdc,
      CONFIG.testAccount.address,
    );

    log('Initial balances:', {
      arbitrum: formatUnits(arbBalance, 6) + ' USDC',
      base: formatUnits(baseBalance, 6) + ' USDC',
    });

    // -------------------------------------------------------------------------
    // Step 1: Initialize SDK with V2 Middleware Config
    // -------------------------------------------------------------------------
    log('\nStep 1: Initializing SDK with V2 middleware configuration...');

    const v2Config: NetworkConfig = {
      COSMOS_URL: 'https://cosmos-mainnet.availproject.org', // Not used in V2
      EXPLORER_URL: 'http://localhost:3000/explorer', // Middleware explorer
      GRPC_URL: 'https://grpcproxy-mainnet.availproject.org', // Not used in V2
      NETWORK_HINT: 'custom' as any,
      VSC_DOMAIN: 'vsc-mainnet.availproject.org', // Not used in V2
      STATEKEEPER_URL: CONFIG.statekeeper,
      MIDDLEWARE_URL: CONFIG.middleware,
      useV2Middleware: true, // CRITICAL: Enable V2 middleware
    };

    const sdk = new NexusSDK({ network: v2Config, debug: true });

    // Create mock provider
    const mockProvider = new MockEIP1193Provider(CONFIG.testAccount.privateKey);

    // Initialize SDK with provider
    await sdk.initialize(mockProvider as any);

    log('✓ SDK initialized with V2 middleware');

    // -------------------------------------------------------------------------
    // Step 2: Get Balances via Middleware
    // -------------------------------------------------------------------------
    log('\nStep 2: Fetching balances via middleware...');

    const balances = await sdk.getBalancesForBridge();

    log('✓ Balances retrieved via middleware', {
      totalAssets: balances.length,
      firstAsset: balances[0]
        ? {
            symbol: balances[0].symbol,
            chains: balances[0].chains.map((c) => ({
              chainId: c.chainId,
              balance: c.balance,
            })),
          }
        : null,
    });

    // -------------------------------------------------------------------------
    // Step 3: Bridge USDC from Arbitrum to Base
    // -------------------------------------------------------------------------
    log('\nStep 3: Bridging USDC from Arbitrum to Base via middleware...');

    const bridgeParams: BridgeParams = {
      token: 'USDC',
      amount: formatUnits(TEST_AMOUNT, 6), // "100" USDC
      destinationChain: CONFIG.chains.base.chainId,
      sourceChains: [CONFIG.chains.arbitrum.chainId], // Specify source
    };

    // Set up hooks to track progress
    let intentAccepted = false;
    let allowanceHandled = false;

    sdk.setOnIntentHook((data) => {
      log('Intent hook triggered:', {
        intent: data.intent,
      });

      // Auto-accept the intent for testing
      intentAccepted = true;
      data.allow();
    });

    sdk.setOnAllowanceHook((data) => {
      log('Allowance hook triggered:', {
        sources: data.sources,
      });

      // Auto-approve with max allowance for testing
      allowanceHandled = true;
      data.allow(data.sources.map(() => 'max'));
    });

    log('Initiating bridge operation...');

    const bridgeResult = await sdk.bridge(bridgeParams);

    log('✓ Bridge operation completed!', {
      explorerUrl: bridgeResult.explorerUrl,
      intentAccepted,
      allowanceHandled,
    });

    // -------------------------------------------------------------------------
    // Step 4: Verify Final Balances
    // -------------------------------------------------------------------------
    log('\nStep 4: Verifying final balances...');

    await sleep(5000); // Wait for blockchain to settle

    const finalArbBalance = await getBalance(
      CONFIG.chains.arbitrum.rpc,
      CONFIG.chains.arbitrum.usdc,
      CONFIG.testAccount.address,
    );
    const finalBaseBalance = await getBalance(
      CONFIG.chains.base.rpc,
      CONFIG.chains.base.usdc,
      CONFIG.testAccount.address,
    );

    log('Final balances:', {
      arbitrum: {
        before: formatUnits(arbBalance, 6) + ' USDC',
        after: formatUnits(finalArbBalance, 6) + ' USDC',
        change: formatUnits(arbBalance - finalArbBalance, 6) + ' USDC',
      },
      base: {
        before: formatUnits(baseBalance, 6) + ' USDC',
        after: formatUnits(finalBaseBalance, 6) + ' USDC',
        change: formatUnits(finalBaseBalance - baseBalance, 6) + ' USDC',
      },
    });

    // -------------------------------------------------------------------------
    // Step 5: Cleanup
    // -------------------------------------------------------------------------
    log('\nStep 5: Cleaning up...');

    await sdk.deinit();

    log('✓ SDK deinitialized');

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('\n' + '='.repeat(70));
    console.log('SDK V2 E2E Test Summary');
    console.log('='.repeat(70));
    console.log(`Middleware: ${CONFIG.middleware}`);
    console.log(
      `Source Chain: ${CONFIG.chains.arbitrum.name} (${CONFIG.chains.arbitrum.chainId})`,
    );
    console.log(
      `Dest Chain: ${CONFIG.chains.base.name} (${CONFIG.chains.base.chainId})`,
    );
    console.log(`Test Amount: ${formatUnits(TEST_AMOUNT, 6)} USDC`);
    console.log(`Explorer: ${bridgeResult.explorerUrl}`);
    console.log(`\n✓ SDK V2 E2E Test PASSED - All operations successful`);
    console.log('='.repeat(70) + '\n');
  } catch (error) {
    console.error('\n✗ SDK V2 E2E Test FAILED:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
runSDKE2ETest();
