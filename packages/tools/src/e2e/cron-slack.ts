import process from 'node:process';
import type { SettlementResult } from './check-settlements';
import { type BalanceStatus, formatError, type TestResult } from './cron-result';
import { formatTokenBalance } from './sdk-bridge';

export type Summary = {
  network: string;
  passCount: number;
  failCount: number;
  balanceIssueCount: number;
  results: TestResult[];
  // Pre-formatted body line (with leading emoji) for a fatal/skip condition.
  // Appears in the message body even when no tests ran.
  fatalLine?: string;
  // Pre-formatted settle activity lines, appended after test results.
  settleLines?: string[];
  // EOA address that ran the cron — surfaced as an Etherscan button next to
  // the network row. Absent only when readEnv fails before key derivation.
  walletAddress?: string;
};

export const summarize = (
  network: string,
  results: TestResult[],
  fatalLine?: string,
  settleLines?: string[],
  walletAddress?: string
): Summary => {
  let passCount = 0;
  let failCount = 0;
  let balanceIssueCount = 0;
  for (const r of results) {
    if (r.status === 'passed') passCount += 1;
    else failCount += 1;
    if (r.balanceStatus !== 'ok') balanceIssueCount += 1;
  }
  return {
    network,
    passCount,
    failCount,
    balanceIssueCount,
    results,
    fatalLine,
    settleLines,
    walletAddress,
  };
};

// Etherscan family covers most EVM networks; testnet runs map to Sepolia.
const etherscanUrl = (network: string, address: string): string => {
  const base = network === 'testnet' ? 'https://sepolia.etherscan.io' : 'https://etherscan.io';
  return new URL(`/address/${address}`, base).toString();
};

const BODY_INDENT = '          ';

const headerEmoji = (r: TestResult): string => {
  if (r.status === 'failed') return '❌';
  if (r.balanceStatus !== 'ok') return '⚠️';
  return '✅';
};

const balanceEmoji = (balanceStatus: BalanceStatus): string => {
  switch (balanceStatus) {
    case 'ok':
      return '💰';
    case 'mismatch':
    case 'before_failed':
      return '⚠️';
    default:
      return '·';
  }
};

const formatRoute = (r: TestResult): string => {
  const dest = `${r.destChain.name} (${r.destChain.id})`;
  if (!r.sourceChains?.length) return `→ ${dest}`;
  const sources = r.sourceChains.map((c) => `${c.name} (${c.id})`).join(', ');
  return `${sources} → ${dest}`;
};

const formatHeaderLine = (r: TestResult): string => {
  const parts = [
    `${headerEmoji(r)} *${r.token}* ${r.amount}`,
    formatRoute(r),
    `bridge:${r.bridgeStatus}`,
  ];
  if (r.durationMs !== undefined) parts.push(`${(r.durationMs / 1000).toFixed(1)}s`);
  if (r.intentUrl) parts.push(`<${r.intentUrl}|Explorer>`);
  return parts.join('  ·  ');
};

const formatBalanceLine = (r: TestResult): string => {
  const emoji = balanceEmoji(r.balanceStatus);
  if (r.unifiedBefore && r.unifiedAfter) {
    const before = formatTokenBalance(r.unifiedBefore);
    const after = formatTokenBalance(r.unifiedAfter);
    const base = `${BODY_INDENT}${emoji} unified ${r.token} ${before} → ${after}`;
    if (!r.destDelta) return base;
    return `${base} (Δdest=${formatTokenBalance(r.destDelta)})`;
  }
  if (r.destDelta) return `${BODY_INDENT}${emoji} Δdest=${formatTokenBalance(r.destDelta)}`;
  return `${BODY_INDENT}${emoji} balance:${r.balanceStatus}`;
};

export const buildResultLines = (r: TestResult): string[] => {
  const lines = [formatHeaderLine(r), formatBalanceLine(r)];
  if (r.status === 'failed' && r.errorMsg) {
    lines.push(`${BODY_INDENT}❌ Bridge error: ${r.errorMsg}`);
  }
  if (r.balanceError) {
    lines.push(`${BODY_INDENT}⚠️ Balance error: ${r.balanceError}`);
  }
  return lines;
};

