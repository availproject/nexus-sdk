import process from 'node:process';
import { privateKeyToAccount } from 'viem/accounts';
import { captureChainBalances, captureSnapshot } from './balance-check';
import {
  type ChainInfo,
  pickRandomChain,
  selectTestsForChain,
  type TestSpec,
} from './chain-select';
import { runSettlementCheck } from './check-settlements';
import { type CronEnv, readEnv } from './cron-env';
import { postChainBalances, postRunMetric } from './cron-metrics';
import { assembleResult, formatError, type SnapshotAttempt, type TestResult } from './cron-result';
import {
  buildSettleFailedLine,
  buildSettleLines,
  buildSummaryBlocks,
  buildSummaryText,
  postToSlack,
  type Summary,
  summarize,
} from './cron-slack';
import { runStressSubprocess } from './cron-stress';
import { listSupportedChains } from './list-chains';
import { formatTokenBalance } from './sdk-bridge';

const logBanner = (env: CronEnv, destChain: ChainInfo, test: TestSpec): void => {
  process.stderr.write(
    [
      '',
      '======== E2E Cron Run ========',
      `  Network:     ${env.network}`,
      `  Token:       ${test.token}`,
      `  Amount:      ${test.amount}`,
      `  Destination: ${destChain.name} (${destChain.id})`,
      `  Started:     ${new Date().toISOString()}`,
      '==============================',
      '',
      '',
    ].join('\n')
  );
};

const trySnapshot = async (
  mode: 'before' | 'after',
  env: CronEnv,
  test: TestSpec
): Promise<SnapshotAttempt> => {
  try {
    const snapshot = await captureSnapshot({
      mode,
      privateKey: env.privateKey,
      network: env.network,
      token: test.token,
    });
    process.stderr.write(
      `Balance (${mode}) ${test.token}: unified=${formatTokenBalance(snapshot.unifiedBalance)}\n`
    );
    return { snapshot };
  } catch (err) {
    const error = formatError(err);
    process.stderr.write(`balance-check error (${mode}): ${error}\n`);
    return { error };
  }
};

const runOneTest = async (
  env: CronEnv,
  destChain: ChainInfo,
  test: TestSpec
): Promise<TestResult> => {
  logBanner(env, destChain, test);
  const before = await trySnapshot('before', env, test);
  const stress = await runStressSubprocess(env, destChain, test);
  // If the before snapshot failed, skip after (we can't compute a meaningful
  // delta against a missing baseline).
  const after: SnapshotAttempt = before.snapshot
    ? await trySnapshot('after', env, test)
    : { error: 'skipped (before snapshot failed)' };
  return assembleResult({ destChain, test, before, after, stress });
};

// Matches the bash convention of keeping the last failure's exit code so
// it ends up in the "internal exit" log line.
const lastFailureExitCode = (results: TestResult[]): number => {
  let code = 0;
  for (const r of results) {
    if (r.status === 'failed') code = r.exitCode;
  }
  return code;
};

// Settle check is best-effort: any failure becomes a single warning line
// rather than aborting the cron run.
const runSettlementSafely = async (env: CronEnv): Promise<string[]> => {
  try {
    const result = await runSettlementCheck(env.network, env.settleLookbackHours);
    return buildSettleLines(result);
  } catch (err) {
    const msg = formatError(err);
    process.stderr.write(`check-settlements error: ${msg}\n`);
    return [buildSettleFailedLine(env.settleLookbackHours, msg)];
  }
};

type Outcome = { summary: Summary; exitCode: number };

