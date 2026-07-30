import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UserRejectedRequestError,
  type Hex,
  type PrivateKeyAccount,
  type WalletClient,
} from 'viem';

vi.mock('../../../src/services/sbc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/sbc')>(
    '../../../src/services/sbc'
  );
  return {
    ...actual,
    createSBCTxFromCalls: vi.fn(),
    requireSuccessfulSbcResult: vi.fn(
      (
        results: Array<
          | { chainId: number; errored: false; txHash: Hex }
          | { chainId: number; errored: true; message: string }
        >,
        chainId: number
      ) => {
        const result = results.find((entry) => entry.chainId === chainId);
        if (!result || result.errored) throw new Error(result?.message ?? 'submission failed');
        return result.txHash;
      }
    ),
  };
});

vi.mock('../../../src/services/allowance-utils', () => ({
  signPermitForAddressAndValue: vi.fn(),
}));

import { signPermitForAddressAndValue } from '../../../src/services/allowance-utils';
import { createSBCTxFromCalls } from '../../../src/services/sbc';
import { executeSourceSwaps } from '../../../src/swap/execution/source-swaps';
import type { Aggregator, QuoteResponse } from '../../../src/swap/aggregators/types';
import type {
  ExecutionContext,
  PreparedSwapExecution,
  SwapMetadata,
} from '../../../src/swap/types';
import { quoteResponseFixture } from '../../helpers/quote';
import { makeSwapExecutionMiddlewareClient } from '../../helpers/middleware-client';

const CHAIN_ID = 42161;
const INPUT = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
const COT = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
const TX_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;

const makeQuote = (): QuoteResponse =>
  quoteResponseFixture({
    chainID: CHAIN_ID,
    quote: {
      input: {
        contractAddress: INPUT,
        amount: '1',
        amountRaw: 1_000_000_000_000_000_000n,
        decimals: 18,
        value: 3000,
        symbol: 'WETH',
      },
      output: {
        contractAddress: COT,
        amount: '3000',
        amountRaw: 3_000_000_000n,
        decimals: 6,
        value: 3000,
        symbol: 'USDC',
      },
      txData: {
        approvalAddress: '0x1111111111111111111111111111111111111111',
        tx: {
          to: '0x2222222222222222222222222222222222222222',
          data: '0xabcdef',
          value: '0x0',
        },
      },
    },
    holding: {
      chainID: CHAIN_ID,
      tokenAddress: INPUT,
      amountRaw: 1_000_000_000_000_000_000n,
      decimals: 18,
      symbol: 'WETH',
    },
    aggregator: {} as Aggregator,
  });

const makePreparedExecution = (
  quote: QuoteResponse,
  lazyPermit = false
): PreparedSwapExecution => ({
  parsedQuotes: [
    {
      chainId: quote.chainID,
      quote: quote.quote,
      approval: {
        to: quote.quote.input.contractAddress,
        data: '0xapprove',
        value: 0n,
      },
      swap: {
        to: quote.quote.txData.tx.to,
        data: quote.quote.txData.tx.data,
        value: 0n,
      },
    },
  ],
  eoaToEphemeralTransfers: [
    {
      reason: 'source',
      chainId: CHAIN_ID,
      tokenAddress: INPUT,
      amount: quote.quote.input.amountRaw,
      targetAddress: EPH,
      authorization: {
        kind: 'permit',
        call: lazyPermit
          ? null
          : {
              to: INPUT,
              data: '0xpermit',
              value: 0n,
            },
        permit: {
          signature: lazyPermit ? null : '0x1234',
          permitVariant: 1,
          permitContractVersion: 2,
        },
      },
      transferCall: {
        to: INPUT,
        data: '0xtransferFrom',
        value: 0n,
      },
    },
  ],
});

