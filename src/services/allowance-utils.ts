import type { PublicClient } from 'viem';
import ERC20ABI from '../abi/erc20';
import type { GetAllowanceParams } from '../domain';
import { ERROR_CODES, ExecutionError, formatUnknownError } from '../domain/errors';

const wrapExternal = async <T>(
  message: string,
  details: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    throw new ExecutionError(
      ERROR_CODES.EXEC_ERC20_ALLOWANCE_READ_FAILED,
      `${message}: ${formatUnknownError(error)}`,
      { context: { service: 'rpc' }, details }
    );
  }
};

export const erc20GetAllowance = (params: GetAllowanceParams, client: PublicClient) => {
  return wrapExternal(
    'Failed to read allowance',
    {
      contractAddress: params.contractAddress,
      owner: params.owner,
      spender: params.spender,
    },
    () =>
      client.readContract({
        address: params.contractAddress,
        abi: ERC20ABI,
        functionName: 'allowance',
        args: [params.owner, params.spender],
      })
  );
};
