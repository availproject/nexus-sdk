import { z } from 'zod';
import type { BridgeParams, ChainListType } from '../domain';
import { Errors } from '../domain/errors';
import {
  addressString,
  nonNegativeBigint,
  parseInput,
  positiveInt,
} from '../domain/utils/validation';
import type { BridgeMaxParams } from './types';

const bridgeParamsSchema = z.object({
  recipient: addressString.optional(),
  toTokenSymbol: z.string().min(1),
  toAmountRaw: nonNegativeBigint,
  toChainId: positiveInt,
  toNativeAmountRaw: nonNegativeBigint.optional(),
  sources: z.array(positiveInt).optional(),
});

const bridgeMaxSchema = z.object({
  toChainId: positiveInt,
  toTokenSymbol: z.string().min(1),
  sources: z.array(positiveInt).optional(),
});

export const validateBridgeMax = (input: BridgeMaxParams) => parseInput(bridgeMaxSchema, input);

const parseBridgeParams = (input: BridgeParams) => {
  return parseInput(bridgeParamsSchema, input);
};

const createBridgeParams = (input: BridgeParams, chainList: ChainListType) => {
  const parsed = parseBridgeParams(input);

  if (parsed.toAmountRaw === 0n && (!parsed.toNativeAmountRaw || parsed.toNativeAmountRaw === 0n)) {
    throw Errors.invalidInput(`input.toAmountRaw & input.toNativeAmountRaw can't be 0`);
  }

  const { chain: dstChain, token: dstToken } = chainList.getChainAndTokenFromSymbol(
    parsed.toChainId,
    parsed.toTokenSymbol
  );
  if (!dstToken) {
    throw Errors.tokenNotFound(parsed.toTokenSymbol, parsed.toChainId);
  }

  const params = {
    tokenAmount: parsed.toAmountRaw,
    nativeAmount: parsed.toNativeAmountRaw ?? 0n,
    dstToken,
    dstChain,
    recipient: parsed.recipient,
    sourceChains: parsed.sources ?? [],
  };

  return params;
};

export { createBridgeParams };