const MAX_SETTLE_TX_PER_CHAIN = 5;

const formatSettleTxList = (hashes: readonly string[], explorerTxBase: string): string => {
  const shown = hashes.slice(0, MAX_SETTLE_TX_PER_CHAIN);
  const formatted = shown
    .map((h, i) => {
      const label = `Tx ${i + 1}`;
      return explorerTxBase ? `<${explorerTxBase}${h}|${label}>` : label;
    })
    .join(', ');
  const extra = hashes.length - shown.length;
  return extra > 0 ? `${formatted} (+${extra} more)` : formatted;
};

export const buildSettleLines = (result: SettlementResult): string[] => {
  const lines: string[] = [];
  const withSettles = result.perChain.filter((c) => c.count > 0);
  const chains = withSettles.map((c) => c.name).join(', ');
  if (result.passed) {
    lines.push(
      `✅ Settle activity (${result.hours}h): ${result.chainsWithSettlements} chain(s) — ${chains}`
    );
    for (const c of withSettles) {
      if (c.txHashes.length === 0) continue;
      lines.push(
        `${BODY_INDENT}• ${c.name} (${c.count}): ${formatSettleTxList(c.txHashes, c.explorerTxBase)}`
      );
    }
  } else {
    lines.push(`❌ Settle activity (${result.hours}h): no Settle events observed on any vault`);
    const scanned = result.perChain.map((c) => c.name).join(', ');
    if (scanned) lines.push(`${BODY_INDENT}(scanned: ${scanned})`);
  }
  const rpcErrors = result.perChain
    .filter((c) => c.error)
    .map((c) => `${c.name}: ${(c.error ?? '').replace(/\n/g, ' ').slice(0, 80)}`)
    .join(' · ');
  if (rpcErrors) {
    lines.push(`${BODY_INDENT}⚠️ Settle RPC issues: ${rpcErrors}`);
  }
  return lines;
};

// Used when runSettlementCheck itself throws (RPC outage, SDK init failure).
// Matches the bash `"check failed (...)"` shape with stderr clipped to 120 chars.
export const buildSettleFailedLine = (hours: number, error: string): string =>
  `⚠️ Settle activity (${hours}h): check failed (${error.replace(/\n/g, ' ').slice(0, 120)})`;

const TITLE_MAX_LEN = 120;

// fatalLine shapes:
//   "❌ <error>"   → crash, error text → title
//   "⚠️ <reason>"  → skip, reason text → title (e.g. chain has no supported tokens)
//   "✅ <...>"     → not currently emitted, but supported for completeness
const FATAL_LINE_PREFIX_RE = /^(❌|⚠️|✅)\s*/;

const stripFatalEmoji = (line: string): string => line.replace(FATAL_LINE_PREFIX_RE, '');

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

const titleFor = (summary: Summary): { emoji: string; title: string } => {
  const { passCount, failCount, balanceIssueCount, fatalLine } = summary;
  const total = passCount + failCount;
  if (total === 0) {
    // Surface the actual reason in the title — Slack mobile notifications
    // truncate the body, and "Crashed (entrypoint exited...)" hides the cause.
    if (fatalLine) {
      const isWarn = fatalLine.startsWith('⚠️');
      const label = isWarn ? 'E2E Tests Skipped' : 'E2E Tests Crashed';
      const detail = truncate(stripFatalEmoji(fatalLine), TITLE_MAX_LEN);
      return { emoji: isWarn ? '⚠️' : '❌', title: `${label}: ${detail}` };
    }
    return { emoji: '❌', title: 'E2E Tests Crashed (no detail captured)' };
  }
  if (failCount === 0 && balanceIssueCount === 0) {
    return { emoji: '✅', title: `E2E Tests Passed (${passCount}/${total})` };
  }
  if (failCount === 0) {
    return {
      emoji: '⚠️',
      title: `E2E Tests Passed (${passCount}/${total}) — ${balanceIssueCount} balance issue(s)`,
    };
  }
  return { emoji: '❌', title: `E2E Tests Failed (${passCount}/${total} passed)` };
};

