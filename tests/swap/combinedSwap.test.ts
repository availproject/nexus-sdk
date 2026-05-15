import { CurrencyID } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../../src/commons';
import { EADDRESS, SWEEPER_ADDRESS, ZERO_BYTES_32 } from '../../src/swap/constants';
import { COMBINED_SAME_CHAIN_BUFFER_PCT } from '../../src/swap/route';

const switchChainMock = vi.hoisted(() => vi.fn());
const waitForTxReceiptMock = vi.hoisted(() => vi.fn());
const createPermitAndTransferFromTxMock = vi.hoisted(() => vi.fn());
const createSweeperTxsMock = vi.hoisted(() => vi.fn());
const createSafeExecuteEOASubmittedTxMock = vi.hoisted(() => vi.fn());
const createSafeExecuteTxFromCallsMock = vi.hoisted(() => vi.fn());
const createSBCTxFromCallsMock = vi.hoisted(() => vi.fn());
const caliburExecuteMock = vi.hoisted(() => vi.fn());
const checkAuthCodeSetMock = vi.hoisted(() => vi.fn());
const waitForSBCTxReceiptMock = vi.hoisted(() => vi.fn());
const liquidateSourceHoldingsMock = vi.hoisted(() => vi.fn());
const autoSelectSourcesMock = vi.hoisted(() => vi.fn());
const getDestinationExactInSwapMock = vi.hoisted(() => vi.fn());
const getDestinationExactOutSwapMock = vi.hoisted(() => vi.fn());

vi.mock('@avail-project/ca-common', async () => {
  const actual = await vi.importActual<typeof import('@avail-project/ca-common')>(
    '@avail-project/ca-common'
  );
  return {
    ...actual,
    liquidateSourceHoldings: liquidateSourceHoldingsMock,
    autoSelectSources: autoSelectSourcesMock,
    getDestinationExactInSwap: getDestinationExactInSwapMock,
    getDestinationExactOutSwap: getDestinationExactOutSwapMock,
  };
});

vi.mock('../../src/core/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/core/utils')>('../../src/core/utils');
  return {
    ...actual,
    switchChain: switchChainMock,
    waitForTxReceipt: waitForTxReceiptMock,
  };
});

vi.mock('../../src/swap/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/swap/utils')>('../../src/swap/utils');
  return {
    ...actual,
    createPermitAndTransferFromTx: createPermitAndTransferFromTxMock,
    createSweeperTxs: createSweeperTxsMock,
  };
});

vi.mock('../../src/swap/sbc', async () => {
  const actual = await vi.importActual<typeof import('../../src/swap/sbc')>('../../src/swap/sbc');
  return {
    ...actual,
    caliburExecute: caliburExecuteMock,
    checkAuthCodeSet: checkAuthCodeSetMock,
    createSBCTxFromCalls: createSBCTxFromCallsMock,
    waitForSBCTxReceipt: waitForSBCTxReceiptMock,
  };
});

vi.mock('../../src/swap/safetx', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/swap/safetx')>('../../src/swap/safetx');
  return {
    ...actual,
    createSafeExecuteEOASubmittedTx: createSafeExecuteEOASubmittedTxMock,
    createSafeExecuteTxFromCalls: createSafeExecuteTxFromCallsMock,
  };
});

import { CombinedSwapHandler } from '../../src/swap/ob';

const CHAIN_ID = 999;
const SAFE_ADDRESS = '0x3333333333333333333333333333333333333333' as Hex;
const EPHEMERAL = '0x2222222222222222222222222222222222222222' as Hex;
const EOA = '0x1111111111111111111111111111111111111111' as Hex;
const SAFE_HASH = ('0xa1' + 'a'.repeat(62)) as Hex;
const SBC_HASH = ('0xb2' + 'b'.repeat(62)) as Hex;
const CALIBUR_HASH = ('0xc3' + 'c'.repeat(62)) as Hex;
const EOA_SAFE_HASH = ('0xd4' + 'd'.repeat(62)) as Hex;

const KHYPE: Hex = '0xeeee0000000000000000000000000000face0001';
const USDC: Hex = '0xb88339cb7199b77e23db6e890353e22632ba630f';
const USDH: Hex = '0xeeee0000000000000000000000000000face0002';
const NATIVE: Hex = EADDRESS as Hex;

