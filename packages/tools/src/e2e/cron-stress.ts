import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { Readable, Writable } from 'node:stream';
import type { Operation, StressReport } from '../stress-test/types';
import type { ChainInfo, TestSpec } from './chain-select';
import type { CronEnv } from './cron-env';

const TAIL_MAX_LINES = 200;

export type StressPayload = {
  operations?: Operation[];
  report?: StressReport;
};

export type StressOutcome = {
  exitCode: number;
  payload: StressPayload;
  combinedTail: string[];
};

export const runStressSubprocess = async (
  env: CronEnv,
  destChain: ChainInfo,
  test: TestSpec
): Promise<StressOutcome> => {
  const reportFile = path.join(os.tmpdir(), `stress-report-${randomUUID()}.json`);
  const args = buildStressArgs(env, destChain, test, reportFile);

  const { exitCode, combinedTail } = await spawnAndTee(env.sdkDir, args);
  const payload = await readPayloadOrEmpty(reportFile);
  await unlinkQuiet(reportFile);

  return { exitCode, payload, combinedTail };
};

const buildStressArgs = (
  env: CronEnv,
  destChain: ChainInfo,
  test: TestSpec,
  reportFile: string
): string[] => [
  '--network',
  env.network,
  '--token',
  test.token,
  '--amount',
  test.amount,
  '--destinations',
  String(destChain.id),
  '--load-model',
  'batch',
  '--total-requests',
  '1',
  '--batch-size',
  '1',
  '--delay-ms',
  '1000',
  '--no-tui',
  '--report-file',
  reportFile,
];

type SpawnResult = { exitCode: number; combinedTail: string[] };

const spawnAndTee = (cwd: string, stressArgs: string[]): Promise<SpawnResult> =>
  new Promise((resolve) => {
    const combinedTail: string[] = [];
    const child = spawn('npm', ['run', 'stress', '--', 'run', ...stressArgs], {
      cwd,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    if (child.stdout) teeAndCollect(child.stdout, process.stdout, combinedTail);
    if (child.stderr) teeAndCollect(child.stderr, process.stderr, combinedTail);
    child.on('error', (err) => {
      process.stderr.write(`stress spawn error: ${err.message}\n`);
      resolve({ exitCode: 127, combinedTail });
    });
    child.on('close', (code) => resolve({ exitCode: code ?? 1, combinedTail }));
  });

const teeAndCollect = (stream: Readable, sink: Writable, tail: string[]): void => {
  let partial = '';
  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    sink.write(text);
    partial += text;
    const lines = partial.split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) appendBounded(tail, line);
    }
  });
  stream.on('end', () => {
    if (partial.trim()) appendBounded(tail, partial);
  });
};

const appendBounded = (tail: string[], line: string): void => {
  tail.push(line);
  if (tail.length > TAIL_MAX_LINES) tail.shift();
};

const readPayloadOrEmpty = async (file: string): Promise<StressPayload> => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as StressPayload;
  } catch {
    return {};
  }
};

const unlinkQuiet = (file: string): Promise<void> => fs.unlink(file).catch(() => undefined);
