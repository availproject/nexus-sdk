import { Universe } from '@avail-project/ca-common';
import type { PublicClient } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublicClient = vi.hoisted(() => ({ kind: 'publicClient' })) as unknown as PublicClient;
const createPublicClientMock = vi.hoisted(() => vi.fn(() => mockPublicClient));
const estimateTotalFeesMock = vi.hoisted(() => vi.fn());
const erc20GetAllowanceMock = vi.hoisted(() => vi.fn());

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
    http: vi.fn(() => ({})),
  };
});

vi.mock('../../../../src/sdk/ca-base/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/sdk/ca-base/utils')>(
    '../../../../src/sdk/ca-base/utils'
  );
  return {
    ...actual,
    erc20GetAllowance: erc20GetAllowanceMock,
    getL1Fee: vi.fn().mockResolvedValue(0n),
    getPctGasBufferByChain: vi.fn().mockReturnValue(0.5),
    pctAdditionWithSuggestion: vi.fn((base: bigint) => [base, base]),
  };
});

vi.mock('../../../../src/services/feeEstimation', () => ({
  estimateTotalFees: estimateTotalFeesMock,
}));

import { BridgeAndExecuteQuery } from '../../../../src/sdk/ca-base/query/bridgeAndExecute';

const USER_ADDRESS = '0x1111111111111111111111111111111111111111' as const;
const SPENDER = '0x2222222222222222222222222222222222222222' as const;
const TARGET = '0x3333333333333333333333333333333333333333' as const;
const TOKEN = '0x4444444444444444444444444444444444444444' as const;

const dstChain = {
  id: 42161,
  name: 'Arbitrum',
  ankrName: 'arbitrum',
  blockExplorers: {
    default: {
      name: 'Arbiscan',
      url: 'https://arbiscan.io',
    },
  },
  custom: {
    icon: '',
    knownTokens: [],
  },
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.example'],
      webSocket: [],
    },
  },
  swapSupported: true,
  universe: Universe.ETHEREUM,
} as const;

const tokenInfo = {
  contractAddress: TOKEN,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
};

describe('BridgeAndExecuteQuery fee estimation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPublicClientMock.mockReturnValue(mockPublicClient);
    erc20GetAllowanceMock.mockResolvedValue(0n);
    estimateTotalFeesMock.mockResolvedValue([
      {
        l1Fee: 0n,
        l2Fee: 0n,
        total: 0n,
        recommended: {
          gasLimit: 84_000n,
          maxFeePerGas: 17n,
          maxPriorityFeePerGas: 2n,
          totalMaxCost: 1_428_000n,
          useLegacyPricing: true,
        },
      },
      {
        l1Fee: 0n,
        l2Fee: 0n,
        total: 0n,
        recommended: {
          gasLimit: 25_000n,
          maxFeePerGas: 17n,
          maxPriorityFeePerGas: 2n,
          totalMaxCost: 425_000n,
          useLegacyPricing: true,
        },
      },
    ]);
  });

  it('builds fee-estimate items for approval and execute txs and uses the helper result', async () => {
    const chainList = {
      getChainAndTokenFromSymbol: vi.fn(() => ({
        chain: dstChain,
        token: { ...tokenInfo, isNative: false },
      })),
      getChainByID: vi.fn(() => dstChain),
      getTokenInfoBySymbol: vi.fn(() => tokenInfo),
    } as never;

    const query = new BridgeAndExecuteQuery(
      chainList,
      {
        getAddresses: vi.fn().mockResolvedValue([USER_ADDRESS]),
      } as never,
      vi.fn() as never,
      vi.fn().mockResolvedValue([]) as never,
      {
        simulateBundleV2: vi.fn(),
      } as never
    );

    const result = await (query as any).estimateBridgeAndExecute({
      token: 'USDC',
      amount: 1_000_000n,
      toChainId: dstChain.id,
      execute: {
        to: TARGET,
        data: '0x1234',
        value: 0n,
        gas: 21_000n,
        gasPrice: 'medium',
        tokenApproval: {
          token: 'USDC',
          amount: 1_000_000n,
          spender: SPENDER,
        },
      },
    });

    expect(estimateTotalFeesMock).toHaveBeenCalledTimes(1);
    expect(estimateTotalFeesMock).toHaveBeenCalledWith(
      mockPublicClient,
      [
        expect.objectContaining({
          gasEstimate: 70_000n,
        }),
        expect.objectContaining({
          gasEstimate: 21_000n,
        }),
      ],
      'medium'
    );

    const [, items] = estimateTotalFeesMock.mock.calls[0] ?? [];
    expect(items).toHaveLength(2);
    expect(
      items?.every(
        (item: { gasEstimateKind?: 'raw' | 'final' }) => item.gasEstimateKind !== 'final'
      )
    ).toBe(true);
    expect(result.approvalTx?.gas).toBe(84_000n);
    expect(result.tx.gas).toBe(25_000n);
    expect(result.gas).toEqual({
      approval: 84_000n,
      tx: 25_000n,
    });
    expect(result.feeParams).toEqual({
      type: 'legacy',
      gasPrice: 17n,
    });
    expect(result.gasPrice).toBe(17n);
    expect(result.gasFee).toBe(1_853_000n);
  });
});