export const buildSummaryText = (summary: Summary): string => {
  const { emoji, title } = titleFor(summary);
  const body: string[] = [];
  if (summary.fatalLine) body.push(summary.fatalLine);
  for (const r of summary.results) body.push(...buildResultLines(r));
  if (summary.settleLines?.length) body.push(...summary.settleLines);
  return `${emoji} *${title}*\n*Network*: ${summary.network}\n\n${body.join('\n')}`;
};

// Minimal Slack Block Kit shapes — keeps us off the @slack/types dep.
type MrkdwnText = { type: 'mrkdwn'; text: string };
type PlainText = { type: 'plain_text'; text: string; emoji?: boolean };
type ButtonAccessory = { type: 'button'; text: PlainText; url: string };
export type Block =
  | { type: 'header'; text: PlainText }
  | { type: 'divider' }
  | { type: 'section'; text?: MrkdwnText; fields?: MrkdwnText[]; accessory?: ButtonAccessory }
  | { type: 'context'; elements: MrkdwnText[] };

const buildTestBlocks = (r: TestResult): Block[] => {
  const fields: MrkdwnText[] = [{ type: 'mrkdwn', text: `*Bridge:*\n${r.bridgeStatus}` }];
  if (r.durationMs !== undefined) {
    fields.push({ type: 'mrkdwn', text: `*Duration:*\n${(r.durationMs / 1000).toFixed(1)}s` });
  }
  if (r.sourceChains?.length) {
    fields.push({
      type: 'mrkdwn',
      text: `*Source:*\n${r.sourceChains.map((c) => c.name).join(', ')}`,
    });
  }
  if (r.destDelta) {
    fields.push({ type: 'mrkdwn', text: `*Δdest:*\n${formatTokenBalance(r.destDelta)}` });
  }
  if (r.unifiedBefore && r.unifiedAfter) {
    fields.push({
      type: 'mrkdwn',
      text: `*Unified ${r.token}:*\n${formatTokenBalance(r.unifiedBefore)} → ${formatTokenBalance(r.unifiedAfter)}`,
    });
  }

  const section: Extract<Block, { type: 'section' }> = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${headerEmoji(r)} *${r.token}* ${r.amount}  ·  ${formatRoute(r)}`,
    },
    fields,
  };
  if (r.intentUrl) {
    section.accessory = {
      type: 'button',
      text: { type: 'plain_text', text: ':mag: View on Explorer', emoji: true },
      url: r.intentUrl,
    };
  }

  const blocks: Block[] = [section];
  if (r.errorMsg) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `❌ Bridge error: ${r.errorMsg}` }],
    });
  }
  if (r.balanceError) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `⚠️ Balance error: ${r.balanceError}` }],
    });
  }
  return blocks;
};

export const buildSummaryBlocks = (summary: Summary): Block[] => {
  const { emoji, title } = titleFor(summary);
  const blocks: Block[] = [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} ${title}`, emoji: true } },
  ];

  // Wallet address gets an Etherscan accessory; we promote the network row
  // from a context block to a section so it can host the button.
  if (summary.walletAddress) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Network:* ${summary.network}` },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: ':mag: View on Etherscan', emoji: true },
        url: etherscanUrl(summary.network, summary.walletAddress),
      },
    });
  } else {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*Network:* ${summary.network}` }],
    });
  }

  if (summary.fatalLine) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: summary.fatalLine } });
  }

  for (const r of summary.results) {
    blocks.push({ type: 'divider' });
    blocks.push(...buildTestBlocks(r));
  }

  if (summary.settleLines?.length) {
    blocks.push({ type: 'divider' });
    for (const line of summary.settleLines) {
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: line }] });
    }
  }

  return blocks;
};

export type SlackPayload = { text: string; blocks?: Block[] };

export const postToSlack = async (webhookUrl: string, payload: SlackPayload): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    process.stderr.write(`Slack webhook fetch failed: ${formatError(err)}\n`);
    return;
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    process.stderr.write(`Slack webhook failed (HTTP ${response.status}): ${body}\n`);
  }
};
