import { useState } from 'react';
import './App.css';
import V2MiddlewareTest from './components/V2MiddlewareTest';
import BridgeUI from './components/BridgeUI';

function App() {
  const [activeTab, setActiveTab] = useState<'bridge' | 'test' | 'config'>('bridge');

  return (
    <div className="App">
      <header className="app-header">
        <h1>Nexus SDK V2 Testnet</h1>
        <p className="subtitle">Bridge tokens across testnets with V2 Middleware</p>
      </header>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'bridge' ? 'active' : ''}`}
          onClick={() => setActiveTab('bridge')}
        >
          🌉 Bridge
        </button>
        <button
          className={`tab ${activeTab === 'test' ? 'active' : ''}`}
          onClick={() => setActiveTab('test')}
        >
          🧪 Tests
        </button>
        <button
          className={`tab ${activeTab === 'config' ? 'active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          ⚙️ Config
        </button>
      </div>

      <main className="main-content">
        {activeTab === 'bridge' && <BridgeUI />}
        {activeTab === 'test' && <V2MiddlewareTest />}
        {activeTab === 'config' && (
          <div className="config-panel">
            <h2>Testnet Configuration</h2>
            <div className="config-info">
              <div className="config-item">
                <label>Middleware URL:</label>
                <code>http://localhost:4050</code>
              </div>
              <div className="config-item">
                <label>Statekeeper URL:</label>
                <code>http://64.225.34.135:9080</code>
              </div>
              <div className="config-item">
                <label>V2 Middleware Enabled:</label>
                <code className="success">true</code>
              </div>
              <div className="config-item">
                <label>Chains:</label>
                <code>Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, Polygon Amoy</code>
              </div>
            </div>
            <div className="config-note">
              <strong>Note:</strong> Make sure middleware is running on port 4050.
              Connect your wallet to test on real testnets.
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Nexus SDK V2 Integration Test • Built with React + Vite + TypeScript
        </p>
      </footer>
    </div>
  );
}

export default App;
