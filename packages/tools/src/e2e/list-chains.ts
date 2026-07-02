import process from 'node:process';
import * as sdkCore from '../../../../src/core/sdk';
import type { NexusNetwork } from '../../../../src/domain/types';
import type { ChainInfo } from './chain-select';
import { runIfMain } from './cli-shim';

const getCreateNexusClient = () => {
  const mod = sdkCore as {
    createNexusClient?: unknown;
    default?: { createNexusClient?: unknown };
  };
  const fn = mod.createNexusClient ?? mod.default?.createNexusClient;
  if (typeof fn !== 'function') throw new Error('Failed to load createNexusClient from SDK.');
  return fn as typeof import('../../../../src/core/sdk').createNexusClient;
};

export const listSupportedChains = async (network: NexusNetwork): Promise<ChainInfo[]> => {
  const client = getCreateNexusClient()({ network, debug: false });
  try {
    await client.initialize();
    return client
      .getSupportedChains()
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((chain) => ({
        id: chain.id,
        name: chain.name,
        symbols: chain.tokens.map((t) => t.symbol),
      }));
  } finally {
    client.destroy();
  }
};

runIfMain(
  import.meta.url,
  async (args) => {
    const network = (args.network ?? 'testnet') as NexusNetwork;
    const chains = await listSupportedChains(network);
    // TSV (sorted by id): <id>\t<name>\t<symbol,symbol,...>
    const lines = chains.map((chain) => `${chain.id}\t${chain.name}\t${chain.symbols.join(',')}`);
    process.stdout.write(`${lines.join('\n')}\n`);
  },
  'list-chains error'
);
