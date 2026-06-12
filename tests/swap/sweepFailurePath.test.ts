/**
 * Verifies the destination-swap failure-path sweep (`sweepToEoa`) routes funds correctly
 * on Safe-mode chains. Reports motivated this: COT got stranded on the per-user Safe even
 * though the SDK was supposed to recover it.
 *
 * The tests pin two things:
 *   1. Address consistency — every layer of the sweep (sweeper tx, destination execution,
 *      Safe execute payload) uses the SAME Safe address. No drift between retries.
 *   2. The receiver is the user's EOA, not the ephemeral or the Safe itself.
 *
 * Plus a documented-bug test for the silent `.catch` in `sweepToEoa` so the regression is
 * visible: when the sweep itself fails, the original swap error bubbles up but the sweep
 * failure is only logged.
 */
import { CurrencyID } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZERO_BYTES_32 } from '../../src/swap/constants';
import { predictSafeAccountAddress } from '../../src/swap/safetx';

const switchChainMock = vi.hoisted(() => vi.fn());
const waitForTxReceiptMock = vi.hoisted(() => vi.fn());
const performDestinationSwapMock = vi.hoisted(() => vi.fn());
const createPermitAndTransferFromTxMock = vi.hoisted(() => vi.fn());
const createSweeperTxsMock = vi.hoisted(() => vi.fn());
const createSafeExecuteTxFromCallsMock = vi.hoisted(() => vi.fn());
const createSafeExecuteEOASubmittedTxMock = vi.hoisted(() => vi.fn());
const createSBCTxFromCallsMock = vi.hoisted(() => vi.fn());
const caliburExecuteMock = vi.hoisted(() => vi.fn());
const checkAuthCodeSetMock = vi.hoisted(() => vi.fn());
const waitForSBCTxReceiptMock = vi.hoisted(() => vi.fn());

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
    performDestinationSwap: performDestinationSwapMock,
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

import { DestinationSwapHandler } from '../../src/swap/ob';

// Canonical pin from tests/swap/safe.golden.test.ts — anchors address derivation so a
// future change to predictSafeAccountAddress that breaks the sweep would also break here.
const EPHEMERAL = '0x1111111111111111111111111111111111111111' as const;
const SAFE_FROM_EPHEMERAL = '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9' as const;
const EOA = '0x4444444444444444444444444444444444444444' as const;

const buildOptions = (overrides: Record<string, unknown> = {}) => ({
  address: {
    cosmos: '',
    eoa: EOA,
    ephemeral: EPHEMERAL,
  },
  aggregators: [],
  cache: {
    addAllowanceQuery: vi.fn(),
    addPermitQuery: vi.fn(),
    addSetCodeQuery: vi.fn(),
    getCode: vi.fn(() => '0x'),
  },
  chainList: {
    getChainByID: vi.fn(() => ({
      blockExplorers: { default: { url: 'https://example.com' } },
      id: 999,
      name: 'HyperEVM',
    })),
  },
  cot: {
    currencyID: CurrencyID.USDC,
    symbol: 'USDC',
  },
  cosmosQueryClient: {} as never,
  destinationChainID: 999,
  emitter: { emit: vi.fn() },
  publicClientList: { get: vi.fn(() => ({})) },
  vscClient: {
    vscCreateSafeExecuteTx: vi.fn(),
    vscEnsureSafeAccount: vi.fn().mockResolvedValue({ exists: true }),
    vscSBCTx: vi.fn(),
  },
  wallet: {
    cosmos: {} as never,
    eoa: {} as never,
    ephemeral: { address: EPHEMERAL } as never,
  },
  ...overrides,
});

