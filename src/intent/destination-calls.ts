import Decimal from 'decimal.js';
import { maxUint256 } from 'viem';
import { z } from 'zod';
import { Errors } from '../domain/errors';
import { addressString, hexString, parseInput } from '../domain/validation';
import type { ExecutableIntentQuote, IntentQuoteRequest } from './types';

const callsSchema = z
  .array(
    z.object({
      to: addressString,
      data: hexString.refine(
        (value) => value.length % 2 === 0,
        'call data must contain whole bytes'
      ),
      value: z.bigint().min(0n).max(maxUint256).default(0n),
    })
  )
  .min(1);

/** Build fixed destination calls before the order is reviewed and signed. */
export const quoteDestinationCalls = async (
  request: IntentQuoteRequest,
  getQuote: (request: IntentQuoteRequest) => Promise<ExecutableIntentQuote>,
  buildCalls: (context: {
    amountRaw: bigint;
    minimumAmountRaw: bigint;
  }) => Promise<z.input<typeof callsSchema>>
) => {
  const assertSupported = (executable: ExecutableIntentQuote) => {
    if (!executable.quote.supportsDestinationCalls) {
      throw Errors.invalidInput(
        'Selected route does not support provider destination execution; use a single funding leg or disable useProviderDestinationExecution'
      );
    }
  };
  const relayRequest: IntentQuoteRequest = { ...request, preferredProviders: ['relay'] };
  let amountRaw: bigint;
  let minimumAmountRaw: bigint;
  if (request.tradeType === 'exactOutput') {
    if (request.output.amount === undefined) {
      throw Errors.invalidInput('Exact-output destination calls require output.amount');
    }
    amountRaw = BigInt(request.output.amount);
    minimumAmountRaw = amountRaw;
  } else {
    const preview = await getQuote(relayRequest);
    assertSupported(preview);
    const minimum = preview.quote.output.minAmountRaw;
    minimumAmountRaw = minimum;
    const minimumUsd = new Decimal(preview.quote.output.minAmountUsd);
    if (minimum <= 0n || !minimumUsd.isFinite() || minimumUsd.lte(0)) {
      throw Errors.backend('Destination calls require a positive, priced minimum output');
    }
    // Hold back 1% of the guaranteed output, capped at $1 at the quote's valuation.
    const [usdNumerator, usdDenominator] = minimumUsd.toFraction();
    const usdCapRaw =
      (minimum * BigInt(usdDenominator.toFixed(0))) / BigInt(usdNumerator.toFixed(0));
    const percentBufferRaw = (minimum + 99n) / 100n;
    amountRaw = minimum - (percentBufferRaw < usdCapRaw ? percentBufferRaw : usdCapRaw);
    if (amountRaw <= 0n || amountRaw >= minimum) {
      throw Errors.backend('Destination-call reserve cannot fit the priced minimum output');
    }
  }
  const calls = parseInput(
    callsSchema,
    await buildCalls({
      amountRaw,
      minimumAmountRaw,
    })
  );
  const executable = await getQuote({
    ...relayRequest,
    destinationCalls: calls.map((call) => ({ ...call, value: call.value.toString() })),
  });
  assertSupported(executable);
  if (executable.quote.output.minAmountRaw < amountRaw) {
    throw Errors.backend('Final quote cannot fund the destination calls; refresh the quote', {
      service: 'middleware',
      details: { executionAmountRaw: amountRaw.toString() },
    });
  }
  return { executable, amountRaw };
};
