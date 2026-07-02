import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';
import * as p from '@clack/prompts';
import { z } from 'zod';
import * as sdkCore from '../../../../src/core/sdk';
import type { Chain, NexusNetwork } from '../../../../src/domain/types';
import {
  applyChainRpcOverrides,
  assertCastAvailable,
  generateAndFundDevnetAccount,
  type StressNetworkConfig,
  type StressNetworkHint,
} from './devnet-runtime';
import {
  applyBridgeStepUpdate,
  applyStatusUpdate,
  buildReport,
  type Operation,
  type OperationStatus,
  runStressTest,
  type StressRunConfig,
} from './index';
import { normalizePrivateKey } from './private-key';
import { createPrivateKeyProvider } from './provider.node';
import { startTui, type TuiHandle } from './tui/index';
import {
  resolveTuiTheme,
  setActiveTuiThemeByName,
  TUI_THEME_NAMES,
  type TuiThemeName,
} from './tui/theme';
import type { TuiEventLogItem } from './tui/types';

type RawArgs = {
  command: 'run' | 'wizard' | 'help';
  flags: Record<string, string | boolean>;
};

type SupportedChain = {
  id: number;
  name: string;
  tokens: { symbol: string }[];
};

type ResolvedCliConfig = {
  privateKey?: `0x${string}`;
  privateKeySourceLabel: string;
  network: NexusNetwork | StressNetworkConfig;
  chainRpcOverrides?: Record<string, string>;
  networkSourceLabel: string;
  token: string;
  amount: string;
  destinations: number[] | 'all';
  runConfig: StressRunConfig;
  reportFile?: string;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  dryRun: boolean;
  noTui: boolean;
  theme: TuiThemeName;
};

const getCreateNexusClient = () => {
  const mod = sdkCore as {
    createNexusClient?: unknown;
    default?: { createNexusClient?: unknown };
  };
  const fn = mod.createNexusClient ?? mod.default?.createNexusClient;
  if (typeof fn !== 'function') {
    throw new Error('Failed to load createNexusClient from src/core/sdk at runtime.');
  }
  return fn as typeof import('../../../../src/core/sdk').createNexusClient;
};

const HELP_TEXT = `Usage
  npm run stress -- <command> [options]

Commands
  run       Run stress test (prompts for missing required inputs)
  wizard    Interactive configuration wizard
  help      Show help

Common options
  --private-key <hex>                Private key hex (0x...)
  --private-key-file <path>          File containing private key hex
  --private-key-env <ENV>            Env var name containing private key hex (default: NEXUS_STRESS_PRIVATE_KEY)
  --token <symbol>                   Token symbol (e.g. USDC)
  --amount <readable>                Readable token amount (e.g. 1.5)
  --destinations <ids>               Comma-separated destination chain IDs
  --load-model <batch|fixed|ramp|soak>
  --total-requests <n>
  --report-file <path>               Write JSON report to file
  --json                             Print JSON result
  --no-tui                           Disable TUI status view
  --plain                            Alias for --no-tui
  --theme <name>                     TUI theme (${TUI_THEME_NAMES.join('|')})
  --verbose                          More logs
  --quiet                            Minimal logs
  --dry-run                          Validate and print resolved config without executing

Network options (choose one; defaults to --network testnet)
  --network <testnet|mainnet|canary> (use network config for devnet)
  --network-config-file <path>
  --network-config-json <json>
  --network-config-env <ENV>

Load-model options
  Batch: --batch-size <n> --delay-ms <n>
  Fixed: --rate-per-second <n> [--max-in-flight <n>]
  Ramp:  --start-rate <n> --step-rate <n> --step-duration-sec <n> --max-rate <n> [--max-in-flight <n>]
  Soak:  --rate-per-second <n> --duration-minutes <n> [--max-in-flight <n>]

Examples
  npm run stress -- wizard
  # Wizard: select File as key source — prompts for path, creates file with hidden input if missing
  npm run stress -- run --private-key-file .secrets/stress.key --network testnet --token USDC --amount 1 --destinations 421614 --load-model batch --total-requests 10 --batch-size 2 --delay-ms 500
  npm run stress -- run --private-key-env NEXUS_STRESS_PRIVATE_KEY --network testnet --token USDC --amount 1 --destinations 421614 --load-model batch --total-requests 10 --batch-size 2 --delay-ms 500
  npm run stress -- run --network-config-file ./local.json --token USDC --amount 1 --destinations all --load-model batch --total-requests 10 --batch-size 2 --delay-ms 500
  # devnet: omit private key for auto-generated funded account (requires cast)
`;

const networkConfigSchema = z.object({
  MIDDLEWARE_HTTP_URL: z.string().min(1),
  MIDDLEWARE_WS_URL: z.string().min(1),
  INTENT_EXPLORER_URL: z.string().min(1),
  NETWORK_HINT: z.enum(['testnet', 'mainnet', 'canary', 'devnet']),
  CHAIN_RPC_OVERRIDES: z.record(z.string().regex(/^\d+$/), z.string().url()).optional(),
});

const parsedInputSchema = z.object({
  privateKey: z.custom<`0x${string}`>().optional(),
  network: z.union([z.enum(['testnet', 'mainnet', 'canary']), networkConfigSchema]) as z.ZodType<
    NexusNetwork | StressNetworkConfig
  >,
  networkSourceLabel: z.string(),
  token: z.string().min(1),
  amount: z.string().min(1),
  destinations: z.union([z.array(z.number().int().positive()).min(1), z.literal('all')]),
  loadModel: z.enum(['batch', 'fixed', 'ramp', 'soak']),
  totalRequests: z.number().int().positive(),
  batchSize: z.number().optional(),
  delayMs: z.number().optional(),
  ratePerSecond: z.number().optional(),
  maxInFlight: z.number().int().positive().optional(),
  startRate: z.number().optional(),
  stepRate: z.number().optional(),
  stepDurationSec: z.number().optional(),
  maxRate: z.number().optional(),
  durationMinutes: z.number().optional(),
  reportFile: z.string().optional(),
  json: z.boolean().default(false),
  verbose: z.boolean().default(false),
  quiet: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  noTui: z.boolean().default(false),
  theme: z.string().default('lipgloss-charm'),
});