const makeSourceQuote = (overrides?: { inputAddr?: Hex; outputAmountRaw?: bigint }) => ({
  aggregator: { id: 'mock-agg' },
  chainID: CHAIN_ID,
  holding: {
    amountRaw: 100_000_000n,
    chainID: { universe: 1, chainID: CHAIN_ID },
    tokenAddress: new Uint8Array(32),
  },
  quote: {
    expiry: Math.floor(Date.now() / 1000) + 600,
    input: {
      amount: '100',
      amountRaw: 100_000_000n,
      contractAddress: overrides?.inputAddr ?? KHYPE,
      decimals: 6,
      symbol: 'kHYPE',
      value: 100,
    },
    output: {
      amount: '100',
      amountRaw: overrides?.outputAmountRaw ?? 100_000_000n,
      contractAddress: USDC,
      decimals: 6,
      symbol: 'USDC',
      value: 100,
    },
    txData: {
      approvalAddress: ('0xa9' + 'a'.repeat(38)) as Hex,
      tx: {
        data: '0xsrcswap' as Hex,
        to: ('0xa9' + 'a'.repeat(38)) as Hex,
        value: '0x0' as Hex,
      },
    },
  },
});

const makeDstQuote = (overrides?: { inputAmountRaw?: bigint }) => {
  const inputAmountRaw = overrides?.inputAmountRaw ?? 99_500_000n;
  const inputAmount = (Number(inputAmountRaw) / 1_000_000).toString();
  return {
    aggregator: { id: 'mock-agg' },
    chainID: CHAIN_ID,
    holding: {
      amountRaw: inputAmountRaw,
      chainID: { universe: 1, chainID: CHAIN_ID },
      tokenAddress: new Uint8Array(32),
    },
    quote: {
      expiry: Math.floor(Date.now() / 1000) + 600,
      input: {
        amount: inputAmount,
        amountRaw: inputAmountRaw,
        contractAddress: USDC,
        decimals: 6,
        symbol: 'USDC',
        value: Number(inputAmount),
      },
      output: {
        amount: '90',
        amountRaw: 90_000_000n,
        contractAddress: USDH,
        decimals: 6,
        symbol: 'USDH',
        value: 90,
      },
      txData: {
        approvalAddress: ('0xd5' + 'd'.repeat(38)) as Hex,
        tx: {
          data: '0xdstswap' as Hex,
          to: ('0xd5' + 'd'.repeat(38)) as Hex,
          value: '0x0' as Hex,
        },
      },
    },
  };
};

const PERMIT_TX: Tx = {
  data: '0xpermit' as Hex,
  to: KHYPE,
  value: 0n,
};
const TRANSFER_FROM_TX: Tx = {
  data: '0xtransferFrom' as Hex,
  to: KHYPE,
  value: 0n,
};
const SWEEP_APPROVAL_TX: Tx = {
  data: '0xsweepApproval' as Hex,
  to: USDC,
  value: 0n,
};
const SWEEP_TX: Tx = {
  data: '0xsweep' as Hex,
  to: SWEEPER_ADDRESS,
  value: 0n,
};

const makeGasSwap = (overrides?: { inputAmountRaw?: bigint; outputAmountRaw?: bigint }) => {
  const inputAmountRaw = overrides?.inputAmountRaw ?? 5_000_000n;
  const inputAmount = (Number(inputAmountRaw) / 1_000_000).toString();
  return {
    aggregator: { id: 'mock-agg' },
    chainID: CHAIN_ID,
    holding: {
      amountRaw: inputAmountRaw,
      chainID: { universe: 1, chainID: CHAIN_ID },
      tokenAddress: new Uint8Array(32),
    },
    quote: {
      expiry: Math.floor(Date.now() / 1000) + 600,
      input: {
        amount: inputAmount,
        amountRaw: inputAmountRaw,
        contractAddress: USDC,
        decimals: 6,
        symbol: 'USDC',
        value: Number(inputAmount),
      },
      output: {
        amount: '5',
        amountRaw: overrides?.outputAmountRaw ?? 5_000_000_000_000_000n,
        contractAddress: NATIVE,
        decimals: 18,
        symbol: 'ETH',
        value: 5,
      },
      txData: {
        approvalAddress: ('0xa6' + 'a'.repeat(38)) as Hex,
        tx: {
          data: '0xgasswap' as Hex,
          to: ('0xa6' + 'a'.repeat(38)) as Hex,
          value: '0x0' as Hex,
        },
      },
    },
  };
};

