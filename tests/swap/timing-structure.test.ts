import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceFiles = [
  'src/flows/swap.ts',
  'src/swap/prepare.ts',
  'src/swap/routing/exact-in.ts',
  'src/swap/routing/exact-out.ts',
  'src/swap/routing/fast-paths.ts',
  'src/swap/execution/source-swaps.ts',
  'src/swap/execution/bridge.ts',
  'src/swap/execution/destination-swap.ts',
  'src/swap/execution/orchestrator.ts',
].map((path) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8'));

const source = sourceFiles.join('\n');

const expectedSpans = [
  'flow.swap.route.resolve_sources',
  'flow.swap.route.classify_path',
  'flow.swap.route.quote_destination_requirement',
  'flow.swap.route.resolve_settlement',
  'flow.swap.route.resolve_provider',
  'flow.swap.route.select_sources',
  'flow.swap.route.build_bridge',
  'flow.swap.route.quote_destination',
  'flow.swap.route.assemble',
  'flow.swap.prepare.queue_cache',
  'flow.swap.prepare.cache_start',
  'flow.swap.prepare.cache_wait',
  'flow.swap.prepare.parse_quotes',
  'flow.swap.prepare.build_transfers',
  'flow.swap.execute.source.build_calls',
  'flow.swap.execute.source.dispatch',
  'flow.swap.execute.source.wait_receipt',
  'flow.swap.execute.source.requote',
  'flow.swap.execute.source.read_actual_balance',
  'flow.swap.execute.bridge.prepare_funding',
  'flow.swap.execute.bridge.refresh_mayan_quotes',
  'flow.swap.execute.bridge.submit_intent',
  'flow.swap.execute.bridge.deposit',
  'flow.swap.execute.bridge.wait_fill',
  'flow.swap.execute.destination.read_balance',
  'flow.swap.execute.destination.resize_or_requote',
  'flow.swap.execute.destination.build_calls',
  'flow.swap.execute.destination.dispatch',
  'flow.swap.execute.destination.wait_receipt',
  'flow.swap.execute.cleanup',
] as const;

describe('swap nested timing instrumentation', () => {
  it.each(expectedSpans)('contains the %s span', (span) => {
    expect(source).toContain(`'${span}'`);
  });
});
