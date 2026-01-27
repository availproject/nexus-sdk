import { useState, useEffect } from 'react';
import { NexusSDK, NEXUS_EVENTS } from '@avail-project/nexus-core';
import { createWalletClient, http, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';
import './BridgeUI.css';

interface Balance {
  symbol: string;
  chains: Array<{
    chainId: number;
    chainName: string;
    balance: string;
  }>;
}

interface BridgeStep {
  typeID: string;
  title: string;
  status: 'pending' | 'complete';
}

interface BridgeStepEvent {
  typeID: string;
  type?: string;
}

// Minimal EIP-1193 provider interface for SDK compatibility
interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => EIP1193Provider;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => EIP1193Provider;
}

// Anvil test account - DO NOT use on mainnet!
const ANVIL_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const ANVIL_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Hex;

// Local Anvil RPC endpoints
const ANVIL_RPCS: Record<number, string> = {
  1: 'http://localhost:8545', // Ethereum
  42161: 'http://localhost:8546', // Arbitrum
  137: 'http://localhost:8547', // Polygon
  8453: 'http://localhost:8548', // Base
};

// Custom vault addresses for local middleware testing
// These MUST match middleware/src/modules/approvals/constants.ts exactly
const VAULT_ADDRESSES: Record<number, `0x${string}`> = {
  1: '0x1f92fF844cedcD3F0941e12cafaBD5EF2DD7a462', // Ethereum - from middleware constants
  42161: '0x32DD1A542652879e7F4Af4Cb7a553401Dd93Daab', // Arbitrum - from middleware constants
  137: '0xae5926A1AD0FED47b868E16325b5B10853017236', // Polygon - from middleware constants
  8453: '0x05052e0276c5bDCa620c2c0663E80E585dAe3445', // Base - from middleware constants
};

// V2 Middleware Configuration for Local Anvil Testing
// Note: NETWORK_HINT values: 0 = FOLLY (testnet), 2 = CORAL (canary), 3 = JADE (mainnet)
const V2_CONFIG = {
  COSMOS_URL: 'https://cosmos-mainnet.availproject.org',
  EXPLORER_URL: 'http://localhost:3000/explorer',
  GRPC_URL: 'https://grpcproxy-mainnet.availproject.org',
  NETWORK_HINT: 3, // Environment.JADE (mainnet) - use 3 for mainnet chain forks
  VSC_DOMAIN: 'vsc-mainnet.availproject.org',
  STATEKEEPER_URL: 'http://localhost:9080',
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: true,
  rpcOverrides: ANVIL_RPCS, // Use Anvil RPCs for permit nonce fetching
  vaultOverrides: VAULT_ADDRESSES, // Use custom vault addresses for local middleware
};

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
};

/**
 * Create an EIP-1193 compatible provider from Anvil private key
 */
function createAnvilProvider(): EIP1193Provider {
  const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);

  // Create wallet client for primary chain (Arbitrum)
  const walletClient: WalletClient = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(ANVIL_RPCS[42161]),
  });

  // EIP-1193 compatible provider
  const provider: EIP1193Provider = {
    request: async ({ method, params }) => {
      const p = params as Hex[] | undefined;
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account.address];
        case 'eth_chainId':
          return '0xa4b1'; // 42161 in hex (Arbitrum)
        case 'personal_sign': {
          if (!p) throw new Error('No params for personal_sign');
          return walletClient.signMessage({
            account,
            message: { raw: p[0] },
          });
        }
        case 'eth_signTypedData_v4': {
          if (!p) throw new Error('No params for eth_signTypedData_v4');
          const typedData = JSON.parse(p[1]);
          return walletClient.signTypedData(typedData);
        }
        case 'eth_sendTransaction': {
          if (!p) throw new Error('No params for eth_sendTransaction');
          const txParams = p[0] as unknown as Parameters<typeof walletClient.sendTransaction>[0];
          return walletClient.sendTransaction(txParams);
        }
        default:
          return walletClient.request({
            method,
            params,
          } as Parameters<typeof walletClient.request>[0]);
      }
    },
    on: () => provider,
    removeListener: () => provider,
  };

  return provider;
}