const makeRoute = (overrides?: {
  type?: 'EXACT_IN' | 'EXACT_OUT';
  srcInputAddr?: Hex;
  srcOutputAmountRaw?: bigint;
  destinationMode?: 'safe_account' | '7702';
  dstSwap?: ReturnType<typeof makeDstQuote> | null;
  gasSwap?: ReturnType<typeof makeGasSwap> | null;
  eoaToDestinationAccount?: { amount: bigint; contractAddress: Hex } | null;
  inputAmountMax?: Decimal;
  getDstSwapImpl?: () => Promise<{
    creationTime: number;
    tokenSwap: ReturnType<typeof makeDstQuote> | null;
    gasSwap: ReturnType<typeof makeGasSwap> | null;
  }>;
}) => {
  const mode = overrides?.destinationMode ?? 'safe_account';
  const execAddr = mode === 'safe_account' ? SAFE_ADDRESS : EPHEMERAL;
  const initialMax = overrides?.inputAmountMax ?? new Decimal(99.5);
  const route = {
    type: overrides?.type ?? 'EXACT_IN',
    source: {
      swaps: [
        makeSourceQuote({
          inputAddr: overrides?.srcInputAddr,
          outputAmountRaw: overrides?.srcOutputAmountRaw,
        }),
      ],
      creationTime: Date.now(),
      executions: {
        [CHAIN_ID]: {
          address: execAddr,
          entryPoint: null,
          mode,
        },
      },
    },
    bridge: null,
    destination: {
      chainId: CHAIN_ID,
      eoaToDestinationAccount: overrides?.eoaToDestinationAccount ?? null,
      execution: {
        address: execAddr,
        entryPoint: null,
        mode,
      },
      inputAmount: { min: initialMax, max: initialMax },
      swap: {
        creationTime: Date.now(),
        gasSwap: overrides?.gasSwap === null ? null : (overrides?.gasSwap ?? null),
        tokenSwap: overrides?.dstSwap === null ? null : (overrides?.dstSwap ?? makeDstQuote()),
      },
      getDstSwap:
        overrides?.getDstSwapImpl !== undefined
          ? vi.fn().mockImplementation(overrides.getDstSwapImpl)
          : vi.fn().mockResolvedValue({
              creationTime: Date.now(),
              gasSwap: overrides?.gasSwap === null ? null : (overrides?.gasSwap ?? null),
              tokenSwap: overrides?.dstSwap === null ? null : makeDstQuote(),
            }),
    },
    combined: true,
    buffer: { amount: '0' },
    dstTokenInfo: { contractAddress: USDH, decimals: 6, symbol: 'USDH' },
    extras: {
      aggregators: [],
      oraclePrices: [],
      balances: [],
      assetsUsed: [],
    },
  };
  return route as never;
};

const baseOptions = () => {
  const emitter = { emit: vi.fn() };
  const cache = {
    addAllowanceQuery: vi.fn(),
    addPermitQuery: vi.fn(),
    addSetCodeQuery: vi.fn(),
    getCode: vi.fn().mockReturnValue('0x'),
    addSetCodeValue: vi.fn(),
  };
  const chain = {
    blockExplorers: { default: { url: 'https://example.com' } },
    id: CHAIN_ID,
    name: 'HyperEVM',
    nativeCurrency: { decimals: 18, name: 'ETH', symbol: 'ETH' },
  };
  const chainList = {
    getChainByID: vi.fn(() => chain),
  };
  const publicClient = {} as never;
  const vscClient = {
    vscCreateSafeExecuteTx: vi.fn().mockResolvedValue([BigInt(CHAIN_ID), SAFE_HASH]),
    vscSBCTx: vi.fn().mockResolvedValue([[BigInt(CHAIN_ID), SBC_HASH]]),
  };
  return {
    options: {
      address: { cosmos: '', eoa: EOA, ephemeral: EPHEMERAL },
      aggregators: [],
      cache,
      chainList,
      cot: { currencyID: CurrencyID.USDC, symbol: 'USDC' },
      cosmosQueryClient: {} as never,
      destinationChainID: CHAIN_ID,
      emitter,
      publicClientList: { get: vi.fn(() => publicClient) },
      slippage: 0.005,
      vscClient,
      wallet: { cosmos: {} as never, eoa: {} as never, ephemeral: {} as never },
    } as never,
    emitter,
    vscClient,
    chain,
  };
};