const orchestrate = async (env: CronEnv, walletAddress: string): Promise<Outcome> => {
  try {
    const chains = await listSupportedChains(env.network);
    if (chains.length === 0) {
      return {
        summary: summarize(
          env.network,
          [],
          `❌ list-chains returned no chains for network=${env.network}`,
          undefined,
          walletAddress
        ),
        exitCode: 1,
      };
    }
    const destChain = pickRandomChain(chains);
    const tests = selectTestsForChain(destChain, env.usdcAmount, env.ethAmount);
    if (tests.length === 0) {
      const settleLines = await runSettlementSafely(env);
      return {
        summary: summarize(
          env.network,
          [],
          `⚠️ Chain ${destChain.name} (${destChain.id}) has no USDC/ETH/USDC.e support; nothing to test`,
          settleLines,
          walletAddress
        ),
        exitCode: 0,
      };
    }
    const results: TestResult[] = [];
    for (const test of tests) {
      results.push(await runOneTest(env, destChain, test));
    }
    const settleLines = await runSettlementSafely(env);
    return {
      summary: summarize(env.network, results, undefined, settleLines, walletAddress),
      exitCode: lastFailureExitCode(results),
    };
  } catch (err) {
    return {
      summary: summarize(env.network, [], `❌ ${formatError(err)}`, undefined, walletAddress),
      exitCode: 1,
    };
  }
};

const reportToSlack = async (webhookUrl: string | undefined, summary: Summary): Promise<void> => {
  if (!webhookUrl) {
    process.stderr.write('SLACK_WEBHOOK_URL not set; skipping Slack notification\n');
    return;
  }
  await postToSlack(webhookUrl, {
    text: buildSummaryText(summary),
    blocks: buildSummaryBlocks(summary),
  });
};

// Unconditional per-run liveness heartbeat (best-effort). Emitted even on a
// failed/fatal run so "no run in N hours" alerts can detect a dead cron
// independently of whether the balance gauge was produced.
const reportRun = async (
  endpoint: string | undefined,
  network: string,
  status: string
): Promise<void> => {
  if (!endpoint) return;
  await postRunMetric(endpoint, network, status);
};

// Best-effort per-run balance snapshot: two points per chain (stablecoin +
// native gas), captured once via a single getBalancesForBridge — independent of
// which token was tested. One client init; failures degrade to a stderr line.
const reportChainBalances = async (env: CronEnv, walletAddress: string): Promise<void> => {
  if (!env.otelMetricsEndpoint) return;
  try {
    const balances = await captureChainBalances({
      privateKey: env.privateKey,
      network: env.network,
    });
    await postChainBalances(env.otelMetricsEndpoint, {
      network: env.network,
      wallet: walletAddress,
      balances,
      capturedAtMs: Date.now(),
    });
  } catch (err) {
    process.stderr.write(`chain-balance metric error: ${formatError(err)}\n`);
  }
};

// Always exit 0 — k8s would otherwise retry the cron pod aggressively on
// non-zero exit, masking the real failure rate. The internal code is logged.
const exitClean = (exitCode: number): never => {
  process.stderr.write(`Run finished. internal exit: ${exitCode} (suppressed to 0)\n`);
  process.exit(0);
};

const main = async (): Promise<void> => {
  const env = readEnv();
  const walletAddress = privateKeyToAccount(env.privateKey).address;
  const { summary, exitCode } = await orchestrate(env, walletAddress);
  await reportToSlack(env.slackWebhookUrl, summary);
  await reportRun(env.otelMetricsEndpoint, env.network, exitCode === 0 ? 'passed' : 'failed');
  await reportChainBalances(env, walletAddress);
  exitClean(exitCode);
};

// Top-level catch handles env-validation failures (the only path that can
// throw out of main, since orchestrate catches everything internally).
main().catch(async (err) => {
  const msg = formatError(err);
  process.stderr.write(`fatal: ${msg}\n`);
  await reportToSlack(
    process.env.SLACK_WEBHOOK_URL,
    summarize(process.env.NETWORK ?? 'testnet', [], `❌ ${msg}`)
  );
  await reportRun(
    process.env.OTEL_METRICS_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    process.env.NETWORK ?? 'testnet',
    'fatal'
  );
  exitClean(1);
});
