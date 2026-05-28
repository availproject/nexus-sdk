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

  // Destination token amount. Prefer the aggregator's quoted output — it's the guaranteed
  // floor (on-chain actual ≥ quote), so for EXACT_OUT it's ≥ the user-requested toAmount
  // and reflects what the user will actually receive. Fallback applies when there's no
  // tokenSwap: EXACT_OUT direct COT transfer or sentinel toAmount (-1n exact, <-1n surplus)
  // shows the user-requested amount (clamped to 0n for sentinels, matching gas side);
  // EXACT_IN with no swap means dst token IS COT, so the COT input amount is the output.
  const dstAmount =
    destination.swap.tokenSwap?.quote.output.amount ??
    (input.mode === SwapMode.EXACT_OUT
      ? divDecimals(
          input.data.toAmount > 0n ? input.data.toAmount : 0n,
          dstTokenInfo.decimals
        ).toFixed()
      : destination.inputAmount.min.toFixed());

  // Destination USD value — the aggregator's quote carries an explicit USD `value` for both
  // sides; use the output's value since it pairs with the output amount shown above. Fallback
  // when there's no tokenSwap: the destination token is already COT (USDC), so amount ≈ USD.
  const dstValue = destination.swap.tokenSwap
    ? destination.swap.tokenSwap.quote.output.value.toString()
    : dstAmount;

  const gasAmount = destination.swap.gasSwap?.quote?.output.amount ?? '0';
  const gasValue = destination.swap.gasSwap?.quote?.output.value?.toString() ?? '0';

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
