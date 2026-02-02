import { initializeNexus, getWallet, swapWithExactOutCallback, stringifyError } from './nexus';
import { errorScreen, loadingScreen, mainScreen } from './screens';

async function main() {
  loadingScreen();

  try {
    let provider = await getWallet();
    let sdk = await initializeNexus(provider);
    const data = await sdk.getBalancesForSwap()
    mainScreen(data, () => swapWithExactOutCallback(sdk));
  } catch(e: any) {
    errorScreen(stringifyError(e))
  }
}

main();
