import { z } from 'zod';
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

export const validateSwapExactIn = (input: SwapExactInParams) =>
  parseInput(swapExactInSchema, input);

export const validateSwapExactOut = (input: SwapExactOutParams) =>
  parseInput(swapExactOutSchema, input);

export const validateSwapAndExecute = (input: SwapAndExecuteParams) =>
  parseInput(swapAndExecuteSchema, input);

export const validateSwapMax = (input: SwapMaxParams) => parseInput(swapMaxSchema, input);
