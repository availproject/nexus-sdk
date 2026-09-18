import type { Hex } from 'viem';
import { z } from 'zod';
import { ARC_USDC_ERC20_INTERFACE, ZERO_ADDRESS } from '../domain/constants/addresses';
import {
  addressString,
  nonNegativeBigint,
  parseInput,
  positiveInt,
} from '../domain/utils/validation';
import type {
  SwapAndExecuteParams,
  SwapExactInParams,
  SwapExactOutParams,
  SwapMaxParams,
} from '../swap/types';

const sourceSchema = z.object({
  tokenAddress: addressString,
  chainId: positiveInt,
});

const exactInSourceSchema = sourceSchema.extend({
  amountRaw: nonNegativeBigint.optional(),
});

const swapExactInSchema = z.object({
  sources: z.array(exactInSourceSchema).optional(),
  toChainId: positiveInt,
  toTokenAddress: addressString,
});

const swapExactOutSchema = z.object({
  sources: z.array(sourceSchema).optional(),
  toChainId: positiveInt,
  toTokenAddress: addressString,
  toAmountRaw: nonNegativeBigint,
  toNativeAmountRaw: nonNegativeBigint.optional(),
});

const swapExecuteSchema = z.object({
  to: addressString,
  value: nonNegativeBigint.optional(),
  data: z.string().optional(),
  gas: nonNegativeBigint,
  gasPrice: z.enum(['low', 'medium', 'high']).optional(),
  tokenApproval: z
    .object({
      toTokenAddress: addressString,
      amount: nonNegativeBigint,
      spender: addressString,
    })
    .optional(),
});

const swapAndExecuteSchema = z.object({
  toChainId: positiveInt,
  toTokenAddress: addressString,
  toAmountRaw: nonNegativeBigint,
  sources: z.array(sourceSchema).optional(),
  execute: swapExecuteSchema,
});

const swapMaxSchema = z.object({
  toChainId: positiveInt,
  toTokenAddress: addressString,
  sources: z.array(sourceSchema).optional(),
});

const normalizeArcDestination = <
  T extends { toChainId: number; toTokenAddress: Hex; toAmountRaw?: bigint },
>(
  input: T
): T => {
  if (input.toChainId !== 5042 || input.toTokenAddress !== ARC_USDC_ERC20_INTERFACE) {
    return input;
  }

  return {
    ...input,
    toTokenAddress: ZERO_ADDRESS,
    // Arc's ERC-20 USDC interface uses 6 decimals; native USDC uses 18.
    ...(input.toAmountRaw === undefined ? {} : { toAmountRaw: input.toAmountRaw * 10n ** 12n }),
  };
};

export const validateSwapExactIn = (input: SwapExactInParams) => {
  parseInput(swapExactInSchema, input);
  return normalizeArcDestination(input);
};

export const validateSwapExactOut = (input: SwapExactOutParams) => {
  parseInput(swapExactOutSchema, input);
  return normalizeArcDestination(input);
};

export const validateSwapAndExecute = (input: SwapAndExecuteParams) => {
  parseInput(swapAndExecuteSchema, input);
  return normalizeArcDestination(input);
};

export const validateSwapMax = (input: SwapMaxParams) => {
  parseInput(swapMaxSchema, input);
  return normalizeArcDestination(input);
};
