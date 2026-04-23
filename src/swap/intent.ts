import Decimal from 'decimal.js';
import { type ChainListType, type SwapData, type SwapIntent, SwapMode } from '../commons';
import { ZERO_ADDRESS } from '../core/constants';
import { Errors } from '../core/errors';
import { convertTo32BytesHex, divDecimals, equalFold } from '../core/utils';
import type { SwapRoute } from './route';

export const createSwapIntent = (
  route: SwapRoute,
  input: SwapData,
  chainList: ChainListType
): SwapIntent => {
  const { destination, extras, buffer, bridge, dstTokenInfo } = route;

  const dstChain = chainList.getChainByID(input.data.toChainId);
  if (!dstChain) throw Errors.chainNotFound(input.data.toChainId);

  // Destination token amount
  const dstAmount =
    input.mode === SwapMode.EXACT_OUT
      ? divDecimals(input.data.toAmount, dstTokenInfo.decimals).toFixed()
      : (destination.swap.tokenSwap?.quote.output.amount ?? destination.inputAmount.min.toFixed());

  // Destination USD value — COT input to the token swap is the USDC cost.
  // If there's no token swap the destination token is already COT (USDC), so amount ≈ USD.
  const dstValue = destination.swap.tokenSwap
    ? destination.swap.tokenSwap.quote.input.amount
    : dstAmount;

  const gasAmount = destination.swap.gasSwap?.quote?.output.amount ?? '0';
  const gasValue = destination.swap.gasSwap?.quote?.input.amount ?? '0';

  // Bridge fees
  let totalBridgeFee = new Decimal(0);
  if (bridge?.estimatedFees) {
    totalBridgeFee = Decimal.sum(
      bridge.estimatedFees.caGas,
      bridge.estimatedFees.solver,
      bridge.estimatedFees.protocol
    );
  }

  const intent: SwapIntent = {
    destination: {
      amount: dstAmount,
      value: dstValue,
      chain: { id: dstChain.id, logo: dstChain.custom.icon, name: dstChain.name },
      token: {
        contractAddress: input.data.toTokenAddress,
        decimals: dstTokenInfo.decimals,
        symbol: dstTokenInfo.symbol,
      },
      gas: {
        amount: gasAmount,
        value: gasValue,
        token: {
          contractAddress: ZERO_ADDRESS,
          decimals: dstChain.nativeCurrency.decimals,
          symbol: dstChain.nativeCurrency.symbol,
        },
      },
    },
    feesAndBuffer: {
      buffer: buffer.amount,
      bridge: bridge?.estimatedFees
        ? { ...bridge.estimatedFees, total: totalBridgeFee.toFixed() }
        : null,
    },
    sources: extras.assetsUsed.map((source) => {
      const sourceChain = chainList.getChainByID(source.chainID);
      if (!sourceChain) throw Errors.chainNotFound(source.chainID);

      // FlatBalance.tokenAddress is 32-byte hex; assetsUsed.contractAddress is 20-byte.
      const normalized = convertTo32BytesHex(source.contractAddress);
      const balance = extras.balances.find(
        (b) => b.chainID === source.chainID && equalFold(b.tokenAddress, normalized)
      );
      const value =
        balance && Number.parseFloat(balance.amount) > 0
          ? new Decimal(source.amount).div(balance.amount).mul(balance.value).toFixed()
          : '0';

      return {
        amount: source.amount,
        value,
        chain: { id: sourceChain.id, logo: sourceChain.custom.icon, name: sourceChain.name },
        token: {
          contractAddress: source.contractAddress,
          decimals: source.decimals,
          symbol: source.symbol,
        },
      };
    }),
  };

  return intent;
};
