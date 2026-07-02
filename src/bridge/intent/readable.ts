import Decimal from 'decimal.js';
import type { BridgeIntent, BridgeIntentDraft } from '../../domain';

const USD_VALUE_DECIMALS = 2;

const toReadableSource = (
  s: BridgeIntentDraft['selectedSources'][number]
): BridgeIntent['selectedSources'][number] => {
  return {
    amount: s.amount.toFixed(s.token.decimals),
    amountRaw: s.amountRaw,
    chain: s.chain,
    token: {
      decimals: s.token.decimals,
      symbol: s.token.symbol,
      logo: s.token.logo,
      contractAddress: s.token.contractAddress,
    },
    value: s.value.toFixed(USD_VALUE_DECIMALS),
    mayanQuote: s.mayanQuote,
  };
};

export const convertIntent = (intent: BridgeIntentDraft): BridgeIntent => {
  const selectedSources = [];
  let sourcesTotal = new Decimal(0);
  let sourcesTotalValue = new Decimal(0);
  for (const s of intent.selectedSources) {
    selectedSources.push(toReadableSource(s));
    sourcesTotal = sourcesTotal.plus(s.amount);
    sourcesTotalValue = sourcesTotalValue.plus(s.value);
  }

  const availableSources = intent.availableSources.map((s) => toReadableSource(s));
  const dstToken = intent.destination.token;
  const dstDecimals = dstToken.decimals;
  const caGas = new Decimal(intent.fees.caGas);
  const protocol = new Decimal(intent.fees.protocol);
  const solver = new Decimal(intent.fees.solver);

  return {
    provider: intent.provider,
    availableSources,
    destination: {
      amount: intent.destination.amount.toFixed(dstDecimals),
      amountRaw: intent.destination.amountRaw,
      chain: intent.destination.chain,
      token: {
        decimals: dstToken.decimals,
        symbol: dstToken.symbol,
        logo: dstToken.logo,
        contractAddress: dstToken.contractAddress,
      },
      value: intent.destination.value.toFixed(USD_VALUE_DECIMALS),
      nativeAmount: intent.destination.nativeAmount.toFixed(
        intent.destination.nativeToken.decimals
      ),
      nativeAmountRaw: intent.destination.nativeAmountRaw,
      nativeAmountValue: intent.destination.nativeAmountValue.toFixed(USD_VALUE_DECIMALS),
      nativeAmountInToken: intent.destination.nativeAmountInToken.toFixed(dstDecimals),
      nativeToken: {
        decimals: intent.destination.nativeToken.decimals,
        symbol: intent.destination.nativeToken.symbol,
        logo: intent.destination.nativeToken.logo,
        contractAddress: intent.destination.nativeToken.contractAddress,
      },
    },
    fees: {
      caGas: caGas.toFixed(dstDecimals),
      protocol: protocol.toFixed(dstDecimals),
      solver: solver.toFixed(dstDecimals),
      total: Decimal.sum(caGas, protocol, solver).toFixed(dstDecimals),
      totalValue: Decimal.max(sourcesTotalValue.minus(intent.destination.value), 0).toFixed(
        USD_VALUE_DECIMALS
      ),
    },
    selectedSources,
    sourcesTotal: sourcesTotal.toFixed(dstDecimals),
    sourcesTotalValue: sourcesTotalValue.toFixed(USD_VALUE_DECIMALS),
  };
};
