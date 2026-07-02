import { describe, expect, it } from 'vitest';
import type { ChainResult, SettlementResult } from './check-settlements';
import type { TestResult } from './cron-result';
import {
  type Block,
  buildResultLines,
  buildSettleFailedLine,
  buildSettleLines,
  buildSummaryBlocks,
  buildSummaryText,
  summarize,
} from './cron-slack';

const baseResult = (overrides: Partial<TestResult> = {}): TestResult => ({
  token: 'USDC',
  amount: '0.1',
  destChain: { id: 2, name: 'Arb Sep', symbols: ['USDC'] },
  status: 'passed',
  exitCode: 0,
  bridgeStatus: 'fulfilled',
  balanceStatus: 'ok',
  ...overrides,
});

describe('summarize', () => {
  it('counts pass/fail/balance correctly across mixed results', () => {
    const s = summarize('testnet', [
      baseResult(),
      baseResult({ status: 'failed', exitCode: 1, balanceStatus: 'mismatch' }),
      baseResult({ balanceStatus: 'before_failed' }),
    ]);
    expect(s.passCount).toBe(2);
    expect(s.failCount).toBe(1);
    expect(s.balanceIssueCount).toBe(2);
    expect(s.network).toBe('testnet');
  });

  it('preserves fatalLine', () => {
    expect(summarize('testnet', [], '❌ fatal').fatalLine).toBe('❌ fatal');
  });

  it('yields zero counts when given no results', () => {
    const s = summarize('mainnet', []);
    expect(s.passCount).toBe(0);
    expect(s.failCount).toBe(0);
    expect(s.balanceIssueCount).toBe(0);
  });
});