const makeMetadata = () => ({
  dst: {
    chid: ZERO_BYTES_32,
    swaps: [],
    tx_hash: ZERO_BYTES_32,
    univ: 1,
  },
  has_xcs: true,
  rff_id: 0n,
  src: [],
});

describe('CombinedSwapHandler.buildBatch ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    waitForTxReceiptMock.mockResolvedValue(undefined);
    createPermitAndTransferFromTxMock.mockResolvedValue([PERMIT_TX, TRANSFER_FROM_TX]);
    createSweeperTxsMock.mockReturnValue([SWEEP_APPROVAL_TX, SWEEP_TX]);
    createSafeExecuteTxFromCallsMock.mockResolvedValue({ kind: 'safe' });
    createSBCTxFromCallsMock.mockResolvedValue({ kind: 'sbc' });
    caliburExecuteMock.mockResolvedValue(CALIBUR_HASH);
    createSafeExecuteEOASubmittedTxMock.mockResolvedValue(EOA_SAFE_HASH);
    checkAuthCodeSetMock.mockResolvedValue(true);
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
  });

  it('ERC20 source + Safe wrapper: emits [permit, transferFrom, src-approval, src-swap, dst-approval, dst-swap, sweep-approval, sweep]', async () => {
    const { options } = baseOptions();
    const handler = new CombinedSwapHandler(makeRoute(), options);
    await handler.process(makeMetadata() as never);

    expect(createSafeExecuteTxFromCallsMock).toHaveBeenCalledTimes(1);
    const calls = createSafeExecuteTxFromCallsMock.mock.calls[0][0].calls as Tx[];
    const dataInOrder = calls.map((c) => c.data);
    expect(dataInOrder).toEqual([
      '0xpermit',
      '0xtransferFrom',
      expect.stringMatching(/^0x095ea7b3/), // ERC20 approve selector (src aggregator approval)
      '0xsrcswap',
      expect.stringMatching(/^0x095ea7b3/), // ERC20 approve selector (dst aggregator approval)
      '0xdstswap',
      '0xsweepApproval',
      '0xsweep',
    ]);
  });

  it('native source + Safe wrapper: omits permit/transferFrom and forwards native value via sbcCalls.value', async () => {
    const { options } = baseOptions();
    const handler = new CombinedSwapHandler(
      makeRoute({
        srcInputAddr: NATIVE,
      }),
      options
    );
    await handler.process(makeMetadata() as never);

    // Wallet-signed path for native value on Safe
    expect(createSafeExecuteEOASubmittedTxMock).toHaveBeenCalledTimes(1);
    const args = createSafeExecuteEOASubmittedTxMock.mock.calls[0][0] as {
      calls: Tx[];
      nativeValue: bigint;
    };
    expect(args.nativeValue).toBe(100_000_000n);
    const dataInOrder = args.calls.map((c) => c.data);
    // No permit/transferFrom for native input — src swap is the first non-approval call.
    expect(dataInOrder).toEqual([
      '0xsrcswap',
      expect.stringMatching(/^0x095ea7b3/), // dst aggregator approval
      '0xdstswap',
      '0xsweepApproval',
      '0xsweep',
    ]);
  });

  it('ERC20 source + 7702 wrapper: routes through vscSBCTx with the same call ordering', async () => {
    const { options, vscClient } = baseOptions();
    const handler = new CombinedSwapHandler(makeRoute({ destinationMode: '7702' }), options);
    await handler.process(makeMetadata() as never);

    expect(vscClient.vscSBCTx).toHaveBeenCalledTimes(1);
    expect(createSBCTxFromCallsMock).toHaveBeenCalledTimes(1);
    const calls = createSBCTxFromCallsMock.mock.calls[0][0].calls as Tx[];
    expect(calls.map((c) => c.data)).toEqual([
      '0xpermit',
      '0xtransferFrom',
      expect.stringMatching(/^0x095ea7b3/),
      '0xsrcswap',
      expect.stringMatching(/^0x095ea7b3/),
      '0xdstswap',
      '0xsweepApproval',
      '0xsweep',
    ]);
  });

  it('includes destination eoaToDestinationAccount transferFrom calls when set', async () => {
    const { options } = baseOptions();
    // Inject a second pair of permit/transferFrom for the dst EOA→wrapper transfer.
    createPermitAndTransferFromTxMock
      .mockResolvedValueOnce([PERMIT_TX, TRANSFER_FROM_TX]) // src EOA→wrapper
      .mockResolvedValueOnce([
        { data: '0xdstPermit' as Hex, to: USDC, value: 0n },
        { data: '0xdstTransferFrom' as Hex, to: USDC, value: 0n },
      ]); // dst EOA→wrapper for existing USDC
    const handler = new CombinedSwapHandler(
      makeRoute({
        eoaToDestinationAccount: { amount: 50_000_000n, contractAddress: USDC },
      }),
      options
    );
    await handler.process(makeMetadata() as never);

    const calls = createSafeExecuteTxFromCallsMock.mock.calls[0][0].calls as Tx[];
    const data = calls.map((c) => c.data);
    expect(data).toContain('0xdstPermit');
    expect(data).toContain('0xdstTransferFrom');
    // Order: src EOA→wrapper precedes src swap, which precedes dst EOA→wrapper, which precedes dst swap.
    expect(data.indexOf('0xtransferFrom')).toBeLessThan(data.indexOf('0xsrcswap'));
    expect(data.indexOf('0xsrcswap')).toBeLessThan(data.indexOf('0xdstTransferFrom'));
    expect(data.indexOf('0xdstTransferFrom')).toBeLessThan(data.indexOf('0xdstswap'));
  });

  it('omits dst aggregator calls when destination has no token swap (toToken == COT)', async () => {
    const { options } = baseOptions();
    const handler = new CombinedSwapHandler(makeRoute({ dstSwap: null }), options);
    await handler.process(makeMetadata() as never);

    const calls = createSafeExecuteTxFromCallsMock.mock.calls[0][0].calls as Tx[];
    const data = calls.map((c) => c.data);
    expect(data).not.toContain('0xdstswap');
    // Sweep still runs to drain COT (the whole point of the no-dst-swap combined case).
    expect(data).toContain('0xsweep');
  });
});

