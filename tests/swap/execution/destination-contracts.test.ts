import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex, PrivateKeyAccount, WalletClient } from 'viem';

vi.mock('../../../src/swap/sweep', () => ({
  createSweeperTxs: vi.fn().mockReturnValue([
    {
      to: '0x1111111111111111111111111111111111111111',
      data: '0x1234',
      value: 0n,
    },
  ]),
}));

import { ERROR_CODES, Errors } from '../../../src/domain/errors';
import { executeDestinationSwap } from '../../../src/swap/execution/destination-swap';
import { createSweeperTxs } from '../../../src/swap/sweep';
import type { Aggregator, QuoteResponse } from '../../../src/swap/aggregators/types';
import {
  SwapMode,
  type DestinationSwap,
  type ExecutionContext,
  type SwapMetadata,
  type SwapRoute,
} from '../../../src/swap/types';
import { quoteResponseFixture } from '../../helpers/quote';
import { makeSwapExecutionMiddlewareClient } from '../../helpers/middleware-client';

const CHAIN_ID = 42161;
const COT = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const OUTPUT = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
const EPH = '0xbbbb000000000000000000000000000000000002' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;

const makeQuote = (
  inputAmountRaw = 3_000_000_000n,
  overrides: { output?: Hex; expiry?: number; aggregator?: Aggregator | null } = {}
): QuoteResponse =>
  quoteResponseFixture({
    chainID: CHAIN_ID,
    quote: {
      input: {
        contractAddress: COT,
        amount: new Decimal(inputAmountRaw.toString()).div(1_000_000).toString(),
        amountRaw: inputAmountRaw,
        decimals: 6,
        value: Number(inputAmountRaw) / 1_000_000,
        symbol: 'USDC',
      },
      output: {
        contractAddress: overrides.output ?? OUTPUT,
        amount: '1',
        amountRaw: 1_000_000_000_000_000_000n,
        decimals: 18,
        value: 3000,
        symbol: 'WETH',
      },
      txData: {
        approvalAddress: '0x1111111111111111111111111111111111111111',
        tx: {
          to: '0x2222222222222222222222222222222222222222',
          data: '0xabcdef',
          value: '0x0',
        },
      },
      expiry: overrides.expiry,
    },
    holding: {
      chainID: CHAIN_ID,
      tokenAddress: COT,
      amountRaw: inputAmountRaw,
      decimals: 6,
      symbol: 'USDC',
    },
    aggregator:
      overrides.aggregator === null
        ? (null as never)
        : (overrides.aggregator ?? ({} as Aggregator)),
  });

const makeDestination = (
  swap: DestinationSwap,
  getDstSwap: ReturnType<typeof vi.fn>
): SwapRoute['destination'] =>
  ({
    chainId: CHAIN_ID,
    eoaToEphemeral: null,
    inputAmount: { min: new Decimal('3000'), max: new Decimal('3150') },
    swap,
    getDstSwap,
  }) as SwapRoute['destination'];

