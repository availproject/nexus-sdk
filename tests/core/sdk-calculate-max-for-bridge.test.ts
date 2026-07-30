import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeMaxParams, BridgeMaxResult } from '../../src';
import { createNexusClient } from '../../src';

const hoisted = vi.hoisted(() => ({
  calculateMaxForBridge: vi.fn(),
  peekChainList: vi.fn(),
  reportOperationError: vi.fn(),
  setAnalytics: vi.fn(),
}));

vi.mock('../../src/core/sdk/base', () => ({
  createBase: vi.fn(() => ({
    calculateMaxForBridge: hoisted.calculateMaxForBridge,
    peekChainList: hoisted.peekChainList,
    setAnalytics: hoisted.setAnalytics,
  })),
}));

vi.mock('../../src/services/error-telemetry', () => ({
  reportOperationError: hoisted.reportOperationError,
}));

const input: BridgeMaxParams = {
  toChainId: 8453,
  toTokenSymbol: 'USDC',
  sources: [10, 42161],
};

const maxResult: BridgeMaxResult = {
  toChainId: 8453,
  toTokenSymbol: 'USDC',
  provider: 'nexus',
  maxAmount: '2.5',
  maxAmountRaw: 2_500_000n,
  symbol: 'USDC',
  decimals: 6,
  sources: [
    {
      chainId: 10,
      tokenAddress: '0x0000000000000000000000000000000000000010',
      symbol: 'USDC',
      decimals: 6,
      amount: '2.5',
    },
  ],
};

const makeClient = () => {
  const client = createNexusClient({
    network: 'testnet',
    analytics: { enabled: true },
  });
  client.analytics.enable();
  return client;
};

describe('createNexusClient calculateMaxForBridge analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits the operation lifecycle and preserves the max result', async () => {
    hoisted.calculateMaxForBridge.mockResolvedValue(maxResult);
    const client = makeClient();
    const trackSpy = vi.spyOn(client.analytics, 'track');
    trackSpy.mockClear();

    await expect(client.calculateMaxForBridge(input)).resolves.toBe(maxResult);

    expect(hoisted.calculateMaxForBridge).toHaveBeenCalledWith(input);
    expect(trackSpy).toHaveBeenCalledWith('nexus_v2_calculate_max_for_bridge_initiated', {
      toChainId: 8453,
      tokenSymbol: 'USDC',
      sourceChains: [10, 42161],
    });
    expect(trackSpy).toHaveBeenCalledWith('nexus_v2_calculate_max_for_bridge_success', {
      toChainId: 8453,
      tokenSymbol: 'USDC',
      sourceChains: [10, 42161],
    });
    expect(trackSpy).toHaveBeenCalledWith(
      'nexus_v2_operation_performance',
      expect.objectContaining({
        operation: 'calculate_max_for_bridge',
        success: true,
      })
    );
  });

  it('emits failure analytics and rethrows the original error', async () => {
    const failure = new Error('bridge max unavailable');
    hoisted.calculateMaxForBridge.mockRejectedValue(failure);
    const client = makeClient();
    const trackSpy = vi.spyOn(client.analytics, 'track');
    trackSpy.mockClear();

    await expect(client.calculateMaxForBridge(input)).rejects.toBe(failure);

    expect(trackSpy).toHaveBeenCalledWith('nexus_v2_calculate_max_for_bridge_failed', {
      toChainId: 8453,
      tokenSymbol: 'USDC',
      sourceChains: [10, 42161],
    });
    expect(trackSpy).not.toHaveBeenCalledWith(
      'nexus_v2_calculate_max_for_bridge_success',
      expect.anything()
    );
    expect(hoisted.reportOperationError).toHaveBeenCalledWith({
      operation: 'calculateMaxForBridge',
      operationId: expect.any(String),
      params: input,
      options: undefined,
      error: failure,
    });
    expect(trackSpy).toHaveBeenCalledWith(
      'nexus_v2_operation_performance',
      expect.objectContaining({
        operation: 'calculate_max_for_bridge',
        success: false,
      })
    );
  });
});
