import Decimal from 'decimal.js';
import { formatUnits } from 'viem';
import { ERROR_CODES, ValidationError } from '../domain/errors';
import { isNativeAddress } from '../services/addresses';
import { equalFold } from '../services/strings';
import type { FundingAmount, IntentBalance, IntentSource } from './types';

export const filterFundingBalances = (balances: IntentBalance[], sources?: IntentSource[]) => {
  if (!sources?.length) return balances;
  const selected = balances.filter((balance) =>
    sources.some(
      (source) =>
        source.chainId === balance.chainId &&
        (!source.tokenAddress ||
          equalFold(source.tokenAddress, balance.tokenAddress) ||
          (isNativeAddress(source.tokenAddress) && balance.isNative))
    )
  );
  if (!selected.length) {
    throw new ValidationError(
      ERROR_CODES.INSUFFICIENT_BALANCE,
      'No balances match the requested sources',
      { context: {} }
    );
  }
  return selected;
};

export const formatFundingAmount = (
  amountRaw: bigint,
  decimals: number,
  reference?: { amountRaw: bigint; valueUsd?: string | null }
): FundingAmount => ({
  amountRaw,
  amount: formatUnits(amountRaw, decimals),
  ...(reference?.valueUsd != null && reference.amountRaw > 0n
    ? {
        valueUsd: new Decimal(amountRaw.toString())
          .mul(reference.valueUsd)
          .div(reference.amountRaw.toString())
          .toFixed(),
      }
    : {}),
});

type IntentFundingInput = {
  outputIsNative: boolean;
  outputAmountRaw: bigint;
  outputBalanceRaw: bigint;
  executeValueRaw: bigint;
  estimatedGasCostRaw: bigint;
  nativeBalanceRaw: bigint;
};

type IntentFunding = {
  outputAmountRaw: bigint;
  gasDropRaw: bigint;
};

const shortfall = (required: bigint, available: bigint) =>
  required > available ? required - available : 0n;

export const calculateIntentFunding = (input: IntentFundingInput): IntentFunding => {
  if (input.outputIsNative) {
    return {
      outputAmountRaw: shortfall(
        input.outputAmountRaw + input.executeValueRaw + input.estimatedGasCostRaw,
        input.nativeBalanceRaw
      ),
      gasDropRaw: 0n,
    };
  }

  const outputAmountRaw = shortfall(input.outputAmountRaw, input.outputBalanceRaw);
  const gasDropRaw = shortfall(
    input.executeValueRaw + input.estimatedGasCostRaw,
    input.nativeBalanceRaw
  );
  return {
    outputAmountRaw: outputAmountRaw === 0n && gasDropRaw > 0n ? 1n : outputAmountRaw,
    gasDropRaw,
  };
};
