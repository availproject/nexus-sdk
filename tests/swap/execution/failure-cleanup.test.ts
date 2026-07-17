import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { CurrencyID } from '../../../src/swap/cot';

vi.mock('../../../src/swap/wallet/capabilities', () => ({
  chainSupports7702: (chain: { id: number }) => chain.id === 42161,
}));

vi.mock('../../../src/services/init-refund-sweep', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/init-refund-sweep')>()),
  dispatchSweepGroups: vi.fn().mockResolvedValue(undefined),
}));

import {
  cleanupStrandedCot,
  resolveFailureSweepCurrencyId,
} from '../../../src/swap/execution/failure-cleanup';
import { dispatchSweepGroups } from '../../../src/services/init-refund-sweep';

const ARB = 42161; // 7702 → ephemeral holder
const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;

const makeCtx = (balance: bigint) =>
  ({
    cache: undefined,
    chainList: {
      getChainByID: (id: number) => ({ id }),
      getTokenByCurrencyId: () => ({
        contractAddress: USDC,
        decimals: 6,
        currencyId: CurrencyID.USDC,
      }),
    },
    eoaAddress: EOA,
    ephemeralWallet: { address: EPH },
    middlewareClient: {},
    publicClientList: {
      get: () => ({
        readContract: vi.fn().mockResolvedValue(balance),
        getBalance: vi.fn().mockResolvedValue(balance),
      }),
    },
  }) as never;

describe('cleanupStrandedCot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads only the COT at the chain holder and dispatches a direct-transfer group when positive', async () => {
    await cleanupStrandedCot({
      currencyId: CurrencyID.USDC,
      chainIds: [ARB],
      ctx: makeCtx(5_000_000n),
    });

    const groups = vi.mocked(dispatchSweepGroups).mock.calls[0]![0];
    expect(groups).toHaveLength(1);
    expect(groups[0]!.chainId).toBe(ARB);
    expect(groups[0]!.holder).toBe('ephemeral'); // 7702 chain → ephemeral, never the Safe
    expect(groups[0]!.calls).toHaveLength(1);
    expect(groups[0]!.calls[0]!.to).toBe(USDC); // ERC-20 transfer call targets the COT token
  });

  it('skips a chain whose COT balance is zero', async () => {
    await cleanupStrandedCot({
      currencyId: CurrencyID.USDC,
      chainIds: [ARB],
      ctx: makeCtx(0n),
    });

    expect(vi.mocked(dispatchSweepGroups).mock.calls[0]![0]).toHaveLength(0);
  });
});

describe('resolveFailureSweepCurrencyId', () => {
  const makeRoute = (over: {
    sameTokenBridge: boolean;
    provider?: 'nexus' | 'mayan';
    settlementCurrencyId: number;
    directDestination?: boolean;
  }) =>
    ({
      sameTokenBridge: over.sameTokenBridge,
      settlementCurrencyId: over.settlementCurrencyId,
      directDestination: over.directDestination,
      bridge: over.provider ? { provider: over.provider } : null,
    }) as never;

  it('skips (null) for a same-token bridge via Nexus — nothing strands', () => {
    expect(
      resolveFailureSweepCurrencyId(
        makeRoute({ sameTokenBridge: true, provider: 'nexus', settlementCurrencyId: CurrencyID.USDT })
      )
    ).toBeNull();
  });

  it('sweeps the bridged family token for a same-token bridge via Mayan', () => {
    expect(
      resolveFailureSweepCurrencyId(
        makeRoute({ sameTokenBridge: true, provider: 'mayan', settlementCurrencyId: CurrencyID.USDT })
      )
    ).toBe(CurrencyID.USDT);
  });

  it('sweeps the COT (USDC) for a COT round-trip route', () => {
    expect(
      resolveFailureSweepCurrencyId(
        makeRoute({ sameTokenBridge: false, provider: 'nexus', settlementCurrencyId: CurrencyID.USDC })
      )
    ).toBe(CurrencyID.USDC);
  });

  it('sweeps the dynamic COT (F) for a B2 route settling in a non-USDC family', () => {
    // B2 re-enters the COT flow with cotCurrencyId = F (USDT), so a failed route strands F, not USDC.
    expect(
      resolveFailureSweepCurrencyId(
        makeRoute({ sameTokenBridge: false, provider: 'nexus', settlementCurrencyId: CurrencyID.USDT })
      )
    ).toBe(CurrencyID.USDT);
  });

  it('sweeps the settlement currency when there is no bridge (single-chain swap)', () => {
    expect(
      resolveFailureSweepCurrencyId(
        makeRoute({ sameTokenBridge: false, settlementCurrencyId: CurrencyID.USDC })
      )
    ).toBe(CurrencyID.USDC);
  });

  it('skips (null) for the direct-destination fast path — one atomic batch, nothing strands', () => {
    expect(
      resolveFailureSweepCurrencyId(
        makeRoute({ sameTokenBridge: false, directDestination: true, settlementCurrencyId: CurrencyID.USDC })
      )
    ).toBeNull();
  });
});
