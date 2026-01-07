import {
  initializeNexus,
  isWalletAvailable,
  swapWithExactInCallback,
  getBalancesForSwap,
} from './nexus';
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

  let balances = await getBalancesForSwap(sdk);
  if (typeof balances == 'string') {
    errorScreen(balances);
    return;
  }

  mainScreen(balances, () => swapWithExactInCallback(sdk));
}

main();