function BridgeUI() {
  const [sdk, setSdk] = useState<NexusSDK | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bridge form state
  const [selectedToken, setSelectedToken] = useState('USDC');
  const [amount, setAmount] = useState('10');
  const [sourceChain, setSourceChain] = useState(42161); // Arbitrum
  const [destinationChain, setDestinationChain] = useState(137); // Polygon
  const [isBridging, setIsBridging] = useState(false);
  const [bridgeSteps, setBridgeSteps] = useState<BridgeStep[]>([]);
  const [bridgeResult, setBridgeResult] = useState<string | null>(null);

  // Auto-initialize on mount
  useEffect(() => {
    initializeSDK();
  }, []);

  // Initialize SDK with Anvil key
  const initializeSDK = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      const provider = createAnvilProvider();
      const sdkInstance = new NexusSDK({ network: V2_CONFIG });
      await sdkInstance.initialize(provider);
      console.log('SDK initialized with Anvil account:', ANVIL_ADDRESS);

      setSdk(sdkInstance);
      setIsConnected(true);

      // Load balances
      await loadBalances(sdkInstance);
    } catch (err) {
      console.error('Failed to initialize SDK:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize SDK');
    } finally {
      setIsConnecting(false);
    }
  };

  // Load balances
  const loadBalances = async (sdkInstance: NexusSDK) => {
    try {
      setIsLoadingBalances(true);
      setError(null);

      const unifiedBalances = await sdkInstance.getBalancesForBridge();

      // Transform SDK balance format to our UI format
      // SDK returns UserAssetDatum with `breakdown` array, not `chains`
      const transformedBalances: Balance[] = unifiedBalances.map((asset) => ({
        symbol: asset.symbol,
        chains: (asset.breakdown || []).map((item) => ({
          chainId: item.chain.id,
          chainName: CHAIN_NAMES[item.chain.id] || item.chain.name || `Chain ${item.chain.id}`,
          balance: item.balance,
        })),
      }));

      setBalances(transformedBalances);
    } catch (err) {
      console.error('Failed to load balances:', err);
      setError(err instanceof Error ? err.message : 'Failed to load balances');
    } finally {
      setIsLoadingBalances(false);
    }
  };

  // Bridge tokens
  const handleBridge = async () => {
    if (!sdk) {
      setError('SDK not initialized');
      return;
    }

    try {
      setIsBridging(true);
      setError(null);
      setBridgeSteps([]);
      setBridgeResult(null);

      console.log(`Bridging ${amount} ${selectedToken}: ${CHAIN_NAMES[sourceChain]} → ${CHAIN_NAMES[destinationChain]}`);

      // Bridge using SDK
      const result = await sdk.bridge(
        {
          token: selectedToken,
          amount: BigInt(parseFloat(amount) * 1e6), // Convert to USDC decimals
          toChainId: destinationChain,
          sourceChains: [sourceChain],
        }, // Type assertion for flexibility
        {
          onEvent: (event) => {
            if (event.name === NEXUS_EVENTS.STEPS_LIST) {
              const steps = event.args as BridgeStepEvent[];
              setBridgeSteps(
                steps.map((step) => ({
                  typeID: step.typeID,
                  title: step.type || step.typeID,
                  status: 'pending' as const,
                })),
              );
            }

            if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
              const completedStep = event.args as BridgeStepEvent;
              setBridgeSteps((prev) =>
                prev.map((step) =>
                  step.typeID === completedStep.typeID ? { ...step, status: 'complete' as const } : step,
                ),
              );
            }
          },
        },
      );

      console.log('Bridge complete:', result.explorerUrl);
      setBridgeResult(result.explorerUrl);

      await loadBalances(sdk);
    } catch (err) {
      console.error('Bridge failed:', err);
      setError(err instanceof Error ? err.message : 'Bridge operation failed');
    } finally {
      setIsBridging(false);
    }
  };

  // Get balance for selected token and source chain
  const getSourceBalance = () => {
    const tokenBalance = balances.find((b) => b.symbol === selectedToken);
    if (!tokenBalance) return '0';

    const chainBalance = tokenBalance.chains.find((c) => c.chainId === sourceChain);
    return chainBalance?.balance || '0';
  };

  return (
    <div className="bridge-container">
      <div className="bridge-header">
        <h2>Bridge Tokens</h2>
        <p className="bridge-subtitle">
          V2 Middleware • Anvil Test Account • {isConnected ? 'Connected' : 'Disconnected'}
        </p>
      </div>

      {!isConnected ? (
        <div className="connect-section">
          {isConnecting ? (
            <p className="connect-text">Initializing SDK with Anvil account...</p>
          ) : (
            <>
              <p className="connect-text">Failed to connect. Click to retry.</p>
              <button onClick={initializeSDK} className="btn btn-primary btn-large">
                Retry Connection
              </button>
            </>
          )}
          {error && <div className="error-message">{error}</div>}
        </div>
      ) : (
        <>
          {/* Wallet Info */}
          <div className="wallet-info">
            <div className="info-item">
              <span className="info-label">Anvil Account:</span>
              <code className="info-value">
                {ANVIL_ADDRESS.slice(0, 6)}...{ANVIL_ADDRESS.slice(-4)}
              </code>
            </div>
            <button
              onClick={() => loadBalances(sdk!)}
              disabled={isLoadingBalances}
              className="btn btn-small btn-secondary"
            >
              {isLoadingBalances ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {error && <div className="error-message">{error}</div>}

          {/* Balances */}
          <div className="balances-section">
            <h3>Your Balances</h3>
            {isLoadingBalances ? (
              <div className="loading">Loading balances...</div>
            ) : balances.length === 0 ? (
              <div className="no-balances">No balances found</div>
            ) : (
              <div className="balances-grid">
                {balances.map((balance) => (
                  <div key={balance.symbol} className="balance-card">
                    <div className="balance-token">{balance.symbol}</div>
                    <div className="balance-chains">
                      {balance.chains.map((chain) => (
                        <div key={chain.chainId} className="chain-balance">
                          <span className="chain-name">{chain.chainName}</span>
                          <span className="chain-amount">{chain.balance}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bridge Form */}
          <div className="bridge-form">
            <h3>Bridge</h3>

            <div className="form-row">
              <div className="form-group">
                <label>Token</label>
                <select
                  value={selectedToken}
                  onChange={(e) => setSelectedToken(e.target.value)}
                  disabled={isBridging}
                  className="form-control"
                >
                  {balances.length > 0 ? (
                    balances.map((b) => (
                      <option key={b.symbol} value={b.symbol}>
                        {b.symbol}
                      </option>
                    ))
                  ) : (
                    <option value="USDC">USDC</option>
                  )}
                </select>
              </div>

              <div className="form-group">
                <label>Amount</label>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isBridging}
                  className="form-control"
                  placeholder="Amount to bridge"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>From Chain</label>
                <select
                  value={sourceChain}
                  onChange={(e) => setSourceChain(Number(e.target.value))}
                  disabled={isBridging}
                  className="form-control"
                >
                  <option value={42161}>Arbitrum</option>
                  <option value={137}>Polygon</option>
                  <option value={8453}>Base</option>
                  <option value={1}>Ethereum</option>
                </select>
                <small className="balance-hint">Balance: {getSourceBalance()}</small>
              </div>

              <div className="form-group">
                <label>To Chain</label>
                <select
                  value={destinationChain}
                  onChange={(e) => setDestinationChain(Number(e.target.value))}
                  disabled={isBridging}
                  className="form-control"
                >
                  <option value={137}>Polygon</option>
                  <option value={42161}>Arbitrum</option>
                  <option value={8453}>Base</option>
                  <option value={1}>Ethereum</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleBridge}
              disabled={isBridging || !amount}
              className="btn btn-primary btn-large"
            >
              {isBridging ? 'Bridging...' : 'Bridge Tokens'}
            </button>
          </div>

          {/* Bridge Progress */}
          {bridgeSteps.length > 0 && (
            <div className="bridge-progress">
              <h3>Progress</h3>
              <div className="steps-list">
                {bridgeSteps.map((step) => (
                  <div
                    key={step.typeID}
                    className={`step-item ${step.status === 'complete' ? 'complete' : ''}`}
                  >
                    <span className="step-icon">{step.status === 'complete' ? '✓' : '○'}</span>
                    <span className="step-title">{step.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bridge Result */}
          {bridgeResult && (
            <div className="bridge-result success">
              <h3>Bridge Complete!</h3>
              <a href={bridgeResult} target="_blank" rel="noopener noreferrer">
                View on Explorer
              </a>
            </div>
          )}
        </>
      )}

      {/* Info Box */}
      <div className="info-box">
        <h4>Test Environment</h4>
        <ul>
          <li>Using Anvil test account (deployer key)</li>
          <li>Middleware: {V2_CONFIG.MIDDLEWARE_URL}</li>
          <li>Statekeeper: {V2_CONFIG.STATEKEEPER_URL}</li>
        </ul>
      </div>
    </div>
  );
}

export default BridgeUI;