const buildSafeDestinationData = () => ({
  chainId: 999,
  eoaToDestinationAccount: null,
  execution: {
    address: SAFE_FROM_EPHEMERAL,
    entryPoint: null,
    mode: 'safe_account',
  },
  getDstSwap: vi.fn().mockResolvedValue({
    creationTime: Date.now(),
    gasSwap: null,
    tokenSwap: makeTokenSwap(),
  }),
  inputAmount: { max: new Decimal(0), min: new Decimal(0) },
  swap: {
    creationTime: Date.now(),
    gasSwap: null,
    tokenSwap: makeTokenSwap(),
  },
});

const makeTokenSwap = () => ({
  quote: {
    expiry: Math.floor(Date.now() / 1000) + 600,
    input: {
      amount: '1',
      amountRaw: 1_000_000n,
      contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      decimals: 6,
      symbol: 'USDC',
    },
    output: {
      amount: '1',
      amountRaw: 1_000_000n,
      contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      decimals: 6,
      symbol: 'TOKEN',
    },
    txData: {
      approvalAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
      tx: { data: '0xdead', to: '0xdddddddddddddddddddddddddddddddddddddddd', value: '0' },
    },
  },
});

const metadata = {
  dst: { chid: ZERO_BYTES_32, swaps: [], tx_hash: ZERO_BYTES_32, univ: 1 },
  has_xcs: true,
  rff_id: 0n,
  src: [],
} as const;