describe('CombinedSwapHandler.submitBatch dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    waitForTxReceiptMock.mockResolvedValue(undefined);
    createPermitAndTransferFromTxMock.mockResolvedValue([PERMIT_TX, TRANSFER_FROM_TX]);
    createSweeperTxsMock.mockReturnValue([SWEEP_APPROVAL_TX, SWEEP_TX]);
    createSafeExecuteTxFromCallsMock.mockResolvedValue({ kind: 'safe' });
    createSBCTxFromCallsMock.mockResolvedValue({ kind: 'sbc' });
    caliburExecuteMock.mockResolvedValue(CALIBUR_HASH);
    createSafeExecuteEOASubmittedTxMock.mockResolvedValue(EOA_SAFE_HASH);
    checkAuthCodeSetMock.mockResolvedValue(true);
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
  });

  it('safe_account + ERC20 source → vscCreateSafeExecuteTx (VSC-submitted)', async () => {
    const { options, vscClient } = baseOptions();
    await new CombinedSwapHandler(makeRoute(), options).process(makeMetadata() as never);
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(1);
    expect(createSafeExecuteEOASubmittedTxMock).not.toHaveBeenCalled();
  });

  it('safe_account + native source → createSafeExecuteEOASubmittedTx (wallet-signed)', async () => {
    const { options, vscClient } = baseOptions();
    await new CombinedSwapHandler(makeRoute({ srcInputAddr: NATIVE }), options).process(
      makeMetadata() as never
    );
    expect(createSafeExecuteEOASubmittedTxMock).toHaveBeenCalledTimes(1);
    expect(vscClient.vscCreateSafeExecuteTx).not.toHaveBeenCalled();
  });

  it('7702 + ERC20 source → vscSBCTx (VSC-submitted)', async () => {
    const { options, vscClient } = baseOptions();
    await new CombinedSwapHandler(makeRoute({ destinationMode: '7702' }), options).process(
      makeMetadata() as never
    );
    expect(vscClient.vscSBCTx).toHaveBeenCalledTimes(1);
    expect(caliburExecuteMock).not.toHaveBeenCalled();
  });

  it('7702 + native source → caliburExecute (wallet-signed)', async () => {
    const { options, vscClient } = baseOptions();
    await new CombinedSwapHandler(
      makeRoute({ destinationMode: '7702', srcInputAddr: NATIVE }),
      options
    ).process(makeMetadata() as never);
    expect(caliburExecuteMock).toHaveBeenCalledTimes(1);
    expect(vscClient.vscSBCTx).not.toHaveBeenCalled();
  });
});

