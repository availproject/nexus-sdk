// Regression: native (ETH) EOA source swap — on a failed dispatch the leg re-quotes, and the
// RE-DISPATCH must carry the FRESH re-quoted order, not the stale prepared one. Before the
// getParsedQuote fix the field-based fallback re-matched the re-quote (same chain / router / input
// token / input amount for an EXACT_IN leg) back to the prepared cache and resent the original,
// expired order.
import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import {
  decodeFunctionData,
  parseAbi,
  type Hex,
  type PrivateKeyAccount,
  type WalletClient,
} from 'viem';

import { executeSourceSwaps } from '../../../src/swap/execution/source-swaps';
import type { Aggregator, QuoteResponse } from '../../../src/swap/aggregators/types';
import type {
  ExecutionContext,
  PreparedSwapExecution,
  SwapMetadata,
  WalletPath,
} from '../../../src/swap/types';
import { EADDRESS } from '../../../src/swap/constants';
import { quoteFixture } from '../../helpers/quote';

const ARB_CHAIN = 42161;
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
const BEBOP = '0xbeb0b0623f66be8ce162ebdfa2ec543a522f4ea6' as Hex; // settlement addr — CONSTANT across requotes
const NATIVE_IN = 15000000000000000n; // 0.015 ETH — FIXED for EXACT_IN

