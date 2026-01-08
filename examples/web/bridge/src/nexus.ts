import {
  NEXUS_EVENTS,
  NexusSDK,
  SUPPORTED_CHAINS,
  type EthereumProvider,
  type UserAssetDatum,
  type BridgeParams,
  type BridgeMaxResult,
  type SimulationResult,
} from '@avail-project/nexus-core';
import { bridgeScreen, errorScreen, mainScreen } from './screens';

export const bridgeParams: BridgeParams = {
  token: 'USDC',
  amount: 1000000n,
  recipient: '0x198866cD002F9e5E2b49DE96d68EaE9d32aD0000',
  toChainId: SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
};

export async function getWallet(): Promise<EthereumProvider> {
  const provider = (window as any).ethereum;
  if (provider == undefined) {
    throw new Error('No wallet provider is available to us. Install one (e.g. Metamask)');
  }

  return provider;
}

export async function initializeNexus(provider: EthereumProvider): Promise<NexusSDK> {
  const sdk = new NexusSDK({ network: 'testnet' });
  await sdk.initialize(provider);
  return sdk;
}

export async function bridgeCallback(sdk: NexusSDK) {
  try {
    await sdk.bridge(bridgeParams, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.STEPS_LIST) console.log('Bridge steps:', event.args);
        if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
          console.log('Step completed:', event.args);
          bridgeScreen(event.args);
        }
      },
    });

    const data = await NexusData.fetch(sdk);
    mainScreen(data, () => bridgeCallback(sdk));
  } catch (e: any) {
    errorScreen(stringifyError(e));
  }
}

export class NexusData {
  balances: UserAssetDatum[];
  simulationResult: SimulationResult;
  bridgeMaxResult: BridgeMaxResult;
  constructor(
    balances: UserAssetDatum[],
    simulationResult: SimulationResult,
    bridgeMaxResult: BridgeMaxResult
  ) {
    this.balances = balances;
    this.simulationResult = simulationResult;
    this.bridgeMaxResult = bridgeMaxResult;
  }

  static async fetch(sdk: NexusSDK): Promise<NexusData> {
    let balances = await sdk.getBalancesForBridge();
    let simulationResult = await sdk.simulateBridge(bridgeParams);
    let bridgeMaxResult = await sdk.calculateMaxForBridge(bridgeParams);
    return new NexusData(balances, simulationResult, bridgeMaxResult);
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
