import { initializeNexus, getWallet, bridgeAndTransferCallback, NexusData, stringifyError } from './nexus';
import { errorScreen, loadingScreen, mainScreen } from './screens';

async function main() {
  loadingScreen();

  try {
    let provider = await getWallet();
    let sdk = await initializeNexus(provider);
    const data = await NexusData.fetch(sdk);
    mainScreen(data, () => bridgeAndTransferCallback(sdk));
  } catch(e: any) {
    errorScreen(stringifyError(e))
  }
}

main();