const numberFromFlag = (value: string | boolean | undefined) => {
  if (typeof value !== 'string') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const parseArgv = (argv: string[]): RawArgs => {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }

  const commandRaw = positional[0] ?? (flags.help ? 'help' : 'run');
  const command =
    commandRaw === 'wizard' || commandRaw === 'run' || commandRaw === 'help' ? commandRaw : 'help';
  return { command, flags };
};

const parseDestinations = (value: string): number[] | 'all' => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  return value
    .split(',')
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0);
};

const resolveNetwork = async (flags: Record<string, string | boolean>) => {
  const network = typeof flags.network === 'string' ? flags.network : undefined;
  const file =
    typeof flags['network-config-file'] === 'string' ? flags['network-config-file'] : undefined;
  const json =
    typeof flags['network-config-json'] === 'string' ? flags['network-config-json'] : undefined;
  const envName =
    typeof flags['network-config-env'] === 'string' ? flags['network-config-env'] : undefined;
  const sources = [network, file, json, envName].filter(Boolean);
  if (sources.length > 1) {
    throw new Error(
      'Choose only one network option: --network, --network-config-file, --network-config-json, or --network-config-env.'
    );
  }

  if (!network && !file && !json && !envName) {
    return { network: 'testnet' as NexusNetwork, label: 'preset:testnet' };
  }
  if (network) {
    if (network !== 'testnet' && network !== 'mainnet' && network !== 'canary') {
      throw new Error(
        `Unsupported --network preset "${network}". Use testnet, mainnet, or canary.`
      );
    }
    return { network: network as NexusNetwork, label: `preset:${network}` };
  }
  if (file) {
    const content = await fs.readFile(file, 'utf8');
    const parsed = networkConfigSchema.parse(JSON.parse(content));
    return { network: parsed as StressNetworkConfig, label: `file:${file}` };
  }
  if (json) {
    const parsed = networkConfigSchema.parse(JSON.parse(json));
    return { network: parsed as StressNetworkConfig, label: 'json:inline' };
  }
  if (!envName) {
    throw new Error('Internal error resolving network configuration.');
  }
  const value = process.env[envName];
  if (!value) throw new Error(`Environment variable ${envName} is empty or not set.`);
  const parsed = networkConfigSchema.parse(JSON.parse(value));
  return { network: parsed as StressNetworkConfig, label: `env:${envName}` };
};

const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

// ── Splash screen ─────────────────────────────────────────────────────────────
// Inline truecolor + dim helpers — no extra library needed.
const _tc = (hex: string, bold = false) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return (t: string) => `\x1B[${bold ? '1;' : ''}38;2;${r};${g};${b}m${t}\x1B[0m`;
};
const _dim = (t: string) => `\x1B[2m${t}\x1B[0m`;

const ASCII_ART = `\
▄▄▄    ▄▄▄                            ▄▄▄▄▄▄▄                                 ▄▄▄▄▄▄▄▄▄
████▄  ███                           █████▀▀▀  ██                             ▀▀▀███▀▀▀           ██   
███▀██▄███ ▄█▀█▄ ██ ██ ██ ██ ▄█▀▀▀    ▀████▄  ▀██▀▀ ████▄ ▄█▀█▄ ▄█▀▀▀ ▄█▀▀▀      ███ ▄█▀█▄ ▄█▀▀▀ ▀██▀▀ 
███  ▀████ ██▄█▀  ███  ██ ██ ▀███▄      ▀████  ██   ██ ▀▀ ██▄█▀ ▀███▄ ▀███▄      ███ ██▄█▀ ▀███▄  ██   
███    ███ ▀█▄▄▄ ██ ██ ▀██▀█ ▄▄▄█▀   ███████▀  ██   ██    ▀█▄▄▄ ▄▄▄█▀ ▄▄▄█▀      ███ ▀█▄▄▄ ▄▄▄█▀  ██`;

const showSplash = (titleColor: string, accentColor: string) => {
  process.stdout.write('\x1B[2J\x1B[H'); // clear screen, cursor to top-left
  process.stdout.write('\n\n');
  process.stdout.write(`${_tc(titleColor, true)(ASCII_ART)}\n`);
  process.stdout.write('\n');
  process.stdout.write(`${_dim('  nexus v2 protocol  ·  stress testing tool')}\n`);
  process.stdout.write(_tc(accentColor)('  ──────────────────────────────────────\n'));
  process.stdout.write('\n');
};

const cancel = (msg = 'Cancelled.') => {
  p.cancel(msg);
  process.exit(0);
};
const ask = async <T>(prompt: Promise<T | symbol>): Promise<T> => {
  const v = await prompt;
  if (p.isCancel(v)) cancel();
  return v as T;
};

