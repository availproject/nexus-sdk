import { useState } from 'react';
import { NexusSDK, NEXUS_EVENTS } from '@avail-project/nexus-core';
import type { Hex } from 'viem';
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

// V2 Middleware Configuration for Local Anvil Testing
const V2_CONFIG = {
  STATEKEEPER_URL: 'http://localhost:9080',
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: true, // CRITICAL: Enable V2 middleware
};

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum',
  10: 'Optimism',
};

function BridgeUI() {
  const [sdk, setSdk] = useState<NexusSDK | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletAddress, setWalletAddress] = useState<Hex | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bridge form state
  const [selectedToken, setSelectedToken] = useState('USDC');
  const [amount, setAmount] = useState('100');
  const [sourceChain, setSourceChain] = useState(42161); // Arbitrum
  const [destinationChain, setDestinationChain] = useState(8453); // Base
  const [isBridging, setIsBridging] = useState(false);
  const [bridgeSteps, setBridgeSteps] = useState<BridgeStep[]>([]);
  const [bridgeResult, setBridgeResult] = useState<string | null>(null);

  // Initialize SDK
  const initializeSDK = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      // Check if MetaMask is available
      if (!window.ethereum) {
        throw new Error('MetaMask not found. Please install MetaMask.');
      }

      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found. Please unlock MetaMask.');
      }

      console.log('Connected to account:', accounts[0]);
      setWalletAddress(accounts[0] as Hex);

      // Initialize SDK with V2 middleware config
      console.log('Initializing SDK with V2 middleware config:', V2_CONFIG);
      const sdkInstance = new NexusSDK({ network: V2_CONFIG });

      await sdkInstance.initialize(window.ethereum as any);
      console.log('SDK initialized successfully');

      setSdk(sdkInstance);
      setIsConnected(true);

      // Load balances
      await loadBalances(sdkInstance);
    } catch (err: any) {
      console.error('Failed to initialize SDK:', err);
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  // Load balances
  const loadBalances = async (sdkInstance: NexusSDK) => {
    try {
      setIsLoadingBalances(true);
      setError(null);

      console.log('Fetching unified balances...');
      const unifiedBalances = await sdkInstance.getBalancesForBridge();
      console.log('Balances retrieved:', unifiedBalances);

      // Transform SDK balance format to our UI format
      const transformedBalances: Balance[] = unifiedBalances.map((asset: any) => ({
        symbol: asset.symbol,
        chains: asset.chains.map((chain: any) => ({
          chainId: chain.chainId,
          chainName: CHAIN_NAMES[chain.chainId] || `Chain ${chain.chainId}`,
          balance: chain.balance,
        })),
      }));

      setBalances(transformedBalances);
    } catch (err: any) {
      console.error('Failed to load balances:', err);
      setError(err.message || 'Failed to load balances');
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

      console.log('Starting bridge operation:', {
        token: selectedToken,
        amount,
        sourceChain,
        destinationChain,
      });

      // Bridge using SDK
      const result = await sdk.bridge(
        {
          token: selectedToken,
          amount, // SDK accepts string or bigint
          toChainId: destinationChain,
          sourceChains: [sourceChain],
        },
        {
          onEvent: (event) => {
            console.log('Bridge event:', event);

            if (event.name === NEXUS_EVENTS.STEPS_LIST) {
              console.log('Bridge steps:', event.args);
              setBridgeSteps(
                event.args.map((step) => ({
                  typeID: step.typeID,
                  title: step.title,
                  status: 'pending',
                })),
              );
            }

            if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
              console.log('Step completed:', event.args);
              setBridgeSteps((prev) =>
                prev.map((step) =>
                  step.typeID === event.args.typeID ? { ...step, status: 'complete' } : step,
                ),
              );
            }
          },
        },
      );

      console.log('Bridge completed:', result);
      setBridgeResult(result.explorerUrl);

      // Reload balances after bridge
      await loadBalances(sdk);
    } catch (err: any) {
      console.error('Bridge failed:', err);
      setError(err.message || 'Bridge operation failed');
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

  // Get available chains for selected token
  const getAvailableChains = () => {
    const tokenBalance = balances.find((b) => b.symbol === selectedToken);
    if (!tokenBalance) return [];
    return tokenBalance.chains;
  };

  return (
    <div className="bridge-container">
      <div className="bridge-header">
        <h2>🌉 Bridge Tokens</h2>
        <p className="bridge-subtitle">
          Using V2 Middleware • {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </p>
      </div>

      {!isConnected ? (
        <div className="connect-section">
          <p className="connect-text">Connect your wallet to start bridging</p>
          <button
            onClick={initializeSDK}
            disabled={isConnecting}
            className="btn btn-primary btn-large"
          >
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
          {error && <div className="error-message">{error}</div>}
        </div>
      ) : (
        <>
          {/* Wallet Info */}
          <div className="wallet-info">
            <div className="info-item">
              <span className="info-label">Wallet:</span>
              <code className="info-value">
                {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
              </code>
            </div>
            <button
              onClick={() => loadBalances(sdk!)}
              disabled={isLoadingBalances}
              className="btn btn-small btn-secondary"
            >
              {isLoadingBalances ? '🔄 Loading...' : '🔄 Refresh'}
            </button>
          </div>

          {/* Balances */}
          <div className="balances-section">
            <h3>💰 Your Balances</h3>
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
                          <span className="chain-name">
                            {CHAIN_NAMES[chain.chainId] || `Chain ${chain.chainId}`}
                          </span>
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
            <h3>🚀 Bridge</h3>

            <div className="form-row">
              <div className="form-group">
                <label>Token</label>
                <select
                  value={selectedToken}
                  onChange={(e) => setSelectedToken(e.target.value)}
                  disabled={isBridging}
                  className="form-control"
                >
                  {balances.map((b) => (
                    <option key={b.symbol} value={b.symbol}>
                      {b.symbol}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Amount</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isBridging}
                  className="form-control"
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                />
                <small className="form-hint">
                  Available: {getSourceBalance()} {selectedToken}
                </small>
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
                  {getAvailableChains().map((chain) => (
                    <option key={chain.chainId} value={chain.chainId}>
                      {CHAIN_NAMES[chain.chainId] || `Chain ${chain.chainId}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-arrow">→</div>

              <div className="form-group">
                <label>To Chain</label>
                <select
                  value={destinationChain}
                  onChange={(e) => setDestinationChain(Number(e.target.value))}
                  disabled={isBridging}
                  className="form-control"
                >
                  <option value={1}>Ethereum</option>
                  <option value={137}>Polygon</option>
                  <option value={8453}>Base</option>
                  <option value={42161}>Arbitrum</option>
                  <option value={10}>Optimism</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleBridge}
              disabled={isBridging || !amount || parseFloat(amount) <= 0}
              className="btn btn-primary btn-large"
            >
              {isBridging ? '🔄 Bridging...' : `Bridge ${amount} ${selectedToken}`}
            </button>
          </div>

          {/* Bridge Progress */}
          {bridgeSteps.length > 0 && (
            <div className="bridge-progress">
              <h3>📊 Bridge Progress</h3>
              <div className="steps-list">
                {bridgeSteps.map((step, index) => (
                  <div
                    key={step.typeID}
                    className={`step-item ${step.status === 'complete' ? 'step-complete' : 'step-pending'}`}
                  >
                    <span className="step-number">{index + 1}</span>
                    <span className="step-title">{step.title}</span>
                    <span className="step-status">{step.status === 'complete' ? '✅' : '⏳'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bridge Result */}
          {bridgeResult && (
            <div className="bridge-result">
              <h3>✅ Bridge Successful!</h3>
              <p>View your transaction:</p>
              <a
                href={bridgeResult}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-link"
              >
                {bridgeResult}
              </a>
            </div>
          )}

          {/* Error */}
          {error && <div className="error-message">{error}</div>}
        </>
      )}
    </div>
  );
}

export default BridgeUI;
