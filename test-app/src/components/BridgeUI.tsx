import { useState, useEffect } from 'react';
import { NexusSDK, NEXUS_EVENTS } from '@avail-project/nexus-core';
import { ConnectKitButton } from 'connectkit';
import { useAccount, useWalletClient } from 'wagmi';
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

// Testnet chain configuration
const TESTNET_CHAINS = {
  11155111: { name: 'Ethereum Sepolia', symbol: 'ETH' },
  421614: { name: 'Arbitrum Sepolia', symbol: 'ETH' },
  84532: { name: 'Base Sepolia', symbol: 'ETH' },
  80002: { name: 'Polygon Amoy', symbol: 'POL' },
};

const CHAIN_IDS = Object.keys(TESTNET_CHAINS).map(Number);

// Testnet vault addresses (from provided config)
const VAULT_ADDRESSES: Record<number, `0x${string}`> = {
  11155111: '0x82a45a6cbe14b2707a3b375cf0aa5eb74c95a5bb', // Ethereum Sepolia
  421614: '0x590cb8868c6debc12ccd42e837042659cfb91504', // Arbitrum Sepolia
  84532: '0x30dc8fd71fa448c30da563df5efa151c840e610e', // Base Sepolia
  80002: '0x10b69f0e3c21c1187526940a615959e9ee6012f9', // Polygon Amoy
};

// V2 Middleware Configuration for Testnet
const V2_CONFIG = {
  COSMOS_URL: 'https://cosmos-mainnet.availproject.org',
  EXPLORER_URL: 'http://64.225.34.135:3000/',
  GRPC_URL: 'https://grpcproxy-mainnet.availproject.org',
  NETWORK_HINT: 0, // FOLLY (testnet)
  VSC_DOMAIN: 'vsc-testnet.availproject.org',
  STATEKEEPER_URL: 'http://64.225.34.135:9080',
  MIDDLEWARE_URL: 'http://localhost:4050',
  useV2Middleware: true,
  rpcOverrides: {
    11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
    421614: 'https://sepolia-rollup.arbitrum.io/rpc',
    84532: 'https://sepolia.base.org',
    80002: 'https://rpc-amoy.polygon.technology',
  },
  vaultOverrides: VAULT_ADDRESSES,
};

function BridgeUI() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [sdk, setSdk] = useState<NexusSDK | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bridge form state
  const [selectedToken, setSelectedToken] = useState('USDC');
  const [amount, setAmount] = useState('1');
  const [sourceChain, setSourceChain] = useState(421614); // Arbitrum Sepolia
  const [destinationChain, setDestinationChain] = useState(80002); // Polygon Amoy
  const [isBridging, setIsBridging] = useState(false);
  const [bridgeSteps, setBridgeSteps] = useState<BridgeStep[]>([]);
  const [bridgeResult, setBridgeResult] = useState<string | null>(null);

  // Initialize SDK when wallet connects
  useEffect(() => {
    if (isConnected && walletClient && !isInitialized) {
      initializeSDK();
    }
  }, [isConnected, walletClient, isInitialized]);

  // Reset SDK when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      setSdk(null);
      setIsInitialized(false);
      setBalances([]);
    }
  }, [isConnected]);

  const initializeSDK = async () => {
    if (!walletClient) return;

    try {
      setError(null);

      // Create EIP-1193 provider from wallet client
      const provider = {
        request: walletClient.request.bind(walletClient),
        on: () => provider,
        removeListener: () => provider,
      };

      const sdkInstance = new NexusSDK({ network: V2_CONFIG });
      await sdkInstance.initialize(provider);
      console.log('SDK initialized with wallet:', address);

      setSdk(sdkInstance);
      setIsInitialized(true);

      // Load balances
      await loadBalances(sdkInstance);
    } catch (err) {
      console.error('Failed to initialize SDK:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize SDK');
    }
  };

  const loadBalances = async (sdkInstance: NexusSDK) => {
    try {
      setIsLoadingBalances(true);
      setError(null);

      const unifiedBalances = await sdkInstance.getBalancesForBridge();

      // Transform SDK balance format to our UI format
      const transformedBalances: Balance[] = unifiedBalances.map((asset) => ({
        symbol: asset.symbol,
        chains: (asset.breakdown || []).map((item) => ({
          chainId: item.chain.id,
          chainName:
            TESTNET_CHAINS[item.chain.id as keyof typeof TESTNET_CHAINS]?.name ||
            `Chain ${item.chain.id}`,
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

      const sourceChainName =
        TESTNET_CHAINS[sourceChain as keyof typeof TESTNET_CHAINS]?.name || sourceChain;
      const destChainName =
        TESTNET_CHAINS[destinationChain as keyof typeof TESTNET_CHAINS]?.name || destinationChain;

      console.log(`Bridging ${amount} ${selectedToken}: ${sourceChainName} -> ${destChainName}`);

      const result = await sdk.bridge(
        {
          token: selectedToken,
          amount: BigInt(parseFloat(amount) * 1e6), // USDC has 6 decimals
          toChainId: destinationChain,
          sourceChains: [sourceChain],
        },
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
                  step.typeID === completedStep.typeID
                    ? { ...step, status: 'complete' as const }
                    : step,
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
        <p className="bridge-subtitle">V2 Middleware - Testnet</p>
      </div>

      {!isConnected ? (
        <div className="connect-section">
          <p className="connect-text">Connect your wallet to start bridging</p>
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button onClick={show} className="btn btn-primary btn-large">
                Connect Wallet
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      ) : (
        <>
          {/* Wallet Info */}
          <div className="wallet-info">
            <div className="info-item">
              <span className="info-label">Connected:</span>
              <code className="info-value">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </code>
            </div>
            <div className="wallet-actions">
              <button
                onClick={() => sdk && loadBalances(sdk)}
                disabled={isLoadingBalances || !sdk}
                className="btn btn-small btn-secondary"
              >
                {isLoadingBalances ? 'Loading...' : 'Refresh'}
              </button>
              <ConnectKitButton.Custom>
                {({ show }) => (
                  <button onClick={show} className="btn btn-small btn-outline">
                    Wallet
                  </button>
                )}
              </ConnectKitButton.Custom>
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          {/* Balances */}
          <div className="balances-section">
            <h3>Your Balances</h3>
            {isLoadingBalances ? (
              <div className="loading">Loading balances...</div>
            ) : balances.length === 0 ? (
              <div className="no-balances">No balances found. Get testnet USDC from a faucet.</div>
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
                  {CHAIN_IDS.map((chainId) => (
                    <option key={chainId} value={chainId}>
                      {TESTNET_CHAINS[chainId as keyof typeof TESTNET_CHAINS]?.name}
                    </option>
                  ))}
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
                  {CHAIN_IDS.filter((id) => id !== sourceChain).map((chainId) => (
                    <option key={chainId} value={chainId}>
                      {TESTNET_CHAINS[chainId as keyof typeof TESTNET_CHAINS]?.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleBridge}
              disabled={isBridging || !amount || !sdk}
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
        <h4>Testnet Environment</h4>
        <ul>
          <li>Middleware: {V2_CONFIG.MIDDLEWARE_URL}</li>
          <li>Statekeeper: {V2_CONFIG.STATEKEEPER_URL}</li>
          <li>Chains: Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, Polygon Amoy</li>
        </ul>
      </div>
    </div>
  );
}

export default BridgeUI;