const maybePromptForMissing = async (raw: RawArgs): Promise<Record<string, string | boolean>> => {
  const flags = { ...raw.flags };
  if (raw.command !== 'wizard' && raw.command !== 'run') return flags;

  const needsPrompt =
    raw.command === 'wizard' ||
    !flags.token ||
    !flags.amount ||
    !flags['load-model'] ||
    !flags['total-requests'] ||
    !flags.destinations;

  if (!needsPrompt) return flags;
  if (!isInteractive()) {
    throw new Error('Missing required flags and no TTY available for interactive prompts.');
  }

  const theme = resolveTuiTheme(typeof raw.flags.theme === 'string' ? raw.flags.theme : undefined);
  showSplash(theme.title, theme.accent);

  const presetPrivateKeyEnv =
    typeof flags['private-key-env'] === 'string'
      ? flags['private-key-env']
      : 'NEXUS_STRESS_PRIVATE_KEY';

  // ── Network source ──────────────────────────────────────────────────────────
  if (
    !flags.network &&
    !flags['network-config-file'] &&
    !flags['network-config-json'] &&
    !flags['network-config-env']
  ) {
    const mode = await ask(
      p.select({
        message: 'Network source',
        options: [
          { value: 'preset', label: 'Preset', hint: 'testnet / mainnet / canary' },
          { value: 'file', label: 'File', hint: 'load from JSON file' },
          { value: 'json', label: 'Inline JSON', hint: 'paste config directly' },
          { value: 'env', label: 'Env var', hint: 'read from environment variable' },
        ],
      })
    );
    if (mode === 'file') {
      flags['network-config-file'] = await ask(
        p.text({ message: 'Path to network config JSON file' })
      );
    } else if (mode === 'json') {
      flags['network-config-json'] = await ask(
        p.text({ message: 'Paste network config JSON (single line)' })
      );
    } else if (mode === 'env') {
      flags['network-config-env'] = await ask(
        p.text({ message: 'Network config env var', defaultValue: 'NEXUS_NETWORK_CONFIG' })
      );
    } else {
      flags.network = await ask(
        p.select({
          message: 'Network preset',
          options: [
            { value: 'testnet', label: 'Testnet' },
            { value: 'mainnet', label: 'Mainnet' },
            { value: 'canary', label: 'Canary' },
          ],
        })
      );
    }
  }

  // ── Private key ─────────────────────────────────────────────────────────────
  if (!flags['private-key'] && !flags['private-key-file'] && !flags['private-key-env']) {
    const useEnvKey = process.env[presetPrivateKeyEnv]
      ? await ask(
          p.confirm({ message: `Use ${presetPrivateKeyEnv} for private key?`, initialValue: true })
        )
      : false;

    if (useEnvKey) {
      flags['private-key-env'] = presetPrivateKeyEnv;
    } else {
      const { network } = await resolveNetwork(flags);
      // getNetworkHint accepts NexusNetwork; StressNetworkConfig extends it in practice
      const networkHint = getNetworkHint(network as Parameters<typeof getNetworkHint>[0]);

      const source = await ask(
        p.select({
          message: 'Private key source',
          options: [
            { value: 'file', label: 'File path', hint: 'read key from local file' },
            { value: 'env', label: 'Environment variable', hint: 'read from env var name' },
            { value: 'manual', label: 'Manual entry', hint: 'type key in prompt' },
            ...(networkHint === 'devnet'
              ? [
                  {
                    value: 'auto',
                    label: 'Auto-generate (devnet)',
                    hint: 'generate + fund a fresh key',
                  },
                ]
              : []),
          ],
        })
      );

      if (source === 'file') {
        const filePath = await ask(
          p.text({
            message: 'Private key file path',
            placeholder: '.secrets/stress.key',
            validate: (v) => (v?.trim() ? undefined : 'Required'),
          })
        );
        const fileExists = await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false);
        if (!fileExists) {
          const keyValue = await ask(
            p.password({
              message: `File not found. Enter private key to save to ${filePath}`,
              validate: (v) => (v?.trim() ? undefined : 'Required'),
            })
          );
          const normalized = normalizePrivateKey(keyValue);
          if (!normalized) {
            throw new Error('Invalid private key. Expected 64-byte hex (0x...).');
          }
          await fs.mkdir(dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, normalized, { mode: 0o600 });
          p.log.success(`Key written to ${filePath}`);
        }
        flags['private-key-file'] = filePath;
      } else if (source === 'env') {
        flags['private-key-env'] = await ask(
          p.text({ message: 'Private key env var', defaultValue: presetPrivateKeyEnv })
        );
      } else if (source === 'manual') {
        flags['private-key'] = await ask(
          p.password({
            message: 'Private key',
            validate: (v) => (v?.trim() ? undefined : 'Required'),
          })
        );
      }
    }
  }

  // ── Token / amount / destinations ───────────────────────────────────────────
  if (!flags.token)
    flags.token = await ask(
      p.text({ message: 'Token symbol', defaultValue: 'USDC', placeholder: 'USDC' })
    );
  if (!flags.amount)
    flags.amount = await ask(
      p.text({ message: 'Amount (readable)', defaultValue: '1', placeholder: '1' })
    );
  if (!flags.destinations)
    flags.destinations = await ask(
      p.text({
        message: 'Destination chain IDs',
        defaultValue: 'all',
        placeholder: 'all  or  421614,11155111',
      })
    );

  // ── Load model ──────────────────────────────────────────────────────────────
  if (!flags['load-model']) {
    flags['load-model'] = await ask(
      p.select({
        message: 'Load model',
        options: [
          { value: 'batch', label: 'Batch', hint: 'send N ops, wait, repeat' },
          { value: 'fixed', label: 'Fixed', hint: 'constant rate per second' },
          { value: 'ramp', label: 'Ramp', hint: 'gradually increase rate' },
          { value: 'soak', label: 'Soak', hint: 'sustained load over time' },
        ],
      })
    );
  }
  if (!flags['total-requests'])
    flags['total-requests'] = await ask(
      p.text({ message: 'Total requests', defaultValue: '10', placeholder: '10' })
    );

  // ── Load-model-specific params ───────────────────────────────────────────────
  const loadModel = String(flags['load-model']);
  if (loadModel === 'batch') {
    if (!flags['batch-size'])
      flags['batch-size'] = await ask(
        p.text({ message: 'Batch size', defaultValue: '2', placeholder: '2' })
      );
    if (!flags['delay-ms'])
      flags['delay-ms'] = await ask(
        p.text({ message: 'Delay between batches (ms)', defaultValue: '500', placeholder: '500' })
      );
  } else if (loadModel === 'fixed') {
    if (!flags['rate-per-second'])
      flags['rate-per-second'] = await ask(
        p.text({ message: 'Rate per second', defaultValue: '2', placeholder: '2' })
      );
    if (!flags['max-in-flight'])
      flags['max-in-flight'] =
        (await ask(
          p.text({ message: 'Max in flight', placeholder: 'leave blank for unlimited' })
        )) || '';
  } else if (loadModel === 'ramp') {
    if (!flags['start-rate'])
      flags['start-rate'] = await ask(
        p.text({ message: 'Start rate', defaultValue: '1', placeholder: '1' })
      );
    if (!flags['step-rate'])
      flags['step-rate'] = await ask(
        p.text({ message: 'Step rate', defaultValue: '1', placeholder: '1' })
      );
    if (!flags['step-duration-sec'])
      flags['step-duration-sec'] = await ask(
        p.text({ message: 'Step duration (sec)', defaultValue: '30', placeholder: '30' })
      );
    if (!flags['max-rate'])
      flags['max-rate'] = await ask(
        p.text({ message: 'Max rate', defaultValue: '5', placeholder: '5' })
      );
    if (!flags['max-in-flight'])
      flags['max-in-flight'] =
        (await ask(
          p.text({ message: 'Max in flight', placeholder: 'leave blank for unlimited' })
        )) || '';
  } else if (loadModel === 'soak') {
    if (!flags['rate-per-second'])
      flags['rate-per-second'] = await ask(
        p.text({ message: 'Rate per second', defaultValue: '1', placeholder: '1' })
      );
    if (!flags['duration-minutes'])
      flags['duration-minutes'] = await ask(
        p.text({ message: 'Duration (minutes)', defaultValue: '5', placeholder: '5' })
      );
    if (!flags['max-in-flight'])
      flags['max-in-flight'] =
        (await ask(
          p.text({ message: 'Max in flight', placeholder: 'leave blank for unlimited' })
        )) || '';
  }

  // ── Report file + confirmation ───────────────────────────────────────────────
  if (!flags['report-file']) {
    const reportFile = await ask(
      p.text({ message: 'Report file path', placeholder: 'leave blank to skip' })
    );
    if (reportFile) flags['report-file'] = reportFile;
  }

  const confirmed = await ask(p.confirm({ message: 'Start run now?', initialValue: true }));
  if (!confirmed) flags['dry-run'] = true;

  p.outro(
    confirmed
      ? _tc(theme.success)('✓  Run starting…')
      : _tc(theme.warn)('⊘  Dry run — config printed below')
  );

  return flags;
};

