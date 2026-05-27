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
  srcBuffer?: Decimal;
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
      srcBuffer: overrides?.srcBuffer ?? new Decimal(0),
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
    // Default: source re-quote returns same output (no drop).
    liquidateSourceHoldingsMock.mockResolvedValue([makeSourceQuote()]);
  });

  it('on revert (EXACT_IN), re-quotes source via liquidateSourceHoldings, dst via route.destination.getDstSwap, then retries', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    const route = makeRoute({ type: 'EXACT_IN' });
    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);

    expect(liquidateSourceHoldingsMock).toHaveBeenCalledTimes(1);
    expect(
      (route as never as { destination: { getDstSwap: ReturnType<typeof vi.fn> } }).destination
        .getDstSwap
    ).toHaveBeenCalled();
    // No direct getDestinationExactInSwap call — dst quoting is delegated to the closure.
    expect(getDestinationExactInSwapMock).not.toHaveBeenCalled();
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(2);
  });

  it('re-quotes source with the SAME input amounts as the initial swaps (no re-approval/permit prompt)', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // Initial source input is 100_000_000n via makeSourceQuote default.
    await new CombinedSwapHandler(makeRoute({ type: 'EXACT_IN' }), options).process(
      makeMetadata() as never
    );

    const callArgs = liquidateSourceHoldingsMock.mock.calls[0][0] as {
      holdings: { amountRaw: bigint }[];
    };
    expect(callArgs.holdings).toHaveLength(1);
    expect(callArgs.holdings[0].amountRaw).toBe(100_000_000n);
  });

  it('on revert (EXACT_OUT), re-quotes dst FIRST (so getDstSwap rate guard fails fast), then source', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    const callOrder: string[] = [];
    const route = makeRoute({
      type: 'EXACT_OUT',
      getDstSwapImpl: async () => {
        callOrder.push('getDstSwap');
        return { creationTime: Date.now(), gasSwap: null, tokenSwap: makeDstQuote() };
      },
    });
    liquidateSourceHoldingsMock.mockImplementation(async () => {
      callOrder.push('liquidateSourceHoldings');
      return [makeSourceQuote()];
    });

    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);

    expect(callOrder).toEqual(['getDstSwap', 'liquidateSourceHoldings']);
  });

  // Combined batches are atomic: src outputs and dst inputs balance on the same wrapper
  // inside one tx. The only invariant the retry must enforce is `sum(src.output) ≥
  // sum(dst.input)`. The bridge-style buffer check (newTotal < oldTotal − srcBuffer) used
  // to protect bridges where the bridge was already sized against the OLD src total; for
  // combined there's no pre-commit to anchor against, so that check has been removed.
  it('accepts retry when source output covers dst input (exact-fit)', async () => {
    // New src output 99.5 USDC == dst input 99.5 USDC → exactly funded → retry succeeds.
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    liquidateSourceHoldingsMock.mockResolvedValue([
      makeSourceQuote({ outputAmountRaw: 99_500_000n }),
    ]);

    await expect(
      new CombinedSwapHandler(makeRoute({ type: 'EXACT_IN' }), options).process(
        makeMetadata() as never
      )
    ).resolves.toBeUndefined();
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(2);
  });

  it('throws when source output cannot fund dst input', async () => {
    // New src output 98 USDC < dst input 99.5 USDC → unfundable → throw.
    // Old test used srcBuffer as the threshold; new logic compares src.output to dst.input
    // directly, so `srcBuffer` is irrelevant here.
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx.mockRejectedValue(new Error('execution reverted'));

    liquidateSourceHoldingsMock.mockResolvedValue([
      makeSourceQuote({ outputAmountRaw: 98_000_000n }),
    ]);

    await expect(
      new CombinedSwapHandler(makeRoute({ type: 'EXACT_IN' }), options).process(
        makeMetadata() as never
      )
    ).rejects.toThrow(/source output .* cannot fund destination input/);
  });

  it('src.output ≥ dst.input invariant applies to EXACT_OUT as well', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx.mockRejectedValue(new Error('execution reverted'));

    liquidateSourceHoldingsMock.mockResolvedValue([
      makeSourceQuote({ outputAmountRaw: 98_000_000n }),
    ]);

    await expect(
      new CombinedSwapHandler(makeRoute({ type: 'EXACT_OUT' }), options).process(
        makeMetadata() as never
      )
    ).rejects.toThrow(/source output .* cannot fund destination input/);
  });

  // Regression for "few failures, no TX_FAIL, oldTotal == newTotal exactly" pattern: on a
  // combined retry, an aggregator that returns identical src quotes used to trip the dst
  // rate-tolerance guard (`ratesChangedBeyondTolerance`) when the dst pool drifted. Combined
  // retries now skip that guard — the only thing that matters is whether the requoted src
  // output funds the requoted dst input.
  it('skips dst rate guard on combined retry when src is stable and dst still funds', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // Mirror of the production pattern: identical src quote across attempts, dst quote
    // requires slightly more input than the original max (which would have thrown
    // ratesChangedBeyondTolerance with the old behavior) — but src still covers it.
    liquidateSourceHoldingsMock.mockResolvedValue([
      makeSourceQuote({ outputAmountRaw: 100_000_000n }), // unchanged
    ]);
    const dstAfterDrift = makeDstQuote({ inputAmountRaw: 99_900_000n }); // dst wants 99.9
    const route = makeRoute({
      type: 'EXACT_IN',
      getDstSwapImpl: async () => ({
        creationTime: Date.now(),
        tokenSwap: dstAfterDrift,
        gasSwap: null,
      }),
    });

    await expect(
      new CombinedSwapHandler(route, options).process(makeMetadata() as never)
    ).resolves.toBeUndefined();

    // Verify the dst closure was called with the skip-guard hint.
    const dstCalls = (
      route as never as {
        destination: { getDstSwap: ReturnType<typeof vi.fn> };
      }
    ).destination.getDstSwap.mock.calls;
    expect(dstCalls.length).toBeGreaterThan(0);
    expect(dstCalls.at(-1)?.[0]).toEqual({ skipRateGuard: true });
  });

  // Funding invariant must account for `eoaToDestinationAccount` — pre-existing dst-chain
  // COT that buildBatch permits/transfers from the EOA to the wrapper BEFORE the dst swap
  // pulls. A route where src.output alone < dst.input but src.output + EOA→dst ≥ dst.input
  // is valid on-chain, and the retry check must not falsely reject it.
  it('counts eoaToDestinationAccount toward available COT when it matches the dst input token', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // dst input is 99.5 USDC; src output requoted to 60 USDC. Alone, this would fail the
    // invariant. With a 40 USDC EOA→dst contribution (same USDC contract), the wrapper has
    // 100 USDC total, comfortably covering the dst input.
    liquidateSourceHoldingsMock.mockResolvedValue([
      makeSourceQuote({ outputAmountRaw: 60_000_000n }),
    ]);

    const route = makeRoute({
      type: 'EXACT_IN',
      eoaToDestinationAccount: { amount: 40_000_000n, contractAddress: USDC },
    });

    await expect(
      new CombinedSwapHandler(route, options).process(makeMetadata() as never)
    ).resolves.toBeUndefined();
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(2);
  });

  it('ignores eoaToDestinationAccount when its token does not match dst input', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx.mockRejectedValue(new Error('execution reverted'));

    // Same setup as above, but the EOA contribution is in a DIFFERENT token (KHYPE, not
    // USDC). It can't fund the USDC dst input → invariant check still fails.
    liquidateSourceHoldingsMock.mockResolvedValue([
      makeSourceQuote({ outputAmountRaw: 60_000_000n }),
    ]);

    const route = makeRoute({
      type: 'EXACT_IN',
      eoaToDestinationAccount: { amount: 40_000_000n, contractAddress: KHYPE },
    });

    await expect(
      new CombinedSwapHandler(route, options).process(makeMetadata() as never)
    ).rejects.toThrow(/source output .* cannot fund destination input/);
  });

  it('propagates getDstSwap throw (e.g. rate guard) without falling through to a source re-quote', async () => {
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
    // Initial attempt submits once, fails, then each retry throws inside getDstSwap before
    // reaching submit or source re-quote.
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(1);
    expect(liquidateSourceHoldingsMock).not.toHaveBeenCalled();
  });

  it('updates route.source.swaps and route.destination.swap after a successful retry', async () => {
    const { options, vscClient } = baseOptions();
    vscClient.vscCreateSafeExecuteTx
      .mockRejectedValueOnce(new Error('execution reverted'))
      .mockResolvedValueOnce([BigInt(CHAIN_ID), SAFE_HASH]);

    // The retry path replaces source.swaps with the liquidate result; identify by a
    // distinct output amount that doesn't match the initial.
    const refreshedSrc = makeSourceQuote({ outputAmountRaw: 99_900_000n });
    const refreshedDst = makeDstQuote({ inputAmountRaw: 99_400_000n });
    liquidateSourceHoldingsMock.mockResolvedValue([refreshedSrc]);

    const route = makeRoute({
      type: 'EXACT_IN',
      srcBuffer: new Decimal(1),
      getDstSwapImpl: async () => ({
        creationTime: Date.now(),
        gasSwap: null,
        tokenSwap: refreshedDst,
      }),
    });

    await new CombinedSwapHandler(route, options).process(makeMetadata() as never);

    expect(
      (route as never as { source: { swaps: { quote: { output: { amountRaw: bigint } } }[] } })
        .source.swaps[0].quote.output.amountRaw
    ).toBe(99_900_000n);
    expect(
      (
        route as never as {
          destination: { swap: { tokenSwap: { quote: { input: { amountRaw: bigint } } } } };
        }
      ).destination.swap.tokenSwap.quote.input.amountRaw
    ).toBe(99_400_000n);
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
