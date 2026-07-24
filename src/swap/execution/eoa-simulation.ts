import type { Hex, PublicClient } from 'viem';
import { ERROR_CODES, formatUnknownError, SimulationError } from '../../domain/errors';

export type EoaSimulationStep = {
  stepId: string;
  stepType: string;
  label: string;
};

export const simulateEoaTransaction = async (input: {
  publicClient: Pick<PublicClient, 'call'>;
  eoaAddress: Hex;
  chainId: number;
  transaction: {
    to: Hex;
    data: Hex;
    value: bigint;
  };
  step: EoaSimulationStep;
}): Promise<void> => {
  try {
    await input.publicClient.call({
      account: input.eoaAddress,
      to: input.transaction.to,
      data: input.transaction.data,
      value: input.transaction.value,
    });
  } catch (error) {
    throw new SimulationError(
      ERROR_CODES.SIMULATION_ETH_CALL_FAILED,
      `${input.step.label} simulation failed: ${formatUnknownError(error)}`,
      {
        context: {
          service: 'rpc',
          stepId: input.step.stepId,
          stepType: input.step.stepType,
          chainId: input.chainId,
        },
        details: {
          to: input.transaction.to,
          value: input.transaction.value.toString(),
        },
      }
    );
  }
};
