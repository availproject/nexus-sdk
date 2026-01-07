import { exit } from 'process';
import { executeOperation } from './operations/index.ts';
import { ethers } from 'ethers';
import { Wallet } from './wallet.ts';
import { Logger, stringifyError } from './logger.ts';
import { NexusSDK } from '@avail-project/nexus-core';
import { readAndParseConfigurationFile, selectProfile } from './configuration.ts';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createProvider(
  id: string,
  privateKey: string,
  chains: [number, string][]
): Promise<Wallet> {
  try {
    const wallet = new ethers.Wallet(privateKey, new ethers.InfuraProvider());
    const provider = new Wallet(wallet, chains);
    Logger.info(id, {
      message: 'Wallet and Id',
      walletAddress: wallet.address,
      id: id,
    });
    return provider;
  } catch (e: any) {
    const error = {
      message: 'Failed to initialize Wallet',
      reason: stringifyError(e),
    };
    Logger.error(id, error);
    throw new Error(error.message);
  }
}

async function initializeNexusSDK(id: string, network: any, provider: any): Promise<NexusSDK> {
  try {
    const sdk = new NexusSDK({ network: network });
    Logger.info(id, { message: 'Initializing SDK....' });
    await sdk.initialize(provider);
    return sdk;
  } catch (e: any) {
    const error = {
      message: 'Failed to initialize SDK',
      reason: stringifyError(e),
    };
    Logger.error(id, error);
    throw new Error(error.message);
  }
}

async function logBridgeBalances(id: string, sdk: NexusSDK) {
  try {
    const balances = await sdk.getBalancesForBridge();
    Logger.info(id, { message: 'Bridge Balances', data: balances });
  } catch (e: any) {
    const error = {
      message: 'Failed to fetch balances for bridge',
      reason: stringifyError(e),
    };
    Logger.error(id, error);
    throw new Error(error.message);
  }
}


async function main() {
  const config = readAndParseConfigurationFile();
  const profile = selectProfile(config);

  const provider = await createProvider(profile.id, profile.privateKey, config.chains);

  const network = profile.network ?? config.network;
  if (network == undefined) {
    Logger.error(profile.id, {
      message: `No network was set.`,
    });
    exit(1);
  }

  const sdk = await initializeNexusSDK(profile.id, network, provider);
  await logBridgeBalances(profile.id, sdk);

  Logger.info(profile.id, { message: 'SDK init done.' });
  let iteration = profile.count ?? Number.MAX_SAFE_INTEGER;

  // Main loop
  while (iteration > 0) {
    const success = await executeOperation(profile.id, profile.operation, profile, sdk);
    if (!success) {
      Logger.info(profile.id, { message: 'Sleeping for 60 seconds' });
      await sleep(60_000);
    }

    iteration -= 1;
  }

  Logger.info(profile.id, { message: 'Done' });
  console.log('Done');
  exit(0);
}

main();
