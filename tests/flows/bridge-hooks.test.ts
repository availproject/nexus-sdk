import { describe, expect, it, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { BridgeIntentDraft, ChainListType, AllowanceHookSource } from '../../src/domain';
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

vi.mock('../../src/services/sbc', () => ({
  createSBCTxFromCalls: vi.fn().mockResolvedValue({
    chainId: 1,
    address: '0x0000000000000000000000000000000000000001',
    calls: [],
    deadline: '0x0000000000000000000000000000000000000000000000000000000000000001',
    keyHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    nonce: '0x0000000000000000000000000000000000000000000000000000000000000001',
    revertOnFailure: true,
    signature: '0x1234',
  }),
  requireSuccessfulSbcResult: vi.fn((results, chainId) => {
    const result = results.find((entry: { chainId: number }) => entry.chainId === chainId) as
      | { errored: false; txHash: Hex }
      | { errored: true; message: string }
      | undefined;
    if (!result || result.errored) {
      throw new Error(result?.message ?? 'SBC submission failed');
    }
    return result.txHash;
  }),
}));

import { prepareBridgeExecution } from '../../src/bridge/allowances/prepare';
import { prepareSwapBridgeExecution } from '../../src/bridge/allowances/prepare-swap-sbc';
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

describe('prepareSwapBridgeExecution', () => {
  it('no-ops when no insufficient sources', async () => {
    const submitSBCs = vi.fn().mockResolvedValue([]);
    await prepareSwapBridgeExecution(makeIntent(), {
      allowanceSelections: [],
      insufficientAllowanceSources: [],
      middlewareClient: { submitSBCs } as any,
      ephemeralWallet: { address: '0xeph' as Hex } as any,
      chainList: makeChainList(),
      publicClientList: { get: vi.fn() },
      cache: undefined,
    });

    expect(submitSBCs).not.toHaveBeenCalled();
  });

  it('submits SBC approve transactions when allowances are insufficient', async () => {
    const submitSBCs = vi.fn().mockResolvedValue([
      {
        chainId: 42161,
        address: '0x0000000000000000000000000000000000000abc' as Hex,
        errored: false,
        txHash: '0xapprove' as Hex,
      },
    ]);
    const insufficientSources: AllowanceHookSource[] = [
      {
        allowance: { current: '0', currentRaw: 0n, minimum: '100', minimumRaw: 100000000n },
        chain: { id: 42161, logo: '', name: 'Arbitrum' },
        token: { contractAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex, decimals: 6, logo: '', name: 'USDC', symbol: 'USDC' },
      },
    ];

    await prepareSwapBridgeExecution(makeIntent(), {
      allowanceSelections: ['min'],
      insufficientAllowanceSources: insufficientSources,
      middlewareClient: { submitSBCs } as any,
      ephemeralWallet: {
        address: '0xbbbb000000000000000000000000000000000002' as Hex,
        signTypedData: vi.fn().mockResolvedValue('0x' + 'aa'.repeat(65)),
        signAuthorization: vi.fn().mockResolvedValue({ r: '0x01', s: '0x02', yParity: 0, nonce: 0 }),
      } as any,
      chainList: makeChainList(),
      publicClientList: {
        get: vi.fn().mockReturnValue({
          getCode: vi.fn().mockResolvedValue(undefined),
          getTransactionCount: vi.fn().mockResolvedValue(0),
          multicall: vi.fn().mockResolvedValue([]),
          waitForTransactionReceipt: vi.fn().mockResolvedValue({
            status: 'success',
            transactionHash: '0xapprove' as Hex,
          }),
        }),
      },
      cache: undefined,
    });

    expect(submitSBCs).toHaveBeenCalledTimes(1);
  });

  it('throws when SBC approval submission reports failure', async () => {
    const submitSBCs = vi.fn().mockResolvedValue([
      {
        chainId: 42161,
        address: '0x0000000000000000000000000000000000000abc' as Hex,
        errored: true,
        message: 'approval failed',
      },
    ]);
    const insufficientSources: AllowanceHookSource[] = [
      {
        allowance: { current: '0', currentRaw: 0n, minimum: '100', minimumRaw: 100000000n },
        chain: { id: 42161, logo: '', name: 'Arbitrum' },
        token: { contractAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex, decimals: 6, logo: '', name: 'USDC', symbol: 'USDC' },
      },
    ];

    await expect(
      prepareSwapBridgeExecution(makeIntent(), {
        allowanceSelections: ['min'],
        insufficientAllowanceSources: insufficientSources,
        middlewareClient: { submitSBCs } as any,
        ephemeralWallet: {
          address: '0xbbbb000000000000000000000000000000000002' as Hex,
          signTypedData: vi.fn().mockResolvedValue('0x' + 'aa'.repeat(65)),
          signAuthorization: vi.fn().mockResolvedValue({ r: '0x01', s: '0x02', yParity: 0, nonce: 0 }),
        } as any,
        chainList: makeChainList(),
        publicClientList: {
          get: vi.fn().mockReturnValue({
            getCode: vi.fn().mockResolvedValue(undefined),
            getTransactionCount: vi.fn().mockResolvedValue(0),
            multicall: vi.fn().mockResolvedValue([]),
            waitForTransactionReceipt: vi.fn().mockResolvedValue({
              status: 'success',
              transactionHash: '0xapprove' as Hex,
            }),
          }),
        },
        cache: undefined,
      })
    ).rejects.toThrow(/approval failed|submission/i);
  });
});
