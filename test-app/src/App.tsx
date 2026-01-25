import { useState } from 'react';
import './App.css';
import V2MiddlewareTest from './components/V2MiddlewareTest';
import BridgeUI from './components/BridgeUI';

function App() {
  const [activeTab, setActiveTab] = useState<'bridge' | 'test' | 'config'>('bridge');

  return (
    <div className="App">
      <header className="app-header">
        <h1>🚀 Nexus SDK V2 Middleware Test</h1>
        <p className="subtitle">Test SDK integration with V2 Middleware APIs</p>
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
            <h2>Configuration</h2>
            <div className="config-info">
              <div className="config-item">
                <label>Middleware URL:</label>
                <code>http://localhost:3000</code>
              </div>
              <div className="config-item">
                <label>Statekeeper URL:</label>
                <code>http://localhost:9080</code>
              </div>
              <div className="config-item">
                <label>V2 Middleware Enabled:</label>
                <code className="success">true</code>
              </div>
              <div className="config-item">
                <label>Test Chains:</label>
                <code>Arbitrum (42161), Base (8453)</code>
              </div>
            </div>
            <div className="config-note">
              <strong>Note:</strong> Make sure middleware is running on port 3000
              and statekeeper on port 9080 before running tests.
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
