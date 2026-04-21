import { Universe } from '@avail-project/ca-common';
import type { PublicClient } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublicClient = vi.hoisted(() => ({ kind: 'publicClient' })) as unknown as PublicClient;
const createPublicClientMock = vi.hoisted(() => vi.fn(() => mockPublicClient));
const estimateFeeContextMock = vi.hoisted(() => vi.fn());
const finalizeFeeEstimatesMock = vi.hoisted(() => vi.fn());
const erc20GetAllowanceMock = vi.hoisted(() => vi.fn());
const getTokenInfoMock = vi.hoisted(() => vi.fn());
const estimateGasMock = vi.hoisted(() => vi.fn());

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
    http: vi.fn(() => ({})),
  };
});

vi.mock('../../../../src/core/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/core/utils')>(
    '../../../../src/core/utils'
  );
  return {
    ...actual,
    erc20GetAllowance: erc20GetAllowanceMock,
    getL1Fee: vi.fn().mockResolvedValue(0n),
    getPctGasBufferByChain: vi.fn().mockReturnValue(0.5),
    pctAdditionWithSuggestion: vi.fn((base: bigint) => [base, base]),
  };
});

vi.mock('../../../../src/swap/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/swap/utils')>(
    '../../../../src/swap/utils'
  );
  return {
    ...actual,
    getTokenInfo: getTokenInfoMock,
  };
});

vi.mock('../../../../src/services/feeEstimation', () => ({
  estimateFeeContext: estimateFeeContextMock,
  finalizeFeeEstimates: finalizeFeeEstimatesMock,
}));

import { SwapAndExecuteQuery } from '../../../../src/flows/swapAndExecute';

const USER_ADDRESS = '0x1111111111111111111111111111111111111111' as const;
const TARGET = '0x2222222222222222222222222222222222222222' as const;
const SPENDER = '0x3333333333333333333333333333333333333333' as const;
const TO_TOKEN = '0x4444444444444444444444444444444444444444' as const;
const APPROVAL_TOKEN = '0x5555555555555555555555555555555555555555' as const;

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

describe('SwapAndExecuteQuery fee estimation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockPublicClient as object, {
      estimateGas: estimateGasMock,
    });
    createPublicClientMock.mockReturnValue(mockPublicClient);
    erc20GetAllowanceMock.mockResolvedValue(0n);
    estimateGasMock.mockResolvedValue(50_000n);
    getTokenInfoMock.mockResolvedValue({
      contractAddress: TO_TOKEN,
      decimals: 6,
      symbol: 'USDC',
    });
    estimateFeeContextMock.mockResolvedValue({
      chainId: 42161,
      recommendation: {
        maxFeePerGas: 17n,
        maxPriorityFeePerGas: 2n,
      },
      overheads: [
        { l1Fee: 0n, extraGas: 0n },
        { l1Fee: 0n, extraGas: 0n },
      ],
    });
    finalizeFeeEstimatesMock.mockReturnValue([
      {
        l1Fee: 0n,
        l2Fee: 0n,
        total: 0n,
        recommended: {
          gasLimit: 60_000n,
          maxFeePerGas: 17n,
          maxPriorityFeePerGas: 2n,
          totalMaxCost: 1_020_000n,
          useLegacyPricing: true,
        },
      },
      {
        l1Fee: 0n,
        l2Fee: 0n,
        total: 0n,
        recommended: {
          gasLimit: 130_000n,
          maxFeePerGas: 17n,
          maxPriorityFeePerGas: 2n,
          totalMaxCost: 2_210_000n,
          useLegacyPricing: true,
        },
      },
    ]);
  });

  it('marks approval gas as final and uses helper-based fee outputs', async () => {
    const query = new SwapAndExecuteQuery(
      {
        getChainByID: vi.fn(() => dstChain),
      } as never,
      {
        getAddresses: vi.fn().mockResolvedValue([USER_ADDRESS]),
      } as never,
      vi.fn().mockResolvedValue({
        assets: [],
        balances: [],
      }) as never,
      vi.fn() as never
    );

    const result = await (query as any).estimateSwapAndExecute({
      toChainId: dstChain.id,
      toTokenAddress: TO_TOKEN,
      toAmount: 100_000_000n,
      fromSources: [],
      execute: {
        to: TARGET,
        data: '0x1234',
        value: 0n,
        gas: 100_000n,
        gasPrice: 'medium',
        tokenApproval: {
          token: APPROVAL_TOKEN,
          amount: 100_000_000n,
          spender: SPENDER,
        },
      },
    });

    expect(estimateFeeContextMock).toHaveBeenCalledTimes(1);
    expect(estimateFeeContextMock).toHaveBeenCalledWith(
      mockPublicClient,
      42161,
      [
        expect.objectContaining({
          gasEstimateKind: 'final',
          tx: expect.objectContaining({
            to: expect.any(String),
          }),
        }),
        expect.objectContaining({
          tx: expect.objectContaining({
            to: expect.any(String),
          }),
        }),
      ],
      'medium'
    );
    expect(finalizeFeeEstimatesMock).toHaveBeenCalledTimes(1);
    const [items] = finalizeFeeEstimatesMock.mock.calls[0] ?? [];
    expect(items?.[0]?.gasEstimate).toBe(50_000n);
    expect(items?.[1]?.gasEstimate).toBe(100_000n);

    expect(result.approvalTx?.gas).toBe(60_000n);
    expect(result.tx.gas).toBe(130_000n);
    expect(result.gas).toEqual({
      approval: 60_000n,
      tx: 130_000n,
    });
    expect(result.feeParams).toEqual({
      type: 'legacy',
      gasPrice: 17n,
    });
    expect(result.gasPrice).toBe(17n);
    expect(result.gasFee).toBe(3_230_000n);
  });
});