const makeContext = (
  preparedExecution?: PreparedSwapExecution,
  readContract = vi.fn().mockResolvedValue(3_000_000_000n)
) => {
  const submitSBCs = vi.fn().mockResolvedValue([
    {
      chainId: CHAIN_ID,
      address: EPH,
      errored: false as const,
      txHash: TX_HASH,
    },
  ]);
  const context = {
    chainList: {
      getChainByID: vi.fn().mockReturnValue({
        id: CHAIN_ID,
        name: 'Arbitrum',
        supports7702: true,
      }),
    },
    sourceExecutionPaths: new Map([[CHAIN_ID, 'ephemeral']]),
    destinationDirectEoa: false,
    destinationChainId: 8453,
    eoaAddress: EOA,
    eoaWallet: {
      getChainId: vi.fn().mockResolvedValue(CHAIN_ID),
      switchChain: vi.fn(),
      addChain: vi.fn(),
      writeContract: vi.fn(),
    } as unknown as WalletClient,
    ephemeralWallet: {
      address: EPH,
      signTypedData: vi.fn(),
    } as unknown as PrivateKeyAccount,
    publicClientList: {
      get: vi.fn().mockReturnValue({
        call: vi.fn().mockResolvedValue({ data: '0x' }),
        getCode: vi.fn().mockResolvedValue(undefined),
        readContract,
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: 'success',
          transactionHash: TX_HASH,
        }),
      }),
    },
    middlewareClient: makeSwapExecutionMiddlewareClient({ submitSBCs }),
    cache: {
      getAllowance: vi.fn().mockReturnValue(0n),
      hasAuthCodeSet: vi.fn().mockReturnValue(true),
    },
    preparedExecution,
    onProgress: vi.fn(),
    slippage: 0.005,
  } as unknown as ExecutionContext & { destinationChainId: number };
  return { context, submitSBCs };
};

const metadata = (): SwapMetadata => ({
  src: [],
  dst: null,
  has_xcs: false,
  intent_request_hash: null,
});

describe('executeSourceSwaps contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signPermitForAddressAndValue).mockResolvedValue(
      `0x${'11'.repeat(65)}`
    );
    vi.mocked(createSBCTxFromCalls).mockResolvedValue({
      chainId: CHAIN_ID,
      address: EPH,
      calls: [],
      deadline: '0x01',
      keyHash: '0x00',
      nonce: '0x01',
      revertOnFailure: true,
      signature: '0x1234',
    } as never);
  });

  it('groups repeated same-chain legs and consumes their prepared transfer only once', async () => {
    const quote = makeQuote();
    const { context } = makeContext(makePreparedExecution(quote));

    await executeSourceSwaps(
      {
        swaps: [quote, quote],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
      },
      context,
      metadata()
    );

    const calls = vi.mocked(createSBCTxFromCalls).mock.calls[0]?.[0].calls;
    expect(calls.filter((call) => call.data === '0xpermit')).toHaveLength(1);
    expect(calls.filter((call) => call.data === '0xtransferFrom')).toHaveLength(1);
  });

  it('treats a rejected permit authorization as terminal before dispatch', async () => {
    const quote = makeQuote();
    quote.aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(),
    } as unknown as Aggregator;
    const { context, submitSBCs } = makeContext(makePreparedExecution(quote, true));
    vi.mocked(signPermitForAddressAndValue).mockRejectedValue(
      new UserRejectedRequestError(new Error('permit rejected'))
    );

    await expect(
      executeSourceSwaps(
        {
          swaps: [quote],
          creationTime: Date.now(),
          srcBuffer: new Decimal(0),
        },
        context,
        metadata()
      )
    ).rejects.toMatchObject({ code: 'user_action/allowance_approval_denied' });

    expect(submitSBCs).not.toHaveBeenCalled();
    expect(quote.aggregator.getQuotes).not.toHaveBeenCalled();
  });

  it('treats a rejected source dispatch as a transaction rejection', async () => {
    const quote = makeQuote();
    quote.aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(),
    } as unknown as Aggregator;
    const { context, submitSBCs } = makeContext();
    submitSBCs.mockRejectedValue(
      new UserRejectedRequestError(new Error('dispatch rejected'))
    );

    await expect(
      executeSourceSwaps(
        {
          swaps: [quote],
          creationTime: Date.now(),
          srcBuffer: new Decimal(0),
        },
        context,
        metadata()
      )
    ).rejects.toMatchObject({ code: 'user_action/tx_send_denied' });

    expect(quote.aggregator.getQuotes).not.toHaveBeenCalled();
  });

  it('reclaims actual COT using the quote output when no route COT metadata exists', async () => {
    const quote = makeQuote();
    const readContract = vi.fn().mockResolvedValue(3_100_000_000n);
    const { context } = makeContext(undefined, readContract);

    const assets = await executeSourceSwaps(
      {
        swaps: [quote],
        creationTime: Date.now(),
        srcBuffer: null,
        reclaimFromActualBalance: true,
      },
      context,
      metadata()
    );

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: COT,
        functionName: 'balanceOf',
      })
    );
    expect(assets[0]?.ephemeralBalance.toString()).toBe('3100');
  });
});
