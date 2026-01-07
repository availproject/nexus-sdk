import { exit } from 'process';
import { ethers } from 'ethers';
import { Wallet } from './wallet.ts';
import { NexusSDK } from '@avail-project/nexus-core';
import fs from 'fs';

export interface ConfigurationFile {
  privateKeys: string[];
  networks: any[];
  chains: [number, string][];
}

export function readAndParseConfigurationFile(): ConfigurationFile {
  const path = process.env.CONFIGURATION ?? './configuration.json';

  const file = fs.readFileSync(path, 'utf8');
  const conf = JSON.parse(file) as ConfigurationFile;

  return conf;
}

async function createProvider(
  privateKey: string,
  chains: [number, string][],
): Promise<Wallet> {
  const wallet = new ethers.Wallet(privateKey, new ethers.InfuraProvider());
  const provider = new Wallet(wallet, chains);
  return provider;
}

async function initializeNexusSDK(network: any, provider: any): Promise<NexusSDK> {
  const sdk = new NexusSDK({ network: network });
  await sdk.initialize(provider);
  return sdk;
}

async function main() {
  const config = readAndParseConfigurationFile();

  for (const pk of config.privateKeys) {
    const provider = await createProvider(pk, config.chains);
    console.log("Private Key:", pk, "Address:", provider.wallet.address)
    for (const network of config.networks) {
      const sdk = await initializeNexusSDK(network, provider);
      const balances = await sdk.getBalancesForBridge();
      for (const balance of balances) {
        if (balance.balance == "0") {
          continue
        }
        console.log("\tNetwork:", network, "Symbol:", balance.symbol, "Balance:", balance.balance)
        for (const bd of balance.breakdown) {
          if (bd.balance == "0") {
            continue
          }
          console.log("\t\t" + bd.chain.name, bd.balance)
        }
      }
    }
  }

  exit(0);
}

main();