const innerData = (data: Hex) => {
  const decoded = decodeFunctionData({
    abi: parseAbi([
      'function execute((((address to,uint256 value,bytes data)[] calls,bool revertOnFailure) batchedCall,uint256 nonce,bytes32 keyHash,address executor,uint256 deadline) signedBatchedCall,bytes wrappedSignature)',
    ]),
    data,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (decoded.args?.[0] as any).batchedCall.calls[0].data as Hex;
};

// original + requote share (chainId, to=BEBOP, inputToken=EADDRESS, inputAmount) — all invariant
// under an EXACT_IN requote. Only inner `data` + `output` differ, so the dispatched inner `data`
// tells stale (original) from fresh (re-quoted) apart.
const makeNativeQuote = (swapData: Hex, outputRaw: bigint, aggregator?: Aggregator): QuoteResponse => ({
  chainID: ARB_CHAIN,
  quote: quoteFixture({
    input: { contractAddress: EADDRESS as Hex, amount: '0.015', amountRaw: NATIVE_IN, decimals: 18, value: 45, symbol: 'ETH' },
    output: { contractAddress: USDC, amount: '45', amountRaw: outputRaw, decimals: 6, value: 45, symbol: 'USDC' },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: { to: BEBOP, data: swapData, value: '0x354a6ba7a18000' as Hex },
    },
  }),
  holding: { chainID: ARB_CHAIN, tokenAddress: EADDRESS as Hex, amountRaw: NATIVE_IN, decimals: 18, symbol: 'ETH' },
  aggregator: aggregator ?? ({} as Aggregator),
});

const makeCtx = (opts: {
  receiptStatuses: Array<'reverted' | 'success'>;
  preparedExecution?: PreparedSwapExecution;
}) => {
  const waitForTransactionReceipt = vi.fn();
  for (const status of opts.receiptStatuses) {
    waitForTransactionReceipt.mockResolvedValueOnce({ status, transactionHash: '0xrcpt' as Hex });
  }
  const sendTransaction = vi.fn().mockResolvedValue('0xnative_tx' as Hex);
  const ctx = {
    chainList: { getChainByID: vi.fn().mockReturnValue({ id: ARB_CHAIN, name: 'Arbitrum' }) },
    sourceExecutionPaths: new Map<number, WalletPath>([[ARB_CHAIN, 'ephemeral']]),
    eoaAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
    ephemeralWallet: {
      address: '0xbbbb000000000000000000000000000000000002' as Hex,
      signTypedData: vi.fn().mockResolvedValue(('0x' + 'aa'.repeat(65)) as Hex),
      signAuthorization: vi.fn().mockResolvedValue({ r: '0x01', s: '0x02', yParity: 0, nonce: 0 }),
    } as unknown as PrivateKeyAccount,
    eoaWallet: {
      getChainId: vi.fn().mockResolvedValue(ARB_CHAIN),
      switchChain: vi.fn().mockResolvedValue(undefined),
      addChain: vi.fn().mockResolvedValue(undefined),
      sendTransaction,
    } as unknown as WalletClient,
    publicClientList: { get: vi.fn().mockReturnValue({ waitForTransactionReceipt }) },
    middlewareClient: {} as ExecutionContext['middlewareClient'],
    cache: { hasAuthCodeSet: vi.fn().mockReturnValue(true), markAuthCodeSet: vi.fn() },
    preparedExecution: opts.preparedExecution,
    onProgress: vi.fn(),
    slippage: 0.005,
    destinationDirectEoa: false,
    destinationChainId: ARB_CHAIN,
  } as unknown as ExecutionContext & { destinationChainId: number };
  return { ctx, sendTransaction };
};

const metadata = (): SwapMetadata => ({ src: [], dst: null, has_xcs: false, intent_request_hash: null });
// realistic EXACT_IN buffer: min(0.5% * $45, $1) = $0.225 — requote below is EQUAL output, well inside it
const REAL_SRC_BUFFER = new Decimal(0.225);

describe('native EOA source swap dispatches the fresh re-quote on retry', () => {
  it('WITH preparedExecution: a re-quote is dispatched, not the stale prepared order', async () => {
    const requoted = makeNativeQuote('0xbbbbbbbb', 45000000n); // fresh order, EQUAL output (inside buffer)
    const aggregator = { supportsChain: () => true, getQuotes: vi.fn().mockResolvedValue([requoted.quote]) } as unknown as Aggregator;
    const original = makeNativeQuote('0xaaaaaaaa', 45000000n, aggregator);

    // prepared parsedQuote mirrors what prepare() builds from the ORIGINAL quote
    const prepared = {
      parsedQuotes: [
        {
          chainId: ARB_CHAIN,
          quote: original.quote, // same object ref as source.swaps[0].quote
          approval: { to: EADDRESS as Hex, data: '0xapprove' as Hex, value: 0n },
          swap: { to: BEBOP, data: '0xaaaaaaaa' as Hex, value: NATIVE_IN },
        },
      ],
      eoaToEphemeralTransfers: [],
    } as unknown as PreparedSwapExecution;

    const { ctx, sendTransaction } = makeCtx({
      receiptStatuses: ['reverted', 'reverted'],
      preparedExecution: prepared,
    });

    await executeSourceSwaps(
      { swaps: [original], creationTime: Date.now(), srcBuffer: REAL_SRC_BUFFER },
      ctx,
      metadata()
    ).catch(() => undefined); // both attempts revert; we only assert what was dispatched

    const sends = sendTransaction.mock.calls.map((c) => innerData(c[0].data as Hex));
    expect(aggregator.getQuotes).toHaveBeenCalledTimes(1); // re-quote happened, in-buffer
    expect(sends).toEqual(['0xaaaaaaaa', '0xbbbbbbbb']); // attempt-0 prepared, attempt-1 the FRESH re-quote
  });

  it('WITHOUT preparedExecution: a re-quote is dispatched (control)', async () => {
    const requoted = makeNativeQuote('0xbbbbbbbb', 45000000n);
    const aggregator = { supportsChain: () => true, getQuotes: vi.fn().mockResolvedValue([requoted.quote]) } as unknown as Aggregator;
    const original = makeNativeQuote('0xaaaaaaaa', 45000000n, aggregator);

    const { ctx, sendTransaction } = makeCtx({ receiptStatuses: ['reverted', 'success'] });

    await executeSourceSwaps(
      { swaps: [original], creationTime: Date.now(), srcBuffer: REAL_SRC_BUFFER },
      ctx,
      metadata()
    );

    const sends = sendTransaction.mock.calls.map((c) => innerData(c[0].data as Hex));
    expect(sends).toEqual(['0xaaaaaaaa', '0xbbbbbbbb']);
  });
});