describe('CombinedSwapHandler.requoteBothLegs (retry on revert)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    waitForTxReceiptMock.mockResolvedValue(undefined);
    createPermitAndTransferFromTxMock.mockResolvedValue([PERMIT_TX, TRANSFER_FROM_TX]);
    createSweeperTxsMock.mockReturnValue([SWEEP_APPROVAL_TX, SWEEP_TX]);
    createSafeExecuteTxFromCallsMock.mockResolvedValue({ kind: 'safe' });
    createSBCTxFromCallsMock.mockResolvedValue({ kind: 'sbc' });
    checkAuthCodeSetMock.mockResolvedValue(true);
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
    // Re-quoted source returns the same shape (identity output of 100 USDC).
    liquidateSourceHoldingsMock.mockResolvedValue([makeSourceQuote()]);
    autoSelectSourcesMock.mockResolvedValue({
      quoteResponses: [makeSourceQuote()],
      usedCOTs: [],
    });
    // Re-quoted dst returns same output (no slippage).
    getDestinationExactInSwapMock.mockResolvedValue(makeDstQuote());
    getDestinationExactOutSwapMock.mockResolvedValue(makeDstQuote());
  });

  it('on revert, re-quotes EXACT_IN via liquidateSourceHoldings + getDestinationExactInSwap then retries', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    await new CombinedSwapHandler(makeRoute({ type: 'EXACT_IN' }), options).process(
      makeMetadata() as never
    );

    expect(liquidateSourceHoldingsMock).toHaveBeenCalledTimes(1);
    expect(getDestinationExactInSwapMock).toHaveBeenCalledTimes(1);
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(2);
  });

  it('on revert (EXACT_OUT), requotes destination via route.destination.getDstSwap FIRST, then reselects source via autoSelectSources', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    const route = makeRoute({ type: 'EXACT_OUT' });
    // Track call order across both mocks.
    const callOrder: string[] = [];
    (
      route as never as { destination: { getDstSwap: ReturnType<typeof vi.fn> } }
    ).destination.getDstSwap = vi.fn().mockImplementation(async () => {
      callOrder.push('getDstSwap');
      return {
        creationTime: Date.now(),
        gasSwap: null,
        tokenSwap: makeDstQuote(),
      };
    });
    autoSelectSourcesMock.mockImplementation(async () => {
      callOrder.push('autoSelectSources');
      return { quoteResponses: [makeSourceQuote()], usedCOTs: [] };
    });

    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);

    expect(callOrder).toEqual(['getDstSwap', 'autoSelectSources']);
    // Direct call to getDestinationExactOutSwap should NOT happen — closure handles it.
    expect(getDestinationExactOutSwapMock).not.toHaveBeenCalled();
  });

  it('on EXACT_OUT retry with gasSwap present, autoSelectSources outputRequired includes tokenSwap.input + gasSwap.input', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // Refreshed dst on retry: tokenSwap pulls 45 USDC, gasSwap pulls 4 USDC. Source must
    // produce ≥ 49 USDC (sum) to cover both legs.
    const route = makeRoute({
      type: 'EXACT_OUT',
      gasSwap: makeGasSwap({ inputAmountRaw: 5_000_000n }),
      dstSwap: makeDstQuote({ inputAmountRaw: 50_000_000n }),
      getDstSwapImpl: async () => ({
        creationTime: Date.now(),
        tokenSwap: makeDstQuote({ inputAmountRaw: 45_000_000n }),
        gasSwap: makeGasSwap({ inputAmountRaw: 4_000_000n }),
      }),
    });

    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);

    expect(autoSelectSourcesMock).toHaveBeenCalledTimes(1);
    const callArgs = autoSelectSourcesMock.mock.calls[0][0] as { outputRequired: Decimal };
    expect(callArgs.outputRequired.toFixed()).toBe('49');
  });

  it('on EXACT_OUT retry, getDstSwap rate-guard throw propagates after MAX_RETRIES', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx.mockRejectedValue(new Error('execution reverted'));

    const rateGuardError = new Error('rates changed beyond tolerance');
    const route = makeRoute({
      type: 'EXACT_OUT',
      getDstSwapImpl: async () => {
        throw rateGuardError;
      },
    });

    await expect(
      new CombinedSwapHandler(route, options).process(makeMetadata() as never)
    ).rejects.toThrow();
    // Initial attempt + retries: initial submit failed, then 2 retries each blocked by
    // getDstSwap throwing. Submit is only called once (initial attempt) because each retry
    // throws before reaching submit.
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(1);
  });

  it('on EXACT_OUT retry with eoaToDestinationAccount set, autoSelectSources outputRequired subtracts the direct COT credit', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // Refreshed dst: tokenSwap pulls 45 USDC + gasSwap pulls 4 USDC = 49 USDC total at the
    // wrapper. EOA already supplies 20 USDC via the batched transferFrom — source must
    // produce only 49 - 20 = 29 USDC.
    const route = makeRoute({
      type: 'EXACT_OUT',
      gasSwap: makeGasSwap({ inputAmountRaw: 5_000_000n }),
      dstSwap: makeDstQuote({ inputAmountRaw: 50_000_000n }),
      eoaToDestinationAccount: { amount: 20_000_000n, contractAddress: USDC },
      getDstSwapImpl: async () => ({
        creationTime: Date.now(),
        tokenSwap: makeDstQuote({ inputAmountRaw: 45_000_000n }),
        gasSwap: makeGasSwap({ inputAmountRaw: 4_000_000n }),
      }),
    });

    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);

    expect(autoSelectSourcesMock).toHaveBeenCalledTimes(1);
    const callArgs = autoSelectSourcesMock.mock.calls[0][0] as { outputRequired: Decimal };
    expect(callArgs.outputRequired.toFixed()).toBe('29');
  });

  it('on EXACT_OUT retry, autoSelectSources outputRequired clamps to zero when direct COT credit >= dst requirement', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // EOA holds 100 USDC; refreshed dst needs only 49 USDC. Source needs 0 USDC — clamp.
    const route = makeRoute({
      type: 'EXACT_OUT',
      gasSwap: makeGasSwap({ inputAmountRaw: 5_000_000n }),
      dstSwap: makeDstQuote({ inputAmountRaw: 50_000_000n }),
      eoaToDestinationAccount: { amount: 100_000_000n, contractAddress: USDC },
      getDstSwapImpl: async () => ({
        creationTime: Date.now(),
        tokenSwap: makeDstQuote({ inputAmountRaw: 45_000_000n }),
        gasSwap: makeGasSwap({ inputAmountRaw: 4_000_000n }),
      }),
    });

    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);

    const callArgs = autoSelectSourcesMock.mock.calls[0][0] as { outputRequired: Decimal };
    expect(callArgs.outputRequired.toFixed()).toBe('0');
  });

  it('on EXACT_IN retry with eoaToDestinationAccount set, getDestinationExactInSwap inputAmount includes the direct dst-chain COT credit (buffered)', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // Source re-quote returns 100 USDC; eoaToDestinationAccount adds 20 USDC via the
    // batched transferFrom. Wrapper holds 120 USDC; dst should be quoted for
    // 120 USDC * (1 - 0.5%) = 119.4 USDC = 119_400_000n.
    const route = makeRoute({
      type: 'EXACT_IN',
      eoaToDestinationAccount: { amount: 20_000_000n, contractAddress: USDC },
    });

    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);

    expect(getDestinationExactInSwapMock).toHaveBeenCalledTimes(1);
    const args = getDestinationExactInSwapMock.mock.calls[0][0] as { inputAmount: bigint };
    expect(args.inputAmount).toBe(119_400_000n);
  });

  it('source slippage guard ignores the fixed direct-COT credit (only source-swap output counts)', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // Old source output 100 USDC. EOA contributes a fixed 50 USDC, but that is not
    // source-quote performance and must not blunt the slippage guard. New source output
    // drops to 99.7 USDC — within 0.5% slippage of the OLD source amount alone, so the
    // retry should still proceed (no throw).
    liquidateSourceHoldingsMock.mockResolvedValue([
      makeSourceQuote({ outputAmountRaw: 99_700_000n }),
    ]);

    const route = makeRoute({
      type: 'EXACT_IN',
      eoaToDestinationAccount: { amount: 50_000_000n, contractAddress: USDC },
    });

    // Should not throw. Wrapper total: 99.7 + 50 = 149.7 USDC; dst input = 149.7 * 0.995.
    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);
    const args = getDestinationExactInSwapMock.mock.calls[0][0] as { inputAmount: bigint };
    expect(args.inputAmount).toBe(148_951_500n);
  });

  it('throws slippage error on EXACT_IN combined retry when source output drops > options.slippage even with no dst tokenSwap', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx.mockRejectedValue(new Error('execution reverted'));

    // Re-quoted source drops 20% — way beyond the 0.5% options.slippage. Even with no dst
    // tokenSwap (toToken == COT case), this must still throw.
    const degradedSrc = makeSourceQuote({ outputAmountRaw: 80_000_000n });
    liquidateSourceHoldingsMock.mockResolvedValue([degradedSrc]);

    await expect(
      new CombinedSwapHandler(makeRoute({ dstSwap: null }), options).process(
        makeMetadata() as never
      )
    ).rejects.toThrow(/slippage/i);
  });

  it('throws slippage error if re-quoted dst output drops more than options.slippage', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx.mockRejectedValue(new Error('execution reverted'));
    // Re-quoted dst output dropped from 90 USDH to 70 USDH — way over the 0.5% allowance.
    getDestinationExactInSwapMock.mockResolvedValue(makeDstQuote({ inputAmountRaw: 99_500_000n }));
    getDestinationExactInSwapMock.mockReset();
    const degradedDst = makeDstQuote();
    degradedDst.quote.output.amountRaw = 70_000_000n;
    getDestinationExactInSwapMock.mockResolvedValue(degradedDst);

    await expect(
      new CombinedSwapHandler(makeRoute(), options).process(makeMetadata() as never)
    ).rejects.toThrow();
  });

  it('caps retries at MAX_RETRIES (2) and propagates final failure', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx.mockRejectedValue(new Error('execution reverted'));

    await expect(
      new CombinedSwapHandler(makeRoute(), options).process(makeMetadata() as never)
    ).rejects.toThrow('execution reverted');

    // 1 initial attempt + 2 retries = 3 calls
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(3);
  });
});