describe('DestinationSwapHandler sweepToEoa (Safe-mode failure path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    waitForTxReceiptMock.mockResolvedValue(undefined);
    createSafeExecuteTxFromCallsMock.mockResolvedValue({ kind: 'safe' });
    createSBCTxFromCallsMock.mockResolvedValue({ kind: 'sbc' });
    createSweeperTxsMock.mockReturnValue([
      { data: '0xapprove', to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', value: 0n },
      { data: '0xsweep', to: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', value: 0n },
    ]);
    caliburExecuteMock.mockResolvedValue('0xhash');
    checkAuthCodeSetMock.mockResolvedValue(true);
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
  });

  it('canonical: predictSafeAccountAddress(ephemeral) matches the destination execution address', () => {
    // Anchors the test fixture to the real derivation. If this breaks, the entire premise
    // of "swept-from address == predicted Safe address" is wrong, and stuck funds are
    // expected.
    expect(predictSafeAccountAddress(EPHEMERAL)).toBe(SAFE_FROM_EPHEMERAL);
  });

  it('invokes sweepToEoa after retries are exhausted, with receiver=EOA and sender=Safe', async () => {
    // First 3 attempts (MAX_RETRIES + 1) fail; the 4th call is the sweep — let it succeed.
    let callCount = 0;
    performDestinationSwapMock.mockImplementation(() => {
      callCount += 1;
      if (callCount <= 3) {
        return Promise.reject(new Error('destination swap reverted'));
      }
      return Promise.resolve('0xsweephash');
    });

    const handler = new DestinationSwapHandler(
      {
        bridge: null,
        destination: buildSafeDestinationData(),
        extras: null,
        source: { swaps: [] },
      } as never,
      buildOptions() as never
    );

    await expect(handler.process(metadata as never)).rejects.toThrow('destination swap reverted');

    expect(performDestinationSwapMock).toHaveBeenCalledTimes(4);

    const sweepCall = performDestinationSwapMock.mock.calls[3][0];
    expect(sweepCall.actualAddress).toBe(EOA);
    expect(sweepCall.destinationExecution.address).toBe(SAFE_FROM_EPHEMERAL);
    expect(sweepCall.destinationExecution.mode).toBe('safe_account');
    expect(sweepCall.hasDestinationSwap).toBe(false);
    expect(sweepCall.signerWallet).toEqual({ address: EPHEMERAL });
  });

  it('sweepToEoa builds the sweeper tx with sender=Safe and receiver=EOA (no address drift)', async () => {
    let callCount = 0;
    performDestinationSwapMock.mockImplementation(() => {
      callCount += 1;
      if (callCount <= 3) {
        return Promise.reject(new Error('destination swap reverted'));
      }
      return Promise.resolve('0xsweephash');
    });

    const handler = new DestinationSwapHandler(
      {
        bridge: null,
        destination: buildSafeDestinationData(),
        extras: null,
        source: { swaps: [] },
      } as never,
      buildOptions() as never
    );

    await expect(handler.process(metadata as never)).rejects.toThrow();

    // createSweeperTxs is called once by sweepToEoa itself. (performDestinationSwap calls
    // it again internally to append the leftover-COT sweep, but that's mocked here.)
    const sweepConstructionCall = createSweeperTxsMock.mock.calls.find(
      (call) => call[0].sender === SAFE_FROM_EPHEMERAL
    );
    expect(sweepConstructionCall).toBeDefined();
    expect(sweepConstructionCall[0]).toMatchObject({
      sender: SAFE_FROM_EPHEMERAL,
      receiver: EOA,
      chainID: 999,
      COTCurrencyID: CurrencyID.USDC,
    });
    // Critical negative assertion: must NOT use the ephemeral as sender — that's the
    // SBC/7702 address, funds aren't there on Safe-mode chains.
    expect(sweepConstructionCall[0].sender).not.toBe(EPHEMERAL);
    // Must NOT send funds back to the Safe itself.
    expect(sweepConstructionCall[0].receiver).not.toBe(SAFE_FROM_EPHEMERAL);
  });

  it('records the sweep allowance against owner=Safe (not ephemeral) at construction time', () => {
    // DestinationSwapHandler's constructor pre-queues the allowance cache key used by the
    // sweeper. If owner here is wrong (e.g. ephemeral), the cache miss causes a redundant
    // approve on every sweep, AND the cache key never gets warmed.
    const options = buildOptions();
    new DestinationSwapHandler(
      {
        bridge: null,
        destination: buildSafeDestinationData(),
        extras: null,
        source: { swaps: [] },
      } as never,
      options as never
    );

    const allowanceCalls = (options.cache.addAllowanceQuery as ReturnType<typeof vi.fn>).mock.calls;
    const sweeperAllowanceCall = allowanceCalls.find(
      (call) => call[0].owner === SAFE_FROM_EPHEMERAL
    );
    expect(sweeperAllowanceCall).toBeDefined();
    expect(sweeperAllowanceCall[0]).toMatchObject({
      chainID: 999,
      owner: SAFE_FROM_EPHEMERAL,
    });
  });

  it('documents the silent-catch bug: a sweep that throws is logged-only, original swap error still rethrown', async () => {
    // Reproduces the failure mode where the sweep tx cannot even be constructed (e.g.,
    // nonce read on an undeployed Safe throws inside `createSafeExecuteTxFromCalls`).
    // Today, `sweepToEoa` swallows that error and `process` rethrows the original swap
    // error. From the user's perspective the funds are still stuck and no sweep-specific
    // error surfaces — only a generic "swap failed".
    let callCount = 0;
    performDestinationSwapMock.mockImplementation(() => {
      callCount += 1;
      if (callCount <= 3) {
        return Promise.reject(new Error('destination swap reverted'));
      }
      // The sweep call ALSO fails — simulates `createSafeExecuteTxFromCalls` throwing
      // because the Safe isn't deployed, or vscCreateSafeExecuteTx failing.
      return Promise.reject(new Error('sweep build failed: nonce read on undeployed safe'));
    });

    const handler = new DestinationSwapHandler(
      {
        bridge: null,
        destination: buildSafeDestinationData(),
        extras: null,
        source: { swaps: [] },
      } as never,
      buildOptions() as never
    );

    // The error rethrown is the SWAP error, not the SWEEP error — that's the bug
    // documented here. The sweep failure is only logged.
    await expect(handler.process(metadata as never)).rejects.toThrow('destination swap reverted');
    expect(performDestinationSwapMock).toHaveBeenCalledTimes(4);
  });
});
