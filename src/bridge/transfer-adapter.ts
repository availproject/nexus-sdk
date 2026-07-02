import { encodeFunctionData } from 'viem';
import { z } from 'zod';
import ERC20ABI from '../abi/erc20';
import type { BridgeAndExecuteParams, ChainListType, TransferParams, Tx } from '../domain';
import {
  addressString,
  nonNegativeBigint,
  parseInput,
  positiveInt,
} from '../domain/utils/validation';

const transferParamsSchema = z.object({
  toTokenSymbol: z.string().min(1),
  toAmountRaw: nonNegativeBigint,
  toChainId: positiveInt,
  recipient: addressString,
  sources: z.array(positiveInt).optional(),
});

const parseTransferParams = (input: TransferParams) => {
  return parseInput(transferParamsSchema, input);
};

const createBridgeAndTransferParams = (
  input: TransferParams,
  chainList: ChainListType
): BridgeAndExecuteParams => {
  const parsed = parseTransferParams(input);
  const { token, isNativeToken } = chainList.getChainAndTokenFromSymbol(
    parsed.toChainId,
    parsed.toTokenSymbol
  );

  const tx: Tx = isNativeToken
    ? {
        to: parsed.recipient,
        value: parsed.toAmountRaw,
        data: '0x',
        gas: 21_000n,
      }
    : {
        to: token.contractAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20ABI,
          functionName: 'transfer',
          args: [parsed.recipient, parsed.toAmountRaw],
        }),
        gas: 80_000n,
      };

  return {
    toChainId: parsed.toChainId,
    toAmountRaw: parsed.toAmountRaw,
    toTokenSymbol: parsed.toTokenSymbol,
    sources: parsed.sources,
    execute: tx,
  };
};

export { createBridgeAndTransferParams };
