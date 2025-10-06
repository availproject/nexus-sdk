import { RequestHandlerInput } from '@nexus/commons';
import { getTokenTxFunction } from '../../utils';

const isERC20TokenTransfer = (input: RequestHandlerInput) => {
  if (input.evm.tx) {
    const { data, to } = input.evm.tx;
    if (!data) {
      return false;
    }
    const token = input.chainList.getTokenByAddress(input.chain.id, to);
    const isTokenSupported = !!token;
    if (isTokenSupported && data) {
      const { functionName } = getTokenTxFunction(data as `0x${string}`);
      if (functionName === 'transfer') {
        return true;
      }
    }
  }
  return false;
};

const isNativeTokenTransfer = (input: RequestHandlerInput) => {
  if (input.evm.tx) {
    const { value } = input.evm.tx;
    if (!value) return false;
    try {
      return BigInt(value) > 0n;
    } catch {
      return false;
    }
  }
  return false;
};

export { isERC20TokenTransfer, isNativeTokenTransfer };
