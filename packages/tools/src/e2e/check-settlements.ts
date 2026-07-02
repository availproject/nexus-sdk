import process from 'node:process';
import { type Chain, createPublicClient, fallback, getAddress, http, parseAbiItem } from 'viem';
import * as sdkCore from '../../../../src/core/sdk';
import type { NexusNetwork } from '../../../../src/domain/types';
import { runIfMain } from './cli-shim';

// SDK module is built as CJS; under packages/tools' ESM loader the named
// exports may land on `default`. Resolve once with a narrow type guard.
const { createNexusClient } =
  (sdkCore as typeof sdkCore & { default?: typeof sdkCore }).default ?? sdkCore;

const SETTLE_EVENT = parseAbiItem(
  'event Settle(uint256 indexed nonce, address[] solver, address[] token, uint256[] amount)'
);

// Approximate block time (seconds) per chain id; falls back to 12s.
const BLOCK_TIME_SEC: Record<number, number> = {
  1: 12,
  10: 2,
  137: 2,
  143: 1,
  4114: 2,
  8453: 2,
  42161: 0.25,
  11155111: 12,
  421614: 0.25,
  84532: 2,
  80002: 2,
  11155420: 2,
  10143: 1,
  5115: 2,
};

const CHUNK_BLOCKS = 1000;
const MAX_CHUNKS_PER_CHAIN = 60; // hard cap to bound RPC usage on fast chains

// Fallback RPCs tried in order. The SDK's default chain RPC is tried first
// (http() with no arg picks it up from the viem chain config); any URLs
// listed here are appended as backups via viem's fallback transport.
const RPC_FALLBACKS: Record<number, string[]> = {
  80002: [
    'https://polygon-amoy-public.nodies.app',
    'https://polygon-amoy.drpc.org',
    'https://rpc.ankr.com/polygon_amoy',
  ],
};

const makeTransport = (chainId: number) => {
  const backups = RPC_FALLBACKS[chainId] ?? [];
  const transports = [http(), ...backups.map((url) => http(url))];
  return transports.length > 1
    ? fallback(transports, { rank: false, retryCount: 0 })
    : transports[0];
};

type ChainMeta = { id: number; name: string };

export type ChainResult = {
  id: number;
  name: string;
  count: number;
  txHashes: string[];
  explorerTxBase: string;
  latestBlock?: number;
  error?: string;
};

export type SettlementResult = {
  passed: boolean;
  hours: number;
  totalSettles: number;
  chainsWithSettlements: number;
  perChain: ChainResult[];
};

const explorerTxBaseFor = (chain: Chain): string => {
  const base = chain.blockExplorers?.default?.url;
  return base ? `${base.replace(/\/$/, '')}/tx/` : '';
};

const checkChain = async (
  chain: Chain,
  meta: ChainMeta,
  vaultAddress: `0x${string}`,
  cutoffBlock: bigint
): Promise<ChainResult> => {
  const client = createPublicClient({ chain, transport: makeTransport(meta.id) });
  const explorerTxBase = explorerTxBaseFor(chain);
  const txHashes: string[] = [];

  try {
    const latest = await client.getBlockNumber();
    let toBlock = latest;
    let count = 0;
    let latestBlock: number | undefined;

    for (let chunks = 0; chunks < MAX_CHUNKS_PER_CHAIN; chunks += 1) {
      if (toBlock <= cutoffBlock) break;
      const fromBlock =
        toBlock - BigInt(CHUNK_BLOCKS) + 1n > cutoffBlock
          ? toBlock - BigInt(CHUNK_BLOCKS) + 1n
          : cutoffBlock + 1n;
      try {
        const logs = await client.getLogs({
          address: vaultAddress,
          fromBlock,
          toBlock,
          event: SETTLE_EVENT,
        });
        if (logs.length > 0) {
          count += logs.length;
          if (latestBlock === undefined) latestBlock = Number(logs[logs.length - 1].blockNumber);
          for (const log of logs) txHashes.push(log.transactionHash);
        }
      } catch (e) {
        // Some public RPCs cap getLogs ranges; fall through and stop scanning.
        return {
          id: meta.id,
          name: meta.name,
          count,
          txHashes,
          explorerTxBase,
          latestBlock,
          error: (e as Error).message.slice(0, 80),
        };
      }
      if (count > 0) break; // early exit — pass requires only one settle anywhere
      if (fromBlock <= cutoffBlock + 1n) break;
      toBlock = fromBlock - 1n;
    }

    return { id: meta.id, name: meta.name, count, txHashes, explorerTxBase, latestBlock };
  } catch (e) {
    return {
      id: meta.id,
      name: meta.name,
      count: 0,
      txHashes,
      explorerTxBase,
      error: (e as Error).message.slice(0, 80),
    };
  }
};

export const runSettlementCheck = async (
  network: NexusNetwork,
  hours: number
): Promise<SettlementResult> => {
  const lookbackSec = hours * 3600;

  const client = createNexusClient({ network, debug: false });
  try {
    await client.initialize();
    const supportedChains = client.getSupportedChains();
    const { chains, getVaultContractAddress } = client.chainList;

    const results: ChainResult[] = await Promise.all(
      supportedChains.map(async (meta) => {
        const blockSec = BLOCK_TIME_SEC[meta.id] ?? 12;
        const lookbackBlocks = BigInt(Math.ceil(lookbackSec / blockSec));
        const fullChain = chains.find((c) => c.id === meta.id);
        if (!fullChain) {
          return {
            id: meta.id,
            name: meta.name,
            count: 0,
            txHashes: [],
            explorerTxBase: '',
            error: 'chain not loaded',
          };
        }
        const probe = createPublicClient({
          chain: fullChain,
          transport: makeTransport(meta.id),
        });
        let latestNum: bigint;
        try {
          latestNum = await probe.getBlockNumber();
        } catch (e) {
          return {
            id: meta.id,
            name: meta.name,
            count: 0,
            txHashes: [],
            explorerTxBase: explorerTxBaseFor(fullChain),
            error: (e as Error).message.slice(0, 80),
          };
        }
        const cutoffBlock = latestNum > lookbackBlocks ? latestNum - lookbackBlocks : 0n;
        const vault = getAddress(getVaultContractAddress(meta.id).toLowerCase());
        return checkChain(fullChain, meta, vault, cutoffBlock);
      })
    );

    const totalSettles = results.reduce((s, r) => s + r.count, 0);
    const chainsWith = results.filter((r) => r.count > 0).length;
    return {
      passed: totalSettles > 0,
      hours,
      totalSettles,
      chainsWithSettlements: chainsWith,
      perChain: results,
    };
  } finally {
    client.destroy();
  }
};

runIfMain(
  import.meta.url,
  async (args) => {
    const network = (args.network ?? 'testnet') as NexusNetwork;
    const hours = Number(args.hours ?? '4');
    try {
      const result = await runSettlementCheck(network, hours);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (e) {
      // Preserve the original CLI contract: on failure, still emit a JSON
      // line on stdout so any caller parsing it gets a structured shape.
      // Re-throw so the shim writes the stderr message + sets exitCode = 1.
      const message = e instanceof Error ? e.message : String(e);
      process.stdout.write(`${JSON.stringify({ passed: false, error: message })}\n`);
      throw e;
    }
  },
  'check-settlements error'
);
