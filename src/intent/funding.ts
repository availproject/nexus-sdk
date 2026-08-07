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
