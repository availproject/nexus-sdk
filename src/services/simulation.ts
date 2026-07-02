import { encodePacked, type Hex, keccak256, pad, toHex } from 'viem';
import { getLogger, ZERO_ADDRESS } from '../domain';
import { equalFold } from './strings';

const logger = getLogger();

const DEFAULT_SLOT = {
  ETH: 0,
  USDC: 9,
  USDT: 2,
} as const;

function getBalanceStorageSlot(token: string, chainId: number): number {
  logger.debug('balanceSlotDefaults', { chainId, token });
  return equalFold(token, 'USDC')
    ? DEFAULT_SLOT.USDC
    : equalFold(token, 'USDT')
      ? DEFAULT_SLOT.USDT
      : DEFAULT_SLOT.ETH;
}

const getBalanceSlot = ({
  tokenSymbol,
  chainId,
  userAddress,
  balanceSlot,
}: {
  tokenSymbol: string;
  chainId: number;
  userAddress: Hex;
  balanceSlot?: number;
}) => {
  const resolvedSlot = balanceSlot ?? getBalanceStorageSlot(tokenSymbol, chainId);

  const userBalanceSlot = keccak256(
    encodePacked(['bytes32', 'uint256'], [pad(userAddress, { size: 32 }), BigInt(resolvedSlot)])
  );

  logger.debug('getBalanceSlot', {
    tokenSymbol,
    chainId,
    userAddress,
    balanceSlot: userBalanceSlot,
  });

  return userBalanceSlot;
};

export const generateStateOverride = (params: {
  tokenSymbol: string;
  tokenAddress: Hex;
  chainId: number;
  userAddress: Hex;
  amount: bigint;
  balanceSlot?: number;
}) => {
  const amountInHex = toHex(params.amount * 2n);
  if (equalFold(params.tokenAddress, ZERO_ADDRESS)) {
    return {
      [params.userAddress]: {
        balance: amountInHex,
      },
    };
  }
  const balanceSlot = getBalanceSlot(params);

  return {
    [params.tokenAddress]: {
      storage: {
        [balanceSlot]: pad(amountInHex, { size: 32 }),
      },
    },
    [params.userAddress]: {
      balance: toHex(100000n),
    },
  };
};
