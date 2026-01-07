import { NEXUS_EVENTS, NexusSDK, type EthereumProvider } from '@avail-project/nexus-core';
import { Rust } from './glue/rust';

let gSDK: NexusSDK | null = null;
export async function isWalletAvailable(): Promise<EthereumProvider | string> {
  const provider = (window as any).ethereum;
  if (provider == undefined) {
    return 'No wallet provider is available to us. Install one (e.g. Metamask)';
  }

  return provider;
}

export async function initializeNexus() {
  try {
    const provider = await isWalletAvailable();
    if (typeof provider == 'string') {
      Rust.nexusInitializationFailed(provider);
      return;
    }

    const sdk = new NexusSDK({ network: 'testnet' });
    await sdk.initialize(provider);
    gSDK = sdk;
    Rust.nexusInitializationSucceed();
  } catch (e: any) {
    const reason = 'Failed to initialize Nexus. Reason: ' + e.toString();
    Rust.nexusInitializationFailed(reason);
  }
}

export async function bridge() {
  if (gSDK == null) {
    Rust.bridgingFailed('Nexus SDK was NOT initialized');
    return;
  }

  try {
    await gSDK.bridge(
      {
        token: 'USDC',
        amount: 1000n,
        recipient: '0x198866cD002F9e5E2b49DE96d68EaE9d32aD0000',
        toChainId: 421614,
      },
      {
        onEvent: (event) => {
          if (event.name === NEXUS_EVENTS.STEPS_LIST) console.log('Bridge steps:', event.args);
          if (event.name === NEXUS_EVENTS.STEP_COMPLETE) {
            let msg = 'Step completed: ' + event.args.type;
            Rust.bridgingStep(msg);
          }
        },
      },
    );
    Rust.bridgingSucceed();
  } catch (e: any) {
    const error = 'Failed to run bridge and transfer. Reason: ' + e.toString();
    Rust.bridgingFailed(error);
  }
}