describe('CombinedSwapHandler.process metadata + events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    waitForTxReceiptMock.mockResolvedValue(undefined);
    createPermitAndTransferFromTxMock.mockResolvedValue([PERMIT_TX, TRANSFER_FROM_TX]);
    createSweeperTxsMock.mockReturnValue([SWEEP_APPROVAL_TX, SWEEP_TX]);
    createSafeExecuteTxFromCallsMock.mockResolvedValue({ kind: 'safe' });
    createSBCTxFromCallsMock.mockResolvedValue({ kind: 'sbc' });
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
  });

  it('records the same tx hash on metadata.src[] and metadata.dst.tx_hash', async () => {
    const { options } = baseOptions();
    const metadata = makeMetadata();
    await new CombinedSwapHandler(makeRoute(), options).process(metadata as never);

    expect(metadata.src.length).toBe(1);
    expect((metadata.src[0] as { tx_hash: Uint8Array }).tx_hash).toEqual(
      (metadata.dst as { tx_hash: Uint8Array }).tx_hash
    );
  });
});

// Sanity check: the constant lives where route.ts callers expect it.
describe('COMBINED_SAME_CHAIN_BUFFER_PCT export', () => {
  it('is exported as a non-zero positive percentage', () => {
    expect(COMBINED_SAME_CHAIN_BUFFER_PCT).toBeGreaterThan(0);
    expect(COMBINED_SAME_CHAIN_BUFFER_PCT).toBeLessThan(100);
  });
});
