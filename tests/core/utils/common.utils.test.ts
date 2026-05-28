import { Universe } from '@avail-project/ca-common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estimateRepresentativeDepositTxFeeMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/depositFeeEstimation', () => ({
  estimateRepresentativeDepositTxFee: estimateRepresentativeDepositTxFeeMock,
}));

vi.mock('../../../src/core/chains', () => ({
  ChainList: class {},
}));

import { ZERO_ADDRESS } from '../../../src/core/constants';
import {
  assetListWithDepositDeducted,
  divDecimals,
  mulDecimals,
} from '../../../src/core/utils/common.utils';

describe('assetListWithDepositDeducted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estimateRepresentativeDepositTxFeeMock.mockResolvedValue({
      rawTotalFee: 1_000_000_000_000_000_000n,
      bufferedTotalFee: 1_000_000_000_000_000_000n,
    });
  });

  it('deducts native deposit cost only from non-destination source balances', async () => {
    const chainList = {
      getChainByID: vi.fn((chainId: number) => ({
        id: chainId,
        nativeCurrency: {
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH',
        },
      })),
      getVaultContractAddress: vi.fn(
        (chainId: number) => `0x${chainId.toString(16).padStart(40, '0')}` as `0x${string}`
      ),
    } as never;

    const result = await assetListWithDepositDeducted(
      [
        {
          balance: '5',
          chainId: 10,
          contractAddress: ZERO_ADDRESS,
          universe: Universe.ETHEREUM,
          decimals: 18,
        },
        {
          balance: '4',
          chainId: 8453,
          contractAddress: ZERO_ADDRESS,
          universe: Universe.ETHEREUM,
          decimals: 18,
        },
        {
          balance: '6',
          chainId: 42161,
          contractAddress: ZERO_ADDRESS,
          universe: Universe.ETHEREUM,
          decimals: 18,
        },
        {
          balance: '7',
          chainId: 10,
          contractAddress: '0x2222222222222222222222222222222222222222',
          universe: Universe.ETHEREUM,
          decimals: 6,
        },
      ],
      chainList,
      {
        feeMultiplier: 120n,
        destinationChainId: 42161,
      }
    );

    expect(
      result
        .find((item) => item.chainID === 10 && item.tokenContract === ZERO_ADDRESS)
        ?.balance.toFixed()
    ).toBe('4');
    expect(
      result
        .find((item) => item.chainID === 8453 && item.tokenContract === ZERO_ADDRESS)
        ?.balance.toFixed()
    ).toBe('3');
    expect(
      result
        .find((item) => item.chainID === 42161 && item.tokenContract === ZERO_ADDRESS)
        ?.balance.toFixed()
    ).toBe('6');
    expect(
      result
        .find((item) => item.tokenContract === '0x2222222222222222222222222222222222222222')
        ?.balance.toFixed()
    ).toBe('7');
    expect(estimateRepresentativeDepositTxFeeMock).toHaveBeenCalledTimes(2);
    expect(estimateRepresentativeDepositTxFeeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationChainId: 42161,
        feeMultiplier: 120n,
        sourceCount: 3,
      })
    );
  });

  it('clamps the native balance to zero when the representative fee exceeds it', async () => {
    const chainList = {
      getChainByID: vi.fn((chainId: number) => ({
        id: chainId,
        nativeCurrency: {
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH',
        },
      })),
      getVaultContractAddress: vi.fn(() => '0x1111111111111111111111111111111111111111'),
    } as never;

    estimateRepresentativeDepositTxFeeMock.mockResolvedValueOnce({
      rawTotalFee: 0n,
      bufferedTotalFee: 2_000_000_000_000_000_000n,
    });

    const result = await assetListWithDepositDeducted(
      [
        {
          balance: '1',
          chainId: 10,
          contractAddress: ZERO_ADDRESS,
          universe: Universe.ETHEREUM,
          decimals: 18,
        },
      ],
      chainList,
      {
        feeMultiplier: 120n,
        destinationChainId: 42161,
      }
    );

    expect(result[0]?.balance.toFixed()).toBe('0');
  });
});

// Regression: failed swap of PEPE → USDC (Arbitrum, exact-out) demanded transferFrom of
// 266_077_560_050_515_585_070 wei from an EOA holding 266_077_560_050_515_585_065 — exactly
// 5 wei over balance. Root cause: Decimal.js default precision is 20 significant figures
// with ROUND_HALF_UP, so any raw → Decimal → raw round-trip through divDecimals/mulDecimals
// rounds up at the 21st digit. Any 18-decimal token balance ≥ ~100 tokens (21+ digits raw)
// is vulnerable.
describe('divDecimals / mulDecimals raw round-trip (regression: 5-wei PEPE overshoot)', () => {
  it('does not overshoot a 21-digit raw balance through divDecimals → mulDecimals', () => {
    // Actual on-chain EOA PEPE balance from the failed tx (21 digits, 18 decimals).
    const rawBalance = 266_077_560_050_515_585_065n;
    const decimals = 18;

    const human = divDecimals(rawBalance, decimals);
    const roundtrip = mulDecimals(human, decimals);

    // Must never exceed the original balance — that's what makes the transferFrom revert.
    expect(roundtrip <= rawBalance).toBe(true);
    // Stronger: a faithful round-trip returns the exact original.
    expect(roundtrip).toBe(rawBalance);
  });

  it('preserves exact 18-decimal raw amounts at and beyond 20 significant figures', () => {
    // Smallest 21-digit raw amount (100 tokens at 18 decimals, exactly representable in 21 digits).
    const cases: bigint[] = [
      100_000_000_000_000_000_000n, // 100.0 — boundary (21 digits, but trailing zeros, safe)
      100_000_000_000_000_000_001n, // 100.0…01 — first 21-digit value that can drift
      999_999_999_999_999_999_999n, // 999.999… — max 21-digit
      266_077_560_050_515_585_065n, // the failing PEPE balance
      1_000_000_000_000_000_000_000n, // 1_000 tokens (22 digits) — even more vulnerable
    ];
    for (const raw of cases) {
      const roundtrip = mulDecimals(divDecimals(raw, 18), 18);
      expect(roundtrip).toBe(raw);
    }
  });
});
