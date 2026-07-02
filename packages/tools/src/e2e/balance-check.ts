import fs from 'node:fs/promises';
import process from 'node:process';
import Decimal from 'decimal.js';
import * as sdkCore from '../../../../src/core/sdk';
import type { Chain, NexusNetwork, TokenBalance } from '../../../../src/domain/types';
import { normalizePrivateKey } from '../stress-test/private-key';
import { createPrivateKeyProvider } from '../stress-test/provider.node';
import { runIfMain } from './cli-shim';
import { formatTokenBalance } from './sdk-bridge';

export type SnapshotMode = 'before' | 'after';

export type Snapshot = {
  mode: SnapshotMode;
  capturedAt: string;
  network: NexusNetwork;
  token: string;
  unifiedBalance: string;
  decimals: number;
  perChain: Array<{ chainId: number; chainName: string; balance: string }>;
};

export type CaptureSnapshotParams = {
  mode: SnapshotMode;
  privateKey: `0x${string}`;
  network: NexusNetwork;
  token: string;
};

export type VerifyResult = {
  destinationChainId: number;
  expected: string;
  destDelta: string;
  totalDelta: string;
  ok: boolean;
};

const getCreateNexusClient = () => {
  const mod = sdkCore as {
    createNexusClient?: unknown;
    default?: { createNexusClient?: unknown };
  };
  const fn = mod.createNexusClient ?? mod.default?.createNexusClient;
  if (typeof fn !== 'function') throw new Error('Failed to load createNexusClient from SDK.');
  return fn as typeof import('../../../../src/core/sdk').createNexusClient;
};

export const captureSnapshot = async (params: CaptureSnapshotParams): Promise<Snapshot> => {
  const createNexusClient = getCreateNexusClient();
  const client = createNexusClient({ network: params.network, debug: false });
  try {
    await client.initialize();
    const { provider } = createPrivateKeyProvider({
      privateKey: params.privateKey,
      chains: client.chainList.chains as Chain[],
    });
    await client.setEVMProvider(provider);

    // Single unified-balance call (aggregates across all chains via middleware).
    const balances: TokenBalance[] = await client.getBalancesForBridge();
    // The SDK aggregates by currencyId, so symbol-variant pairs like USDC/USDC.e
    // collapse into one entry where `.symbol` is the most common variant
    // (usually USDC) and aliases survive in `.name` ("USDC/USDC.e") and in
    // per-chain `.chainBalances[].symbol`. Match all three so the canary works
    // when the test token is the minority variant on a single chain.
    const target = params.token.toUpperCase();
    const token = balances.find((b) => {
      if (b.symbol.toUpperCase() === target) return true;
      if (b.name.split('/').some((s) => s.trim().toUpperCase() === target)) return true;
      return b.chainBalances.some((cb) => cb.symbol.toUpperCase() === target);
    });
    if (!token) {
      throw new Error(`Token ${params.token} not present in unified balance result`);
    }
    return {
      mode: params.mode,
      capturedAt: new Date().toISOString(),
      network: params.network,
      token: params.token,
      unifiedBalance: token.balance,
      decimals: token.decimals,
      perChain: token.chainBalances.map((cb) => ({
        chainId: cb.chain.id,
        chainName: cb.chain.name,
        balance: cb.balance,
      })),
    };
  } finally {
    client.destroy();
  }
};

export type ChainAssetBalance = {
  chainId: number;
  chainName: string;
  token: string;
  balance: string;
  role: 'stable' | 'native';
};