const makeContext = (readContract = vi.fn().mockResolvedValue(3_000_000_000n)) => {
  const createSafeExecuteTx = vi.fn().mockResolvedValue({
    chainId: CHAIN_ID,
    safeAddress: EPH,
    txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex,
  });
  const context = {
    chainList: {
      getChainByID: vi.fn().mockReturnValue({
        id: CHAIN_ID,
        name: 'Arbitrum',
      }),
    },
    eoaAddress: EOA,
    eoaWallet: {} as WalletClient,
    ephemeralWallet: {
      address: EPH,
      signTypedData: vi.fn().mockResolvedValue(`0x${'11'.repeat(64)}1b`),
    } as unknown as PrivateKeyAccount,
    publicClientList: {
      get: vi.fn().mockReturnValue({
        getCode: vi.fn().mockResolvedValue(undefined),
        readContract,
        waitForTransactionReceipt: vi.fn().mockResolvedValue({
          status: 'success',
          transactionHash:
            '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }),
      }),
    },
    middlewareClient: makeSwapExecutionMiddlewareClient({
      createSafeExecuteTx,
    }),
    cache: {
      getAllowance: vi.fn().mockReturnValue(0n),
    },
    onProgress: vi.fn(),
    slippage: 0.005,
  } as unknown as Pick<
    ExecutionContext,
    | 'chainList'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'publicClientList'
    | 'middlewareClient'
    | 'cache'
    | 'preparedExecution'
    | 'onProgress'
    | 'timing'
    | 'slippage'
  >;
  return { context, createSafeExecuteTx };
};

const metadata = (): SwapMetadata => ({
  src: [],
  dst: null,
  has_xcs: false,
  intent_request_hash: null,
});

const dstToken = {
  contractAddress: OUTPUT,
  decimals: 18,
  symbol: 'WETH',
};

describe('executeDestinationSwap contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    {
      label: 'a null resize',
      resized: null,
    },
    {
      label: 'an empty resize',
      resized: { tokenSwap: null, gasSwap: null },
    },
    {
      label: 'a resize that leaves settlement dust',
      resized: { tokenSwap: makeQuote(2_999_700_000n, { aggregator: null }), gasSwap: null },
    },
  ])('fails closed on $label without dispatching', async ({ resized }) => {
    const planned = makeQuote(3_000_000_000n, { aggregator: null });
    const destination = makeDestination(
      { tokenSwap: planned, gasSwap: null },
      vi.fn().mockResolvedValue(resized)
    );
    const { context, createSafeExecuteTx } = makeContext();

    await expect(
      executeDestinationSwap(
        destination,
        SwapMode.EXACT_IN,
        dstToken,
        context,
        metadata()
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.EXTERNAL_DESTINATION_SWAP_QUOTE_FAILED,
      context: expect.objectContaining({ stepType: 'destination_swap' }),
    });

    expect(createSafeExecuteTx).not.toHaveBeenCalled();
  });

  it('requires every originally planned leg when resizing Exact In', async () => {
    const tokenSwap = makeQuote(2_000_000_000n);
    const gasSwap = makeQuote(1_000_000_000n, {
      output: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
    const destination = makeDestination(
      { tokenSwap, gasSwap },
      vi.fn().mockResolvedValue({ tokenSwap: makeQuote(3_000_000_000n), gasSwap: null })
    );
    const { context } = makeContext();

    await expect(
      executeDestinationSwap(
        destination,
        SwapMode.EXACT_IN,
        dstToken,
        context,
        metadata()
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.EXTERNAL_DESTINATION_SWAP_QUOTE_FAILED,
    });
  });

  it('accepts a complete expired Exact Out requote', async () => {
    const expired = makeQuote(3_000_000_000n, {
      expiry: Math.floor(Date.now() / 1000) - 60,
    });
    const refreshed = makeQuote();
    const getDstSwap = vi
      .fn()
      .mockResolvedValue({ tokenSwap: refreshed, gasSwap: null });
    const destination = makeDestination(
      { tokenSwap: expired, gasSwap: null },
      getDstSwap
    );
    const { context } = makeContext();

    await executeDestinationSwap(
      destination,
      SwapMode.EXACT_OUT,
      dstToken,
      context,
      metadata()
    );

    expect(getDstSwap).toHaveBeenCalledWith(3_000_000_000n);
  });

  it('accepts a complete gas-only Exact Out requote', async () => {
    const expiredGas = makeQuote(3_000_000_000n, {
      output: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      expiry: Math.floor(Date.now() / 1000) - 60,
    });
    const refreshedGas = makeQuote(3_000_000_000n, {
      output: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
    const destination = makeDestination(
      { tokenSwap: null, gasSwap: expiredGas },
      vi.fn().mockResolvedValue({ tokenSwap: null, gasSwap: refreshedGas })
    );
    const { context } = makeContext();

    await executeDestinationSwap(
      destination,
      SwapMode.EXACT_OUT,
      dstToken,
      context,
      metadata()
    );

    expect(destination.getDstSwap).toHaveBeenCalledWith(3_000_000_000n);
  });

  it('excludes failed destination routers when requoting after dispatch failure', async () => {
    const relay = {} as Aggregator;
    const planned = makeQuote(3_000_000_000n, { aggregator: relay });
    planned.quote.routerId = 'uniswap-v3';
    const refreshed = makeQuote(3_000_000_000n, { aggregator: relay });
    refreshed.quote.routerId = 'odos';
    const getDstSwap = vi
      .fn()
      .mockResolvedValue({ tokenSwap: refreshed, gasSwap: null });
    const destination = makeDestination(
      { tokenSwap: planned, gasSwap: null },
      getDstSwap
    );
    const { context, createSafeExecuteTx } = makeContext();
    createSafeExecuteTx.mockRejectedValueOnce(new Error('router reverted'));

    await executeDestinationSwap(
      destination,
      SwapMode.EXACT_OUT,
      dstToken,
      context,
      metadata()
    );

    expect(getDstSwap).toHaveBeenCalledWith(
      3_000_000_000n,
      new Map([[relay, ['uniswap-v3']]])
    );
  });

  it('rejects a non-null Exact Out requote that drops a required leg', async () => {
    const expiredToken = makeQuote(2_000_000_000n, {
      expiry: Math.floor(Date.now() / 1000) - 60,
    });
    const gasSwap = makeQuote(1_000_000_000n, {
      output: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
    const destination = makeDestination(
      { tokenSwap: expiredToken, gasSwap },
      vi.fn().mockResolvedValue({ tokenSwap: makeQuote(3_000_000_000n), gasSwap: null })
    );
    const { context } = makeContext();

    await expect(
      executeDestinationSwap(
        destination,
        SwapMode.EXACT_OUT,
        dstToken,
        context,
        metadata()
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.EXTERNAL_DESTINATION_SWAP_QUOTE_FAILED,
      context: expect.objectContaining({ stepType: 'destination_swap' }),
    });
  });

  it('skips a provably empty output-token sweep', async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(3_000_000_000n)
      .mockResolvedValueOnce(0n);
    const quote = makeQuote();
    const destination = makeDestination(
      { tokenSwap: quote, gasSwap: null },
      vi.fn().mockResolvedValue({ tokenSwap: quote, gasSwap: null })
    );
    const { context } = makeContext(readContract);

    await executeDestinationSwap(
      destination,
      SwapMode.EXACT_OUT,
      dstToken,
      context,
      metadata()
    );

    expect(createSweeperTxs).not.toHaveBeenCalledWith(
      OUTPUT,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('stamps destination context onto a categorized error that lacks step metadata', async () => {
    const quote = makeQuote();
    const destination = makeDestination(
      { tokenSwap: quote, gasSwap: null },
      vi.fn().mockResolvedValue({ tokenSwap: quote, gasSwap: null })
    );
    const { context, createSafeExecuteTx } = makeContext();
    createSafeExecuteTx.mockRejectedValue(
      Errors.execution('wallet failed', { service: 'wallet' })
    );

    await expect(
      executeDestinationSwap(
        destination,
        SwapMode.EXACT_OUT,
        dstToken,
        context,
        metadata()
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.EXECUTION_ERROR,
      context: expect.objectContaining({
        chainId: CHAIN_ID,
        stepType: 'destination_swap',
      }),
    });
  });
});
