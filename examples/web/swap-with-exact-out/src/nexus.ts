import {
  NEXUS_EVENTS,
  NexusSDK,
  SUPPORTED_CHAINS,
  TOKEN_CONTRACT_ADDRESSES,
  type EthereumProvider,
  type ExactOutSwapInput,
  type UserAssetDatum,
} from '@avail-project/nexus-core';
import { swapScreen, errorScreen, mainScreen } from './screens';

export const swapParams: ExactOutSwapInput = {
  toAmount: 100_000n,
  toTokenAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.ARBITRUM],
  toChainId: SUPPORTED_CHAINS.ARBITRUM,
};

export async function isWalletAvailable(): Promise<EthereumProvider | string> {
  const provider = (window as any).ethereum;
  if (provider == undefined) {
    return 'No wallet provider is available to us. Install one (e.g. Metamask)';
  }

  return provider;
}

export async function initializeNexus(provider: EthereumProvider): Promise<NexusSDK | string> {
  try {
    const sdk = new NexusSDK({ network: 'mainnet' });
    await sdk.initialize(provider);
    return sdk;
  } catch (e: any) {
    return 'Failed to initialize Nexus. Reason: ' + e.toString();
  }
}

export async function getBalancesForSwap(sdk: NexusSDK): Promise<UserAssetDatum[] | string> {
  try {
    return await sdk.getBalancesForSwap();
  } catch (e: any) {
    const error = 'Failed to fetch balances for swap. Reason: ' + e.toString();
    return error;
  }
}

export async function swapWithExactOutCallback(sdk: NexusSDK) {
  try {
    await sdk.swapWithExactOut(swapParams, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.SWAP_STEP_COMPLETE) {
          console.log('Swap completed:', event.args);
          swapScreen(event.args);
        }
      },
    });

    const balances = await getBalancesForSwap(sdk);
    if (typeof balances == 'string') {
      errorScreen(balances);
      return;
    }

    mainScreen(balances, () => swapWithExactOutCallback(sdk));
  } catch (e: any) {
    const error = 'Failed to run swap with exact out. Reason: ' + e.toString();
    errorScreen(error);
  }
}
