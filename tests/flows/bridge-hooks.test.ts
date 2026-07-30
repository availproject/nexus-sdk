import { describe, expect, it, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { BridgeIntentDraft, ChainListType } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';

vi.mock('../../src/services/allowance-utils', () => ({
  getAllowances: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/bridge/intent/builder', () => ({
  findInsufficientAllowanceSources: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/bridge/intent/readable', () => ({
  convertIntent: vi.fn().mockReturnValue({ id: 'mock-readable-intent' }),
}));

import { prepareBridgeExecution } from '../../src/bridge/allowances/prepare';
import { runBridgeHooks } from '../../src/bridge/hooks/approval';
import { buildHookStateFromIntent } from '../../src/bridge/hooks/state';
import { getAllowances } from '../../src/services/allowance-utils';
import { findInsufficientAllowanceSources } from '../../src/bridge/intent/builder';

const TOKEN = {
  contractAddress: '0xusdc' as Hex,
  decimals: 6,
  symbol: 'USDC',
  name: 'USDC',
  logo: '',
};
const ARB_CHAIN = { id: 42161, name: 'Arbitrum', logo: '' };
const BASE_CHAIN = { id: 8453, name: 'Base', logo: '' };
const NATIVE_TOKEN = {
  contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
  decimals: 18,
  symbol: 'ETH',
  name: 'Ether',
  logo: '',
};

const makeIntent = (): BridgeIntentDraft => ({
  availableSources: [
    { amount: new Decimal('100'), amountRaw: 100000000n, chain: ARB_CHAIN, token: TOKEN, universe: Universe.ETHEREUM, holderAddress: '0xuser' as Hex, value: new Decimal(0), depositFee: new Decimal(0), depositFeeRaw: 0n },
  ],
  selectedSources: [
    { amount: new Decimal('100'), amountRaw: 100000000n, chain: ARB_CHAIN, token: TOKEN, universe: Universe.ETHEREUM, holderAddress: '0xuser' as Hex, value: new Decimal(0), depositFee: new Decimal(0), depositFeeRaw: 0n },
  ],
  destination: {
    amount: new Decimal('100'),
    amountRaw: 100000000n,
    chain: BASE_CHAIN,
    nativeAmount: new Decimal(0),
    nativeAmountRaw: 0n,
    nativeAmountValue: new Decimal(0),
    nativeAmountInToken: new Decimal(0),
    nativeToken: NATIVE_TOKEN,
    token: { ...TOKEN, contractAddress: '0xusdc_base' as Hex },
    universe: Universe.ETHEREUM,
    value: new Decimal(0),
  },
  fees: { caGas: '0', deposit: '0', fulfillment: '0', protocol: '0', solver: '0' },
  recipientAddress: '0xuser' as Hex,
  provider: 'nexus',
});

const makeChainList = () => ({
  getChainByID: vi.fn().mockReturnValue({ id: 42161, name: 'Arbitrum' }),
  getTokenByAddress: vi.fn().mockReturnValue({ contractAddress: '0xusdc', decimals: 6, symbol: 'USDC', name: 'USDC', logo: '' }),
  getVaultContractAddress: vi.fn().mockReturnValue('0x0000000000000000000000000000000000000099'),
}) as unknown as ChainListType;

describe('buildHookStateFromIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns intent and insufficientAllowanceSources', async () => {
    const intent = makeIntent();
    const chainList = makeChainList();

    const result = await buildHookStateFromIntent(intent, { chainList });

    expect(result.intent).toBe(intent);
    expect(result.insufficientAllowanceSources).toBeDefined();
    expect(Array.isArray(result.insufficientAllowanceSources)).toBe(true);
  });

  it('calls getAllowances with intent sources', async () => {
    const intent = makeIntent();
    const chainList = makeChainList();

    await buildHookStateFromIntent(intent, { chainList });

    expect(getAllowances).toHaveBeenCalledWith(
      [
        {
          chainID: 42161,
          tokenContract: TOKEN.contractAddress,
          holderAddress: '0xuser' as Hex,
        },
      ],
      chainList
    );
  });
});

describe('runBridgeHooks', () => {
  it('resolves when onIntent calls allow() and returns intent + allowance selections', async () => {
    const intent = makeIntent();
    const chainList = makeChainList();

    const result = await runBridgeHooks(intent, {
      hooks: {
        onIntent: ({ allow }) => allow(),
        onAllowance: ({ allow }) => allow([]),
      },
      chainList,
    });

    expect(result.intent).toBe(intent);
    expect(result.allowanceSelections).toEqual([]);
  });

  it('rejects when onIntent calls deny()', async () => {
    const intent = makeIntent();
    const chainList = makeChainList();

    await expect(
      runBridgeHooks(intent, {
        hooks: {
          onIntent: ({ deny }) => deny(),
          onAllowance: ({ allow }) => allow([]),
        },
        chainList,
      }),
    ).rejects.toThrow();
  });

  it('does not perform approvals (pure decision stage)', async () => {
    const intent = makeIntent();
    const chainList = makeChainList();

    const result = await runBridgeHooks(intent, {
      hooks: {
        onIntent: ({ allow }) => allow(),
        onAllowance: ({ allow }) => allow([]),
      },
      chainList,
    });

    // runHooks returns selections but does NOT execute them
    expect(result.insufficientAllowanceSources).toBeDefined();
  });
});

describe('prepareBridgeExecution', () => {
  it('is callable with resolved allowance selections', async () => {
    await expect(
      prepareBridgeExecution({
        allowanceSelections: [],
        insufficientAllowanceSources: [],
        bridge: {
          evm: {
            address: '0xuser' as Hex,
            walletClient: {} as any,
          },
          chainList: makeChainList(),
          middlewareClient: {} as any,
        },
        dstChain: { id: 8453, name: 'Base' } as any,
      }),
    ).resolves.toBeUndefined();
  });
});