// One-shot per-run balance snapshot for metrics: each chain holds two assets —
// a stablecoin (USDC, with USDC.e folded in by the SDK's currencyId aggregation)
// and its native gas token (POL/MON/cBTC/ETH/…). A single getBalancesForBridge
// call yields both, so we emit two points per chain (role 'stable' / 'native')
// without the per-test, per-token redundancy (no phantom ETH on non-ETH chains).
export const captureChainBalances = async (params: {
  privateKey: `0x${string}`;
  network: NexusNetwork;
}): Promise<ChainAssetBalance[]> => {
  const createNexusClient = getCreateNexusClient();
  const client = createNexusClient({ network: params.network, debug: false });
  try {
    await client.initialize();
    const chains = client.chainList.chains as Chain[];
    const { provider } = createPrivateKeyProvider({ privateKey: params.privateKey, chains });
    await client.setEVMProvider(provider);

    const balances: TokenBalance[] = await client.getBalancesForBridge();
    const bySymbol = new Map<string, TokenBalance>();
    for (const b of balances) bySymbol.set(b.symbol, b);

    // USDC entry (the SDK collapses USDC/USDC.e into one currencyId; match
    // symbol, the "USDC/USDC.e" name, or any per-chain variant).
    const usdc = balances.find(
      (b) =>
        b.symbol.toUpperCase() === 'USDC' ||
        b.name.split('/').some((s) => s.trim().toUpperCase() === 'USDC') ||
        b.chainBalances.some((cb) => cb.symbol.toUpperCase() === 'USDC')
    );
    const usdcByChain = new Map((usdc?.chainBalances ?? []).map((cb) => [cb.chain.id, cb.balance]));

    const out: ChainAssetBalance[] = [];
    for (const chain of chains) {
      const nativeSymbol = chain.nativeCurrency?.symbol;
      if (nativeSymbol) {
        const nativeBalance = bySymbol
          .get(nativeSymbol)
          ?.chainBalances.find((cb) => cb.chain.id === chain.id);
        out.push({
          chainId: chain.id,
          chainName: chain.name,
          token: nativeSymbol,
          balance: nativeBalance?.balance ?? '0',
          role: 'native',
        });
      }
      const usdcBalance = usdcByChain.get(chain.id);
      if (usdcBalance !== undefined) {
        out.push({
          chainId: chain.id,
          chainName: chain.name,
          token: 'USDC',
          balance: usdcBalance,
          role: 'stable',
        });
      }
    }
    return out;
  } finally {
    client.destroy();
  }
};

// Destination balance must have increased by at least ~half the requested
// amount (allowing for solver fees netted on the destination side). We don't
// constrain the unified total because native-token tests also pay gas on the
// source chain.
export const verify = (
  before: Snapshot,
  after: Snapshot,
  destinationChainId: number,
  amount: string
): VerifyResult => {
  const beforeChain = before.perChain.find((c) => c.chainId === destinationChainId);
  const afterChain = after.perChain.find((c) => c.chainId === destinationChainId);
  const destDelta = new Decimal(afterChain?.balance ?? 0).minus(
    new Decimal(beforeChain?.balance ?? 0)
  );
  const totalDelta = new Decimal(after.unifiedBalance).minus(new Decimal(before.unifiedBalance));
  const expected = new Decimal(amount);
  const ok = destDelta.gte(expected.times('0.5'));
  return {
    destinationChainId,
    expected: expected.toFixed(),
    destDelta: destDelta.toFixed(),
    totalDelta: totalDelta.toFixed(),
    ok,
  };
};

runIfMain(
  import.meta.url,
  async (args) => {
    const mode = args.mode as SnapshotMode;
    if (mode !== 'before' && mode !== 'after')
      throw new Error('--mode must be "before" or "after"');
    const snapshotPath = args.snapshot;
    if (!snapshotPath) throw new Error('--snapshot <path> is required');

    const privateKeyRaw = process.env.NEXUS_STRESS_PRIVATE_KEY;
    if (!privateKeyRaw) throw new Error('NEXUS_STRESS_PRIVATE_KEY is required');
    const privateKey = normalizePrivateKey(privateKeyRaw);
    if (!privateKey) throw new Error('Invalid NEXUS_STRESS_PRIVATE_KEY');

    const network = (args.network ?? 'testnet') as NexusNetwork;
    const token = args.token ?? 'USDC';

    if (mode === 'before') {
      const snap = await captureSnapshot({ mode, privateKey, network, token });
      await fs.writeFile(snapshotPath, JSON.stringify(snap, null, 2), 'utf8');
      process.stdout.write(
        `Balance (before) ${token}: unified=${formatTokenBalance(snap.unifiedBalance)} → ${snapshotPath}\n`
      );
      return;
    }

    const destinationChainId = Number(args['destination-chain-id']);
    if (!Number.isFinite(destinationChainId)) {
      throw new Error('--destination-chain-id is required in "after" mode');
    }
    const amount = args.amount ?? '0';
    const diffPath = args['diff-file'];

    const before = JSON.parse(await fs.readFile(snapshotPath, 'utf8')) as Snapshot;
    const after = await captureSnapshot({ mode, privateKey, network, token });
    const result = verify(before, after, destinationChainId, amount);
    const payload = { before, after, result };
    if (diffPath) await fs.writeFile(diffPath, JSON.stringify(payload, null, 2), 'utf8');

    process.stdout.write(
      `Balance check ${token}: dest ${destinationChainId} delta=${formatTokenBalance(result.destDelta)} (expected≈${formatTokenBalance(result.expected)}), unified delta=${formatTokenBalance(result.totalDelta)}, ok=${result.ok}\n`
    );
    // exit code 2 signals "balance not ok" distinct from script errors (1).
    if (!result.ok) process.exitCode = 2;
  },
  'balance-check error'
);