const resolvePrivateKeyFromFlags = async (
  flags: Record<string, string | boolean>
): Promise<{ privateKey: `0x${string}` | null; sourceLabel: string | null }> => {
  const direct = typeof flags['private-key'] === 'string' ? flags['private-key'] : undefined;
  const filePath =
    typeof flags['private-key-file'] === 'string' ? flags['private-key-file'].trim() : undefined;
  const envFlagName =
    typeof flags['private-key-env'] === 'string' ? flags['private-key-env'].trim() : undefined;
  const privateKeySources = [Boolean(direct), Boolean(filePath), Boolean(envFlagName)].filter(
    Boolean
  ).length;
  if (privateKeySources > 1) {
    throw new Error(
      'Choose only one private key source: --private-key, --private-key-file, or --private-key-env.'
    );
  }
  const envName = envFlagName && envFlagName.length > 0 ? envFlagName : 'NEXUS_STRESS_PRIVATE_KEY';
  const envValue = !direct && !filePath ? process.env[envName] : undefined;
  if (envFlagName && !envValue) {
    throw new Error(
      `Env var "${envFlagName}" is not set. Export it before running, or choose a different key source.`
    );
  }
  let raw: string | undefined = direct ?? envValue;
  if (!raw && filePath) {
    try {
      const handle = await fs.open(filePath, 'r');
      try {
        const { size } = await handle.stat();
        if (size > 200) {
          throw new Error(
            `File is too large (${size} bytes) to be a private key — expected ≤200 bytes.`
          );
        }
        raw = (await handle.readFile('utf8')).trim();
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw new Error(
        `Failed to read private key file "${filePath}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (!raw) {
    return { privateKey: null, sourceLabel: null };
  }
  const normalized = normalizePrivateKey(raw);
  // raw is a local binding; setting to undefined drops this reference (JS strings are GC'd, not scrubbed).
  raw = undefined;
  if (!normalized) {
    if (filePath) {
      throw new Error(`Invalid private key in file "${filePath}". Expected 64-byte 0x hex key.`);
    }
    if (direct) {
      throw new Error('Invalid private key. Expected 64-byte 0x hex key.');
    }
    throw new Error(`Invalid private key. Set ${envName} to a 64-byte 0x hex key.`);
  }
  if (direct) {
    return { privateKey: normalized, sourceLabel: 'direct' };
  }
  if (filePath) {
    return { privateKey: normalized, sourceLabel: `file:${filePath}` };
  }
  return { privateKey: normalized, sourceLabel: `env:${envName}` };
};

const resolveRunConfig = (input: z.infer<typeof parsedInputSchema>): StressRunConfig => {
  const common = {
    token: input.token,
    amount: input.amount,
    totalRequests: input.totalRequests,
  } as const;

  switch (input.loadModel) {
    case 'batch': {
      if (!input.batchSize || input.batchSize <= 0) throw new Error('--batch-size must be > 0');
      return {
        ...common,
        loadModel: 'batch',
        batchSize: Math.floor(input.batchSize),
        delayMs: Math.max(0, Math.floor(input.delayMs ?? 0)),
      };
    }
    case 'fixed': {
      if (!input.ratePerSecond || input.ratePerSecond <= 0)
        throw new Error('--rate-per-second must be > 0');
      return {
        ...common,
        loadModel: 'fixed',
        ratePerSecond: input.ratePerSecond,
        maxInFlight: input.maxInFlight,
      };
    }
    case 'ramp': {
      if (!input.startRate || input.startRate <= 0) throw new Error('--start-rate must be > 0');
      if (!input.stepRate || input.stepRate <= 0) throw new Error('--step-rate must be > 0');
      if (!input.stepDurationSec || input.stepDurationSec <= 0)
        throw new Error('--step-duration-sec must be > 0');
      if (!input.maxRate || input.maxRate <= 0) throw new Error('--max-rate must be > 0');
      return {
        ...common,
        loadModel: 'ramp',
        startRate: input.startRate,
        stepRate: input.stepRate,
        stepDurationSec: input.stepDurationSec,
        maxRate: input.maxRate,
        maxInFlight: input.maxInFlight,
      };
    }
    case 'soak': {
      if (!input.ratePerSecond || input.ratePerSecond <= 0)
        throw new Error('--rate-per-second must be > 0');
      if (!input.durationMinutes || input.durationMinutes <= 0)
        throw new Error('--duration-minutes must be > 0');
      return {
        ...common,
        loadModel: 'soak',
        ratePerSecond: input.ratePerSecond,
        durationMinutes: input.durationMinutes,
        maxInFlight: input.maxInFlight,
      };
    }
  }
};

const coerceFlagsToConfig = async (
  flags: Record<string, string | boolean>
): Promise<ResolvedCliConfig> => {
  const privateKeyInput = await resolvePrivateKeyFromFlags(flags);
  const network = await resolveNetwork(flags);
  const input = parsedInputSchema.parse({
    privateKey: privateKeyInput.privateKey ?? undefined,
    network: network.network,
    networkSourceLabel: network.label,
    token: typeof flags.token === 'string' ? flags.token : '',
    amount: typeof flags.amount === 'string' ? flags.amount : '',
    destinations:
      typeof flags.destinations === 'string' ? parseDestinations(flags.destinations) : [],
    loadModel: typeof flags['load-model'] === 'string' ? flags['load-model'] : undefined,
    totalRequests: numberFromFlag(flags['total-requests']),
    batchSize: numberFromFlag(flags['batch-size']),
    delayMs: numberFromFlag(flags['delay-ms']),
    ratePerSecond: numberFromFlag(flags['rate-per-second']),
    maxInFlight: numberFromFlag(flags['max-in-flight']),
    startRate: numberFromFlag(flags['start-rate']),
    stepRate: numberFromFlag(flags['step-rate']),
    stepDurationSec: numberFromFlag(flags['step-duration-sec']),
    maxRate: numberFromFlag(flags['max-rate']),
    durationMinutes: numberFromFlag(flags['duration-minutes']),
    reportFile: typeof flags['report-file'] === 'string' ? flags['report-file'] : undefined,
    json: Boolean(flags.json),
    verbose: Boolean(flags.verbose),
    quiet: Boolean(flags.quiet),
    dryRun: Boolean(flags['dry-run']),
    noTui: Boolean(flags['no-tui'] || flags.plain),
    theme: typeof flags.theme === 'string' ? flags.theme : 'lipgloss-charm',
  });

  const chainRpcOverrides =
    typeof network.network === 'object' &&
    'CHAIN_RPC_OVERRIDES' in network.network &&
    network.network.CHAIN_RPC_OVERRIDES
      ? network.network.CHAIN_RPC_OVERRIDES
      : undefined;

  return {
    privateKey: privateKeyInput.privateKey ?? undefined,
    privateKeySourceLabel: privateKeyInput.sourceLabel ?? 'auto-generated on devnet',
    network: input.network,
    chainRpcOverrides,
    networkSourceLabel: input.networkSourceLabel,
    token: input.token,
    amount: input.amount,
    destinations: input.destinations,
    runConfig: resolveRunConfig(input),
    reportFile: input.reportFile,
    json: input.json,
    verbose: input.verbose,
    quiet: input.quiet,
    dryRun: input.dryRun,
    noTui: input.noTui,
    theme: (TUI_THEME_NAMES.includes(input.theme as TuiThemeName)
      ? input.theme
      : 'lipgloss-charm') as TuiThemeName,
  };
};

const getNetworkHint = (network: NexusNetwork | StressNetworkConfig): StressNetworkHint => {
  if (typeof network === 'string') {
    return network;
  }
  return (network as StressNetworkConfig).NETWORK_HINT;
};

const assertNetworkSupportsAutoFunding = (network: NexusNetwork | StressNetworkConfig) => {
  const hint = getNetworkHint(network);
  if (hint !== 'devnet') {
    throw new Error(
      'No private key provided. Auto-generation/funding is allowed only when NETWORK_HINT is "devnet".'
    );
  }
};

const assertCastCanUseRpc = (rpcUrl: string, chainId: number) => {
  const result = spawnSync('cast', ['rpc', '--rpc-url', rpcUrl, 'eth_chainId'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'RPC not reachable';
    throw new Error(`RPC preflight failed for chain ${chainId} (${rpcUrl}): ${detail}`);
  }
};

const preflightDevnetFunding = (
  network: NexusNetwork | StressNetworkConfig,
  chainRpcOverrides: Record<string, string> | undefined,
  chainIds: number[]
) => {
  assertNetworkSupportsAutoFunding(network);
  assertCastAvailable();
  for (const chainId of chainIds) {
    const rpcUrl = chainRpcOverrides?.[String(chainId)];
    if (rpcUrl) {
      assertCastCanUseRpc(rpcUrl, chainId);
    }
  }
};

const shouldUseTui = (cfg: ResolvedCliConfig) =>
  Boolean(process.stdout.isTTY && process.stdin.isTTY && !cfg.noTui && !cfg.json && !cfg.quiet);

const log = (enabled: boolean, message: string) => {
  if (enabled) process.stdout.write(`${message}\n`);
};

// ── No-TUI event streaming helpers ──────────────────────────────────────────

const supportsAnsiColor = (stream: NodeJS.WriteStream) =>
  Boolean(stream.isTTY) && process.env.NO_COLOR === undefined;

const ansi = (code: string, text: string, stream: NodeJS.WriteStream) =>
  supportsAnsiColor(stream) ? `\x1b[${code}m${text}\x1b[0m` : text;

const formatElapsed = (elapsedMs: number) =>
  elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;

const EVENT_SYMBOL: Record<string, string> = {
  fulfilled: '✓',
  failed: '✗',
  running: '●',
  approved: '◆',
  signed: '◈',
  deposited: '⬢',
  queued: '○',
};

const noTuiEventSymbol = (kind: TuiEventLogItem['kind'], message: string): string => {
  if (kind === 'system') return '·';
  const match = message.match(/^#\d+\s+(\w+)/);
  return (match?.[1] && EVENT_SYMBOL[match[1]]) ?? (kind === 'error' ? '✗' : '●');
};

const noTuiEventAnsiCode = (kind: TuiEventLogItem['kind'], message: string): string | null => {
  if (kind === 'error') return '31'; // red
  if (kind === 'system') return '2'; // dim
  const match = message.match(/^#\d+\s+(\w+)/);
  switch (match?.[1]) {
    case 'fulfilled':
      return '32'; // green
    case 'running':
      return '36'; // cyan
    case 'approved':
      return '34'; // blue
    case 'signed':
      return '33'; // yellow
    case 'deposited':
      return '34'; // blue
    default:
      return null;
  }
};

const isNoTuiCompletionEvent = (kind: TuiEventLogItem['kind'], message: string): boolean =>
  kind === 'error' || /^#\d+\s+(fulfilled|failed)/.test(message);

const formatNoTuiEventLine = (
  event: Pick<TuiEventLogItem, 'ts' | 'kind' | 'message'>,
  startedAt: number
): string => {
  const elapsed = Math.max(0, event.ts - startedAt);
  const symbol = noTuiEventSymbol(event.kind, event.message);
  return `[+${formatElapsed(elapsed)}]  ${symbol}  ${event.message}`;
};

const pickEligibleDestinations = (
  supported: SupportedChain[],
  destinations: number[] | 'all',
  token: string
) => {
  const supportedById = new Map(supported.map((chain) => [chain.id, chain]));
  if (destinations === 'all') {
    const eligibleAll = supported.filter((chain) =>
      chain.tokens.some((entry) => entry.symbol === token)
    );
    if (eligibleAll.length === 0) {
      throw new Error(`No supported destination chains found for token ${token}.`);
    }
    return eligibleAll.map((chain) => chain.id);
  }
  const missing = destinations.filter((id) => !supportedById.has(id));
  if (missing.length > 0) {
    throw new Error(`Unsupported destination chain IDs: ${missing.join(', ')}`);
  }
  const eligible = destinations.filter((id) => {
    const chain = supportedById.get(id);
    return chain?.tokens.some((entry) => entry.symbol === token) ?? false;
  });
  if (eligible.length === 0) {
    throw new Error(`None of the selected destination chains support token ${token}.`);
  }
  return eligible;
};

const runOperation = async (params: {
  op: Operation;
  privateKey: `0x${string}`;
  network: NexusNetwork | StressNetworkConfig;
  verbose: boolean;
  chainRpcOverrides?: Record<string, string>;
  onStatusUpdate?: (op: Operation, status: OperationStatus, note?: string) => void;
}) => {
  const { op, privateKey, network, onStatusUpdate } = params;
  let worker: ReturnType<ReturnType<typeof getCreateNexusClient>> | null = null;
  let restoreRpcUrls: (() => void) | undefined;
  const startedAt = Date.now();
  const started = applyStatusUpdate(op, 'running', startedAt, { startedAt });
  Object.assign(op, started.operation);
  onStatusUpdate?.(op, 'running');
  const sourceChainMap = new Map<number, string>();

  try {
    const createNexusClient = getCreateNexusClient();
    worker = createNexusClient({
      network: network as NexusNetwork,
      debug: params.verbose,
    });
    await worker.initialize();
    restoreRpcUrls = applyChainRpcOverrides(worker.chainList, params.chainRpcOverrides);
    const { provider } = createPrivateKeyProvider({
      privateKey,
      chains: worker.chainList.chains as Chain[],
    });
    await worker.setEVMProvider(provider);

    const amountBigInt = worker.convertTokenReadableAmountToBigInt(
      op.amount,
      op.token,
      op.destinationChainId
    );
    const result = await worker.bridge(
      {
        toTokenSymbol: op.token,
        toAmountRaw: amountBigInt,
        toChainId: op.destinationChainId,
      },
      {
        onEvent: (event: unknown) => {
          const e = event as {
            name?: string;
            type?: string;
            stepType?: string;
            step?: { chain?: { id?: number; name?: string } };
            plan?: { steps?: Array<{ type?: string; chain?: { id?: number; name?: string } }> };
            args?: { type?: string; data?: { explorerURL?: string; intentID?: string } };
          };

          if (e.type === 'plan_confirmed' && e.plan?.steps) {
            for (const step of e.plan.steps) {
              if (step.type === 'vault_deposit' && step.chain?.id && step.chain.name) {
                sourceChainMap.set(step.chain.id, step.chain.name);
              }
            }
          }
          if (
            e.type === 'plan_progress' &&
            e.stepType === 'vault_deposit' &&
            e.step?.chain?.id &&
            e.step.chain.name
          ) {
            sourceChainMap.set(e.step.chain.id, e.step.chain.name);
          }

          if (e.name !== 'STEP_COMPLETE') return;
          const step = e.args ?? {};
          const {
            operation: nextOp,
            statusChanged,
            note,
          } = applyBridgeStepUpdate(op, step, Date.now());
          Object.assign(op, nextOp);
          if (statusChanged) onStatusUpdate?.(op, statusChanged, note);
          if (step.type === 'INTENT_SUBMITTED') {
            const intentId =
              step.data?.intentID && step.data.intentID !== 'unknown' ? step.data.intentID : null;
            const hasUrl = Boolean(step.data?.explorerURL && step.data.explorerURL !== 'unknown');
            if (intentId || hasUrl) {
              onStatusUpdate?.(
                op,
                op.status,
                intentId ? `Intent Submitted (${intentId})` : 'Intent submitted'
              );
            }
          }
        },
        hooks: {
          onIntent: ({ allow }) => allow(),
          onAllowance: ({ allow, sources }) => allow(sources.map(() => 'max')),
        },
      }
    );

    const finishTs = Date.now();
    const fulfilled = applyStatusUpdate(op, 'fulfilled', finishTs, { finishedAt: finishTs });
    Object.assign(op, fulfilled.operation);
    op.intentExplorerUrl = result.intentExplorerUrl;
    for (const tx of result.sourceTxs ?? []) {
      sourceChainMap.set(tx.chain.id, tx.chain.name);
    }
  } catch (error) {
    op.status = 'failed';
    op.finishedAt = Date.now();
    op.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (sourceChainMap.size > 0) {
      op.sourceChains = Array.from(sourceChainMap, ([id, name]) => ({ id, name }));
    }
    if (op.startedAt !== undefined && op.finishedAt !== undefined) {
      op.durationMs = Math.max(0, op.finishedAt - op.startedAt);
    }
    restoreRpcUrls?.();
    worker?.destroy();
  }
};

const printSummary = (report: ReturnType<typeof buildReport>) => {
  const { totals, performance, config } = report;
  const o = process.stdout;
  const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);
  const row = (label: string, value: string) => `  ${label.padEnd(18)}${value}\n`;
  const sep = ansi('2', '·', o);

  // ── Header ───────────────────────────────────────────────────────────────────
  const allGood = totals.failed === 0;
  const allBad = totals.fulfilled === 0 && totals.failed > 0;
  const headerCode = allGood ? '32' : allBad ? '31' : '33';
  const icon = allGood ? '✓' : allBad ? '✗' : '!';
  o.write(
    `\n${ansi(headerCode, `${icon}  Run complete`, o)}  ${sep}  ${ansi('2', config.loadModel, o)}\n\n`
  );

  // ── Totals ───────────────────────────────────────────────────────────────────
  const fulfilledStr = ansi('32', `${totals.fulfilled} fulfilled`, o);
  const failedStr =
    totals.failed > 0
      ? ansi('31', `${totals.failed} failed`, o)
      : ansi('2', `${totals.failed} failed`, o);
  const cancelledStr =
    totals.cancelled > 0
      ? ansi('33', `${totals.cancelled} cancelled`, o)
      : ansi('2', `${totals.cancelled} cancelled`, o);
  o.write(
    `  ${totals.total} total  ${sep}  ${fulfilledStr}  ${sep}  ${failedStr}  ${sep}  ${cancelledStr}\n`
  );

  // ── Performance ──────────────────────────────────────────────────────────────
  o.write('\n');
  o.write(row('Duration', fmtMs(performance.durationMs)));
  o.write(row('Median', fmtMs(performance.medianMs)));
  o.write(row('P95', fmtMs(performance.p95Ms)));
  o.write(row('Throughput', `${performance.throughputPerMin.toFixed(2)} /min`));

  // ── Segments ─────────────────────────────────────────────────────────────────
  const fmtSeg = (seg: { count: number; medianMs: number }) =>
    seg.count ? fmtMs(seg.medianMs) : ansi('2', 'n/a', o);

  o.write('\n');
  o.write(row('Sign → Deposit', fmtSeg(performance.signToDepositMs)));
  o.write(row('Deposit → Fill', fmtSeg(performance.depositToFillMs)));
  o.write(row('Sign → Fill', fmtSeg(performance.fallbackSignToFillMs)));
  o.write('\n');
};

const executeRun = async (cfg: ResolvedCliConfig) => {
  const useTui = shouldUseTui(cfg);
  setActiveTuiThemeByName(cfg.theme);
  const shouldLog = !useTui && !cfg.quiet && !cfg.json;
  const createNexusClient = getCreateNexusClient();
  const startupClient = createNexusClient({
    network: cfg.network as NexusNetwork,
    debug: cfg.verbose,
  });

  if (shouldLog)
    process.stdout.write(
      `${ansi('2', `Using network config: ${cfg.networkSourceLabel}`, process.stdout)}\n`
    );

  await startupClient.initialize();
  const restoreStartupRpcUrls = applyChainRpcOverrides(
    startupClient.chainList,
    cfg.chainRpcOverrides
  );

  let privateKey: `0x${string}`;
  if (cfg.privateKey) {
    privateKey = cfg.privateKey;
    if (shouldLog) {
      process.stdout.write(
        `${ansi('2', `Using private key source: ${cfg.privateKeySourceLabel}`, process.stdout)}\n`
      );
      process.stdout.write('\n');
      process.stdout.write(
        `${ansi('33', '⚠  Warning: testnet/sandbox keys only. Do not use production funds.', process.stdout)}\n`
      );
      process.stdout.write('\n');
    }
  } else {
    const chainIds = startupClient.chainList.chains.map((chain) => chain.id);
    preflightDevnetFunding(cfg.network, cfg.chainRpcOverrides, chainIds);
    log(shouldLog, 'No private key provided. Generating and funding a fresh devnet account...');
    const funded = generateAndFundDevnetAccount({
      chainList: startupClient.chainList,
      token: cfg.token,
      chainRpcOverrides: cfg.chainRpcOverrides,
    });
    privateKey = funded.privateKey;
    log(
      shouldLog,
      `Generated ${funded.address}. Funded with 1000 ETH and 1000 ${cfg.token.toUpperCase()} per chain.`
    );
  }

  const supported = startupClient.getSupportedChains() as SupportedChain[];
  const chainLookup = new Map<number, string>(supported.map((chain) => [chain.id, chain.name]));
  const eligibleDestinations = pickEligibleDestinations(supported, cfg.destinations, cfg.token);

  const total = cfg.runConfig.totalRequests;
  const operations: Operation[] = Array.from({ length: total }, (_, idx) => ({
    id: idx + 1,
    status: 'queued',
    destinationChainId:
      eligibleDestinations[Math.floor(Math.random() * eligibleDestinations.length)]!,
    token: cfg.token,
    amount: cfg.amount,
  }));
  const startedAt = Date.now();
  let stopRequested = false;

  const onSigInt = () => {
    stopRequested = true;
    pushEvent({ kind: 'system', message: 'SIGINT received; stopping scheduling' });
    log(shouldLog, 'SIGINT received. Stopping scheduling and waiting for in-flight operations...');
    scheduleTui();
  };
  process.once('SIGINT', onSigInt);

  let eventId = 0;
  const tuiEvents: TuiEventLogItem[] = [];
  const MAX_TUI_EVENTS = 200;
  const pushEvent = (event: Omit<TuiEventLogItem, 'id' | 'ts'> & { ts?: number }) => {
    tuiEvents.push({
      id: ++eventId,
      ts: event.ts ?? Date.now(),
      kind: event.kind,
      message: event.message,
      operationId: event.operationId,
    });
    const latest = tuiEvents[tuiEvents.length - 1];
    if (latest && shouldLog) {
      const stream = latest.kind === 'error' ? process.stderr : process.stdout;
      const line = formatNoTuiEventLine(latest, startedAt);
      const code = noTuiEventAnsiCode(latest.kind, latest.message);
      const coloredLine = code ? ansi(code, line, stream) : line;
      if (latest.kind === 'system') stream.write('\n');
      stream.write(`${coloredLine}\n`);
      if (isNoTuiCompletionEvent(latest.kind, latest.message)) stream.write('\n');
    }
    if (tuiEvents.length > MAX_TUI_EVENTS) {
      tuiEvents.splice(0, tuiEvents.length - MAX_TUI_EVENTS);
    }
  };
  let tui: TuiHandle | null = null;
  let tuiRenderScheduled = false;
  let tuiRenderTimer: ReturnType<typeof setTimeout> | null = null;
  let tuiDone = false;
  let tuiReport: ReturnType<typeof buildReport> | undefined;
  const pushTui = (params?: { done?: boolean; report?: ReturnType<typeof buildReport> }) => {
    if (!useTui) return;
    if (params?.done) tuiDone = true;
    if (params?.report) tuiReport = params.report;
    const nextState = {
      startedAt,
      endedAt: params?.done || tuiDone ? Date.now() : undefined,
      total,
      stopRequested,
      done: params?.done ?? tuiDone,
      operations: [...operations],
      report: params?.report ?? tuiReport,
      events: [...tuiEvents],
    };
    if (!tui) {
      tui = startTui(nextState, {
        requestStop: () => {
          stopRequested = true;
          pushEvent({ kind: 'system', message: 'Stop requested from TUI' });
          if (tui) {
            tui.rerender({ ...nextState, stopRequested: true, events: [...tuiEvents] });
          }
        },
      });
      return;
    }
    tui.rerender(nextState);
  };
  const scheduleTui = () => {
    if (!useTui) return;
    if (tuiDone) return;
    if (tuiRenderScheduled) return;
    tuiRenderScheduled = true;
    tuiRenderTimer = setTimeout(() => {
      tuiRenderScheduled = false;
      tuiRenderTimer = null;
      pushTui();
    }, 250);
  };
  const cancelScheduledTui = () => {
    if (tuiRenderTimer) {
      clearTimeout(tuiRenderTimer);
      tuiRenderTimer = null;
    }
    tuiRenderScheduled = false;
  };
  if (useTui) {
    pushTui();
  }
  try {
    await runStressTest({
      operations,
      config: cfg.runConfig,
      execute: (op) =>
        runOperation({
          op,
          privateKey,
          network: cfg.network,
          verbose: cfg.verbose,
          chainRpcOverrides: cfg.chainRpcOverrides,
          onStatusUpdate: (op, status, note) => {
            const dest = chainLookup.get(op.destinationChainId) ?? String(op.destinationChainId);
            const message =
              status === 'running'
                ? `#${op.id} running → ${dest}`
                : note
                  ? `#${op.id} ${status}: ${note}`
                  : `#${op.id} ${status}`;
            pushEvent({
              kind: status === 'failed' ? 'error' : 'status',
              message,
              operationId: op.id,
            });
            scheduleTui();
          },
        }),
      shouldStop: () => stopRequested,
      onOperationStart: () => {
        // "running" status is emitted via onStatusUpdate in runOperation; avoid duplicate log + redraw.
        scheduleTui();
      },
      onOperationFinish: (op) => {
        pushEvent({
          kind: op.status === 'failed' ? 'error' : 'status',
          message: `#${op.id} ${op.status}${op.error ? `: ${op.error}` : ''}${op.durationMs !== undefined ? ` (${op.durationMs}ms)` : ''}`,
          operationId: op.id,
        });
        scheduleTui();
      },
      onOperationError: (op, error) => {
        pushEvent({
          kind: 'error',
          message: `#${op.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          operationId: op.id,
        });
        scheduleTui();
      },
    });
  } finally {
    restoreStartupRpcUrls();
    process.removeListener('SIGINT', onSigInt);
    startupClient.destroy();
  }

  const endedAt = Date.now();
  for (const op of operations) {
    if (
      op.status === 'queued' ||
      op.status === 'running' ||
      op.status === 'approved' ||
      op.status === 'signed' ||
      op.status === 'deposited'
    ) {
      op.cancelled = stopRequested;
      op.status = 'failed';
      op.error = stopRequested ? 'Cancelled by user.' : 'Incomplete operation.';
      op.finishedAt = op.finishedAt ?? endedAt;
      if (op.startedAt !== undefined) {
        op.durationMs = Math.max(0, (op.finishedAt ?? endedAt) - op.startedAt);
      }
    }
  }

  const report = buildReport(operations, startedAt, endedAt, cfg.runConfig, chainLookup);
  cancelScheduledTui();
  pushTui({ done: true, report });

  const payload = {
    networkSource: cfg.networkSourceLabel,
    startedAt,
    endedAt,
    report,
    operations,
  };

  if (cfg.reportFile) {
    await fs.writeFile(cfg.reportFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    pushEvent({ kind: 'system', message: `Report written: ${cfg.reportFile}` });
    cancelScheduledTui();
    pushTui({ done: true, report });
    log(shouldLog, `Report written to ${cfg.reportFile}`);
  }

  if (cfg.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (!useTui) {
    printSummary(report);
  }

  if (useTui && tui !== null) {
    await (tui as TuiHandle).waitUntilExit();
  }

  if (stopRequested) process.exitCode = 130;
  if (report.totals.failed > 0 && process.exitCode !== 130) process.exitCode = 1;
};

const main = async () => {
  const raw = parseArgv(process.argv.slice(2));
  if (raw.command === 'help') {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const flags = await maybePromptForMissing(raw);
  const cfg = await coerceFlagsToConfig(flags);

  if (cfg.dryRun) {
    const summary = {
      networkSource: cfg.networkSourceLabel,
      privateKeySource: cfg.privateKeySourceLabel,
      token: cfg.token,
      amount: cfg.amount,
      destinations: cfg.destinations,
      runConfig: cfg.runConfig,
      reportFile: cfg.reportFile ?? null,
      theme: cfg.theme,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  await executeRun(cfg);
};

main().catch((error) => {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((i) => i.message).join('; ')
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`${ansi('31', `Error: ${message}`, process.stderr)}\n`);
  process.exitCode = 1;
});
