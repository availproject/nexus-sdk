import type { Aggregator } from '../../src/swap/aggregators/types';
import type { SwapPreflight } from '../../src/swap/preflight';
import type { OraclePriceResponse, WalletPath } from '../../src/swap/types';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  makeSwapChainList,
  makeSwapChainListWithUsdtCot,
} from './chains';
import { makePublicClientList } from './public-client';
import { makeDstTokenInfo } from './tokens';

export {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  makeSwapChainList,
  makeSwapChainListWithUsdtCot,
} from './chains';
export { makePublicClientList } from './public-client';
export {
  DAI,
  EPHEMERAL_EXECUTOR,
  USDC_ARB,
  USDC_BASE,
  USDC_OP,
  USDT_ARB,
  USDT_BASE,
  USDT_OP,
  WETH,
  makeDstTokenInfo,
} from './tokens';

export const makeSwapPreflight = (
  overrides?: Partial<SwapPreflight> & { walletPathHints?: Map<number, WalletPath> }
): SwapPreflight => ({
  aggregators: [] as Aggregator[],
  balances: [],
  dstTokenInfo: makeDstTokenInfo(),
  oraclePrices: [] as OraclePriceResponse,
  publicClientList: makePublicClientList(),
  walletPathHints:
    overrides?.walletPathHints ??
    new Map<number, WalletPath>([
      [ARB_CHAIN, 'ephemeral'],
      [BASE_CHAIN, 'ephemeral'],
      [OP_CHAIN, 'ephemeral'],
    ]),
  ...overrides,
});
