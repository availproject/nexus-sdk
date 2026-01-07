import {
  NEXUS_EVENTS,
  NexusSDK,
  SUPPORTED_CHAINS,
  type BridgeAndExecuteSimulationResult,
  type EthereumProvider,
  type TransferParams,
  type UserAssetDatum,
  type BridgeParams,
  type BridgeMaxResult,
} from '@avail-project/nexus-core';
import { bridgeScreen, errorScreen, mainScreen } from './screens';

export const transferParams: TransferParams = {
  token: 'USDC',
  amount: 100_000n,
  recipient: '0x198866cD002F9e5E2b49DE96d68EaE9d32aD0000',
  toChainId: SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
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
    const sdk = new NexusSDK({ network: 'testnet' });
    await sdk.initialize(provider);
    return sdk;
  } catch (e: any) {
    return 'Failed to initialize Nexus. Reason: ' + e.toString();
  }
}

export async function getBalancesForBridge(sdk: NexusSDK): Promise<UserAssetDatum[] | string> {
  try {
    return await sdk.getBalancesForBridge();
  } catch (e: any) {
    const error = 'Failed to fetch balances for bridge. Reason: ' + e.toString();
    return error;
  }
}

export async function calculateMaxForBridge(sdk: NexusSDK): Promise<BridgeMaxResult | string> {
  const params: BridgeParams = {
    token: transferParams.token,
    amount: transferParams.amount,
    toChainId: transferParams.toChainId,
    recipient: transferParams.recipient,
  };
  try {
    return await sdk.calculateMaxForBridge(params);
  } catch (e: any) {
    const error = 'Failed to calculate max for bridge. Reason: ' + e.toString();
    return error;
  }
}

export async function simulateBridgeAndTransfer(
  sdk: NexusSDK,
): Promise<BridgeAndExecuteSimulationResult | string> {
  try {
    return await sdk.simulateBridgeAndTransfer(transferParams);
  } catch (e: any) {
    const error = 'Failed to simulate bridge and transfer. Reason: ' + e.toString();
    return error;
  }
}

export async function bridgeAndTransferCallback(sdk: NexusSDK) {
  try {
    await sdk.bridgeAndTransfer(transferParams, {
      onEvent: (event) => {
        if (event.name === NEXUS_EVENTS.STEPS_LIST) console.log('Bridge steps:', event.args);
        if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
          console.log('Step completed:', event.args);
          bridgeScreen(event.args);
        }
      },
    });

    const data = await NexusData.fetch(sdk);
    if (typeof data == 'string') {
      errorScreen(data);
      return;
    }

    mainScreen(data, () => bridgeAndTransferCallback(sdk));
  } catch (e: any) {
    const error = 'Failed to run bridge and transfer. Reason: ' + e.toString();
    errorScreen(error);
  }
}

export class NexusData {
  balances: UserAssetDatum[];
  simulationResult: BridgeAndExecuteSimulationResult;
  bridgeMaxResult: BridgeMaxResult;
  constructor(
    balances: UserAssetDatum[],
    simulationResult: BridgeAndExecuteSimulationResult,
    bridgeMaxResult: BridgeMaxResult,
  ) {
    this.balances = balances;
    this.simulationResult = simulationResult;
    this.bridgeMaxResult = bridgeMaxResult;
  }

  static async fetch(sdk: NexusSDK): Promise<NexusData | string> {
    let balances = await getBalancesForBridge(sdk);
    if (typeof balances == 'string') {
      return balances;
    }

    let simulationResult = await simulateBridgeAndTransfer(sdk);
    if (typeof simulationResult == 'string') {
      return simulationResult;
    }

    let bridgeMaxResult = await calculateMaxForBridge(sdk);
    if (typeof bridgeMaxResult == 'string') {
      return bridgeMaxResult;
    }

    return new NexusData(balances, simulationResult, bridgeMaxResult);
  }
}
