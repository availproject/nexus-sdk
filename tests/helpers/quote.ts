import type { Quote, QuoteResponse } from '../../src/swap/aggregators/types';

export type QuoteFixture = Omit<Quote, 'expectedOutput'> | Quote;

export type QuoteResponseFixtureOverrides = Omit<Partial<QuoteResponse>, 'quote'> & {
  quote?: QuoteFixture;
};

export const quoteFixture = (quote: QuoteFixture): Quote => ({
  ...quote,
  expectedOutput:
    'expectedOutput' in quote
      ? quote.expectedOutput
      : {
          amountRaw: quote.output.amountRaw,
          amount: quote.output.amount,
          value: quote.output.value,
        },
});

export const quoteResponseFixture = (
  base: Omit<QuoteResponse, 'quote'> & { quote: QuoteFixture },
  overrides?: QuoteResponseFixtureOverrides
): QuoteResponse => ({
  ...base,
  ...overrides,
  quote: quoteFixture(overrides?.quote ?? base.quote),
});
