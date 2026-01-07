import {
  NEXUS_EVENTS,
  NexusSDK,
  SUPPORTED_CHAINS,
  TOKEN_CONTRACT_ADDRESSES,
  type EthereumProvider,
  type ExactInSwapInput,
} from '@avail-project/nexus-core';
import { swapScreen, errorScreen, mainScreen } from './screens';

export const swapParams: ExactInSwapInput = {
  from: [
    {
      amount: 1_000_000_000n,
      chainId: SUPPORTED_CHAINS.ARBITRUM,
      tokenAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.ARBITRUM],
    },
  ],
  toTokenAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.ARBITRUM],
  toChainId: SUPPORTED_CHAINS.ARBITRUM,
};

export async function getWallet(): Promise<EthereumProvider> {
  const provider = (window as any).ethereum;
  if (provider == undefined) {
    throw new Error('No wallet provider is available to us. Install one (e.g. Metamask)');
  }

  return provider;
}

export async function initializeNexus(provider: EthereumProvider): Promise<NexusSDK> {
  const sdk = new NexusSDK({ network: 'mainnet' });
  await sdk.initialize(provider);
  return sdk;
}

export async function swapWithExactInCallback(sdk: NexusSDK) {
  try {
    await sdk.swapWithExactIn(swapParams, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.SWAP_STEP_COMPLETE) {
          console.log('Swap completed:', event.args);
          swapScreen(event.args);
        }
      },
    });

    const balances = await sdk.getBalancesForSwap();
    mainScreen(balances, () => swapWithExactInCallback(sdk));
  } catch (e: any) {
    errorScreen(stringifyError(e));
  }
}

export function stringifyError(err: any) {
  return JSON.stringify({
    message: err.message,
    stack: err.stack,
    name: err.name,
    ...err, // include extra enumerable fields
  });
}
