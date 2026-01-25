import { useState } from 'react';
import axios from 'axios';
import type { Hex } from 'viem';
import './V2MiddlewareTest.css';

interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
  data?: any;
  duration?: number;
}

const CONFIG = {
  middleware: 'http://localhost:3000',
  statekeeper: 'http://localhost:9080',
  testAccount: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Hex,
};

function V2MiddlewareTest() {
  const [tests, setTests] = useState<TestResult[]>([
    { name: 'Test 1: Middleware Health Check', status: 'pending' },
    { name: 'Test 2: Fetch Balances via Middleware', status: 'pending' },
    { name: 'Test 3: Statekeeper Health Check', status: 'pending' },
  ]);

  const [isRunning, setIsRunning] = useState(false);

  const updateTest = (
    index: number,
    update: Partial<TestResult>,
  ) => {
    setTests((prev) =>
      prev.map((test, i) => (i === index ? { ...test, ...update } : test)),
    );
  };

  const runTest = async (
    index: number,
    testFn: () => Promise<{ message: string; data?: any }>,
  ) => {
    const startTime = Date.now();
    updateTest(index, { status: 'running' });

    try {
      const result = await testFn();
      const duration = Date.now() - startTime;
      updateTest(index, {
        status: 'success',
        message: result.message,
        data: result.data,
        duration,
      });
      return true;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      updateTest(index, {
        status: 'error',
        message: error.message || 'Test failed',
        data: error.response?.data,
        duration,
      });
      return false;
    }
  };

  const runAllTests = async () => {
    setIsRunning(true);
    let allPassed = true;

    // Test 1: Middleware Health
    const test1Pass = await runTest(0, async () => {
      const response = await axios.get(`${CONFIG.middleware}/`, {
        headers: { Accept: 'application/json' },
      });
      return {
        message: '✓ Middleware is healthy',
        data: response.data,
      };
    });
    allPassed = allPassed && test1Pass;

    // Test 2: Fetch Balances
    if (test1Pass) {
      const test2Pass = await runTest(1, async () => {
        const response = await axios.get(
          `${CONFIG.middleware}/api/v1/balance/evm/${CONFIG.testAccount}`,
          { headers: { Accept: 'application/json' } },
        );

        const chainIds = Object.keys(response.data);
        const chainsWithBalances = chainIds.filter(
          (chainId) =>
            response.data[chainId].currencies &&
            response.data[chainId].currencies.length > 0,
        );

        return {
          message: `✓ Retrieved balances for ${chainIds.length} chains`,
          data: {
            chains: chainIds.length,
            chainsWithBalances: chainsWithBalances.length,
            balances: response.data,
          },
        };
      });
      allPassed = allPassed && test2Pass;
    }

    // Test 3: Statekeeper Health
    if (test1Pass) {
      await runTest(2, async () => {
        const response = await axios.get(`${CONFIG.statekeeper}/health`);
        return {
          message: '✓ Statekeeper is healthy',
          data: response.data,
        };
      });
    }

    setIsRunning(false);

    return allPassed;
  };

  const resetTests = () => {
    setTests((prev) =>
      prev.map((test) => ({ ...test, status: 'pending', message: undefined, data: undefined, duration: undefined })),
    );
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'pending':
        return '⏸️';
      case 'running':
        return '⏳';
      case 'success':
        return '✅';
      case 'error':
        return '❌';
    }
  };

  const getStatusClass = (status: TestResult['status']) => {
    switch (status) {
      case 'pending':
        return 'test-pending';
      case 'running':
        return 'test-running';
      case 'success':
        return 'test-success';
      case 'error':
        return 'test-error';
    }
  };

  return (
    <div className="test-container">
      <div className="test-header">
        <h2>V2 Middleware Integration Tests</h2>
        <div className="test-controls">
          <button
            onClick={runAllTests}
            disabled={isRunning}
            className="btn btn-primary"
          >
            {isRunning ? 'Running Tests...' : 'Run All Tests'}
          </button>
          <button
            onClick={resetTests}
            disabled={isRunning}
            className="btn btn-secondary"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="test-list">
        {tests.map((test, index) => (
          <div
            key={index}
            className={`test-item ${getStatusClass(test.status)}`}
          >
            <div className="test-item-header">
              <span className="test-icon">{getStatusIcon(test.status)}</span>
              <span className="test-name">{test.name}</span>
              {test.duration !== undefined && (
                <span className="test-duration">{test.duration}ms</span>
              )}
            </div>

            {test.message && (
              <div className="test-message">{test.message}</div>
            )}

            {test.data && (
              <details className="test-data">
                <summary>View Data</summary>
                <pre>{JSON.stringify(test.data, null, 2)}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="test-info">
        <h3>Prerequisites</h3>
        <ul>
          <li>
            ✅ Middleware running on:{' '}
            <code>{CONFIG.middleware}</code>
          </li>
          <li>
            ✅ Statekeeper running on:{' '}
            <code>{CONFIG.statekeeper}</code>
          </li>
          <li>
            ✅ Test account: <code>{CONFIG.testAccount}</code>
          </li>
        </ul>
      </div>

      <div className="test-footer">
        <p className="info-text">
          <strong>Note:</strong> These tests verify the middleware API
          endpoints are accessible and returning expected data. For full SDK
          E2E testing including wallet integration, add more tests above.
        </p>
      </div>
    </div>
  );
}

export default V2MiddlewareTest;