describe('buildResultLines', () => {
  it('happy path produces header + balance lines', () => {
    const lines = buildResultLines(
      baseResult({
        durationMs: 5000,
        intentUrl: 'https://explorer/x',
        sourceChains: [{ id: 1, name: 'Eth' }],
        unifiedBefore: '10',
        unifiedAfter: '9.9',
        destDelta: '0.1',
      })
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('✅');
    expect(lines[0]).toContain('bridge:fulfilled');
    expect(lines[0]).toContain('Eth (1) → Arb Sep (2)');
    expect(lines[0]).toContain('5.0s');
    expect(lines[0]).toContain('<https://explorer/x|Explorer>');
    expect(lines[1]).toContain('💰 unified USDC 10 → 9.9 (Δdest=0.1)');
  });

  it('failed result uses ❌ header and surfaces bridge error', () => {
    const lines = buildResultLines(
      baseResult({
        status: 'failed',
        exitCode: 1,
        bridgeStatus: 'failed',
        errorMsg: 'bridge timed out',
      })
    );
    expect(lines[0]).toContain('❌');
    expect(lines[0]).toContain('bridge:failed');
    expect(lines.some((l) => l.includes('Bridge error: bridge timed out'))).toBe(true);
  });

  it('balance issue uses ⚠️ header but bridge segment has no emoji', () => {
    const lines = buildResultLines(
      baseResult({
        balanceStatus: 'mismatch',
        balanceError: 'rpc timeout',
      })
    );
    expect(lines[0].startsWith('⚠️')).toBe(true);
    expect(lines[0]).toContain('bridge:fulfilled');
    expect(lines[0]).not.toContain('🌉');
    expect(lines.some((l) => l.includes('Balance error: rpc timeout'))).toBe(true);
  });

  it('uses → notation alone when no source chains are present, but still shows dest id', () => {
    const lines = buildResultLines(baseResult());
    expect(lines[0]).toContain('→ Arb Sep (2)');
  });

  it('joins multiple source chains with comma and shows dest id', () => {
    const lines = buildResultLines(
      baseResult({
        sourceChains: [
          { id: 1, name: 'Eth' },
          { id: 8453, name: 'Base' },
        ],
      })
    );
    expect(lines[0]).toContain('Eth (1), Base (8453) → Arb Sep (2)');
  });
});

const chain = (
  id: number,
  name: string,
  count: number,
  extra: Partial<ChainResult> = {}
): ChainResult => ({ id, name, count, txHashes: [], explorerTxBase: '', ...extra });

const settleResult = (overrides: Partial<SettlementResult> = {}): SettlementResult => ({
  passed: true,
  hours: 4,
  totalSettles: 3,
  chainsWithSettlements: 2,
  perChain: [chain(1, 'Eth Sep', 2), chain(2, 'Arb Sep', 1), chain(3, 'Base Sep', 0)],
  ...overrides,
});

describe('buildSettleLines', () => {
  it('emits a single pass line when no tx hashes are attached', () => {
    const lines = buildSettleLines(settleResult());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('✅ Settle activity (4h): 2 chain(s) — Eth Sep, Arb Sep');
  });

  it('renders per-chain Tx N links when txHashes are present', () => {
    const lines = buildSettleLines(
      settleResult({
        perChain: [
          chain(1, 'Eth Sep', 2, {
            txHashes: ['0xaaaa', '0xbbbb'],
            explorerTxBase: 'https://example/tx/',
          }),
          chain(2, 'Arb Sep', 1, { txHashes: ['0xcccc'], explorerTxBase: '' }),
        ],
      })
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      '          • Eth Sep (2): <https://example/tx/0xaaaa|Tx 1>, <https://example/tx/0xbbbb|Tx 2>'
    );
    expect(lines[2]).toBe('          • Arb Sep (1): Tx 1');
  });

  it('caps tx hash list per chain and appends (+N more)', () => {
    const hashes = Array.from({ length: 7 }, (_, i) => `0x${i}`);
    const lines = buildSettleLines(
      settleResult({
        chainsWithSettlements: 1,
        perChain: [
          chain(1, 'Eth Sep', 7, { txHashes: hashes, explorerTxBase: 'https://example/tx/' }),
        ],
      })
    );
    expect(lines[1]).toContain('Tx 5');
    expect(lines[1]).toContain('(+2 more)');
    expect(lines[1]).not.toContain('Tx 6');
  });

  it('emits fail line + scanned-chains line when no settles were observed', () => {
    const lines = buildSettleLines(
      settleResult({
        passed: false,
        chainsWithSettlements: 0,
        perChain: [chain(1, 'Eth Sep', 0), chain(2, 'Arb Sep', 0)],
      })
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('❌ Settle activity (4h): no Settle events observed on any vault');
    expect(lines[1]).toContain('(scanned: Eth Sep, Arb Sep)');
  });

  it('appends an RPC-issues line when some chains errored, joined by " · "', () => {
    const lines = buildSettleLines(
      settleResult({
        perChain: [
          chain(1, 'Eth Sep', 2),
          chain(2, 'Arb Sep', 0, { error: 'rpc timeout' }),
          chain(3, 'Base Sep', 0, { error: 'rate limited' }),
        ],
        chainsWithSettlements: 1,
      })
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('✅ Settle activity (4h): 1 chain(s) — Eth Sep');
    expect(lines[1]).toContain(
      '⚠️ Settle RPC issues: Arb Sep: rpc timeout · Base Sep: rate limited'
    );
  });

  it('truncates RPC error messages to 80 chars and replaces newlines with spaces', () => {
    const longErr = `${'x'.repeat(100)}\nmore`;
    const lines = buildSettleLines(
      settleResult({
        perChain: [chain(1, 'Eth', 0, { error: longErr })],
        passed: false,
        chainsWithSettlements: 0,
      })
    );
    const rpcLine = lines.find((l) => l.includes('RPC issues')) ?? '';
    expect(rpcLine).toContain(`Eth: ${'x'.repeat(80)}`);
    expect(rpcLine).not.toContain('\n');
  });

  it('honors a custom hours value', () => {
    expect(buildSettleLines(settleResult({ hours: 12 }))[0]).toContain('(12h)');
  });
});

describe('buildSettleFailedLine', () => {
  it('returns the warning line with hours and trimmed error', () => {
    expect(buildSettleFailedLine(4, 'rpc went down')).toBe(
      '⚠️ Settle activity (4h): check failed (rpc went down)'
    );
  });

  it('replaces newlines with spaces', () => {
    expect(buildSettleFailedLine(4, 'line1\nline2')).toBe(
      '⚠️ Settle activity (4h): check failed (line1 line2)'
    );
  });

  it('truncates error to 120 chars', () => {
    const longErr = 'x'.repeat(200);
    const line = buildSettleFailedLine(4, longErr);
    expect(line).toBe(`⚠️ Settle activity (4h): check failed (${'x'.repeat(120)})`);
  });
});

describe('buildSummaryText', () => {
  it('renders all-passed title', () => {
    const text = buildSummaryText(
      summarize('testnet', [baseResult(), baseResult({ token: 'ETH' })])
    );
    expect(text).toContain('✅ *E2E Tests Passed (2/2)*');
    expect(text).toContain('*Network*: testnet');
  });

  it('renders balance-issue title', () => {
    const text = buildSummaryText(
      summarize('testnet', [baseResult({ balanceStatus: 'mismatch' })])
    );
    expect(text).toContain('⚠️ *E2E Tests Passed (1/1) — 1 balance issue(s)*');
  });

  it('renders failed title', () => {
    const text = buildSummaryText(
      summarize('testnet', [baseResult({ status: 'failed', exitCode: 1, bridgeStatus: 'failed' })])
    );
    expect(text).toContain('❌ *E2E Tests Failed (0/1 passed)*');
  });

  it('surfaces the crash reason in the title (not just generic "Crashed")', () => {
    const text = buildSummaryText(
      summarize('testnet', [], '❌ list-chains returned no chains for network=testnet')
    );
    expect(text).toContain(
      '❌ *E2E Tests Crashed: list-chains returned no chains for network=testnet*'
    );
    // body still has the full fatalLine so longer messages survive title truncation
    expect(text).toContain('❌ list-chains returned no chains for network=testnet');
  });

  it('uses "Skipped" + ⚠️ for warn-prefixed fatalLines (no tokens etc.)', () => {
    const text = buildSummaryText(
      summarize('testnet', [], '⚠️ Chain Foo (123) has no USDC/ETH/USDC.e support; nothing to test')
    );
    expect(text).toContain(
      '⚠️ *E2E Tests Skipped: Chain Foo (123) has no USDC/ETH/USDC.e support; nothing to test*'
    );
    expect(text).toContain('⚠️ Chain Foo (123) has no USDC/ETH/USDC.e support');
  });

  it('truncates very long crash reasons in the title with an ellipsis', () => {
    const longMsg = 'x'.repeat(200);
    const text = buildSummaryText(summarize('testnet', [], `❌ ${longMsg}`));
    expect(text).toContain(`❌ *E2E Tests Crashed: ${'x'.repeat(120)}…*`);
    // body has the full untruncated message
    expect(text).toContain(`❌ ${longMsg}`);
  });

  it('falls back to a generic crashed title when no fatalLine is given', () => {
    const text = buildSummaryText(summarize('testnet', []));
    expect(text).toContain('❌ *E2E Tests Crashed (no detail captured)*');
  });

  it('appends settle lines after test results', () => {
    const text = buildSummaryText(
      summarize('testnet', [baseResult()], undefined, ['✅ Settle activity (4h): 1 chain(s) — Eth'])
    );
    expect(text).toContain('✅ *E2E Tests Passed (1/1)*');
    expect(text).toContain('✅ Settle activity (4h): 1 chain(s) — Eth');
    // settle line comes after the result lines
    const lastResultIdx = text.lastIndexOf('USDC');
    expect(text.indexOf('Settle activity')).toBeGreaterThan(lastResultIdx);
  });
});

const findSection = (blocks: Block[]): Extract<Block, { type: 'section' }> => {
  const section = blocks.find(
    (b): b is Extract<Block, { type: 'section' }> => b.type === 'section'
  );
  if (!section) throw new Error('no section block found');
  return section;
};

describe('buildSummaryBlocks', () => {
  it('emits header + network context + section + settle context in order (no wallet)', () => {
    const blocks = buildSummaryBlocks(
      summarize(
        'testnet',
        [
          baseResult({
            durationMs: 5000,
            intentUrl: 'https://explorer/x',
            sourceChains: [{ id: 1, name: 'Eth' }],
            unifiedBefore: '10',
            unifiedAfter: '9.9',
            destDelta: '0.1',
          }),
        ],
        undefined,
        ['✅ Settle activity (4h): 1 chain(s) — Eth']
      )
    );
    expect(blocks[0]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: '✅ E2E Tests Passed (1/1)', emoji: true },
    });
    expect(blocks[1]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Network:* testnet' }],
    });
    expect(blocks[2]).toEqual({ type: 'divider' });
    expect(blocks[3].type).toBe('section');
    expect(blocks.at(-2)).toEqual({ type: 'divider' });
    expect(blocks.at(-1)).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '✅ Settle activity (4h): 1 chain(s) — Eth' }],
    });
  });

  it('promotes network row to a section with an Etherscan button when walletAddress is set', () => {
    const blocks = buildSummaryBlocks(
      summarize(
        'testnet',
        [baseResult()],
        undefined,
        undefined,
        '0x1111111111111111111111111111111111111111'
      )
    );
    expect(blocks[1]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Network:* testnet' },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: ':mag: View on Etherscan', emoji: true },
        url: 'https://sepolia.etherscan.io/address/0x1111111111111111111111111111111111111111',
      },
    });
  });

  it('uses mainnet etherscan host for non-testnet networks', () => {
    const blocks = buildSummaryBlocks(
      summarize(
        'mainnet',
        [baseResult()],
        undefined,
        undefined,
        '0x2222222222222222222222222222222222222222'
      )
    );
    const networkBlock = blocks[1] as Extract<Block, { type: 'section' }>;
    expect(networkBlock.accessory?.url).toBe(
      'https://etherscan.io/address/0x2222222222222222222222222222222222222222'
    );
  });

  it('section uses a field grid with bridge/duration/source/Δdest/unified', () => {
    const blocks = buildSummaryBlocks(
      summarize('testnet', [
        baseResult({
          durationMs: 5000,
          sourceChains: [{ id: 1, name: 'Eth' }],
          destDelta: '0.10000000000000142',
          unifiedBefore: '12.3456789',
          unifiedAfter: '12.2456789',
        }),
      ])
    );
    expect(findSection(blocks).fields).toEqual([
      { type: 'mrkdwn', text: '*Bridge:*\nfulfilled' },
      { type: 'mrkdwn', text: '*Duration:*\n5.0s' },
      { type: 'mrkdwn', text: '*Source:*\nEth' },
      { type: 'mrkdwn', text: '*Δdest:*\n0.1' },
      { type: 'mrkdwn', text: '*Unified USDC:*\n12.3456 → 12.2456' },
    ]);
  });

  it('attaches an Explorer button when intentUrl is present', () => {
    const blocks = buildSummaryBlocks(
      summarize('testnet', [baseResult({ intentUrl: 'https://explorer/x' })])
    );
    expect(findSection(blocks).accessory).toEqual({
      type: 'button',
      text: { type: 'plain_text', text: ':mag: View on Explorer', emoji: true },
      url: 'https://explorer/x',
    });
  });

  it('omits the Explorer accessory when intentUrl is absent', () => {
    const blocks = buildSummaryBlocks(summarize('testnet', [baseResult()]));
    expect(findSection(blocks).accessory).toBeUndefined();
  });

  it('emits a context block under the section for errorMsg', () => {
    const blocks = buildSummaryBlocks(
      summarize('testnet', [
        baseResult({
          status: 'failed',
          exitCode: 1,
          bridgeStatus: 'failed',
          errorMsg: 'middleware 500',
        }),
      ])
    );
    const errorCtx = blocks.find(
      (b): b is Extract<Block, { type: 'context' }> =>
        b.type === 'context' && b.elements[0].text.includes('Bridge error')
    );
    expect(errorCtx?.elements[0].text).toBe('❌ Bridge error: middleware 500');
  });

  it('emits a context block for balanceError', () => {
    const blocks = buildSummaryBlocks(
      summarize('testnet', [
        baseResult({ balanceStatus: 'before_failed', balanceError: 'rpc down' }),
      ])
    );
    const balanceCtx = blocks.find(
      (b): b is Extract<Block, { type: 'context' }> =>
        b.type === 'context' && b.elements[0].text.includes('Balance error')
    );
    expect(balanceCtx?.elements[0].text).toBe('⚠️ Balance error: rpc down');
  });

  it('renders fatalLine as a section when no tests ran', () => {
    const blocks = buildSummaryBlocks(
      summarize('testnet', [], '❌ list-chains returned no chains for network=testnet')
    );
    expect(blocks[0]).toEqual({
      type: 'header',
      text: {
        type: 'plain_text',
        text: '❌ E2E Tests Crashed: list-chains returned no chains for network=testnet',
        emoji: true,
      },
    });
    expect(findSection(blocks).text).toEqual({
      type: 'mrkdwn',
      text: '❌ list-chains returned no chains for network=testnet',
    });
  });

  it('does not emit a trailing divider when there are no settleLines', () => {
    const blocks = buildSummaryBlocks(summarize('testnet', [baseResult()]));
    expect(blocks.at(-1)?.type).not.toBe('divider');
  });
});
