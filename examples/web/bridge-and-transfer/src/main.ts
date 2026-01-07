import { initializeNexus, isWalletAvailable, bridgeAndTransferCallback, NexusData } from './nexus';
import { errorScreen, loadingScreen, mainScreen } from './screens';

async function main() {
  loadingScreen();

  let provider = await isWalletAvailable();
  if (typeof provider == 'string') {
    errorScreen(provider);
    return;
  }

  let sdk = await initializeNexus(provider);
  if (typeof sdk == 'string') {
    errorScreen(sdk);
    return;
  }

  const data = await NexusData.fetch(sdk);
  if (typeof data == 'string') {
    errorScreen(data);
    return;
  }

  mainScreen(data, () => bridgeAndTransferCallback(sdk));
}

main();
