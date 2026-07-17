import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

const readSource = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('swap simplification guardrails', () => {
  it('does not retain unreachable collection-fee selection branches', () => {
    const source = readSource('src/swap/algorithms/auto-select.ts');

    expect(source).not.toContain('feeApplies');
    expect(source).not.toContain('lookupChainCollectionFee');
    expect(source).not.toContain('collectionFeeSecured');
  });

  it('collects explicit source chains through one mode-independent loop', () => {
    const source = readSource('src/swap/preflight.ts');
    const sourceLoops = source.match(/for \(const source of input\.data\.sources \?\? \[\]\)/g);

    expect(sourceLoops).toHaveLength(1);
  });

  it('builds deterministic funding transfers through one shared loop', () => {
    const source = readSource('src/swap/prepare.ts');
    const buildCalls = source.match(/await buildPreparedTransfer\(/g);

    expect(buildCalls).toHaveLength(1);
  });

  it('names the mode-local routing phases instead of hiding them in one route body', () => {
    const exactIn = readSource('src/swap/routing/exact-in.ts');
    const exactOut = readSource('src/swap/routing/exact-out.ts');

    expect(exactIn).toContain('resolveExactInProviderAndHoldings');
    expect(exactIn).toContain('partitionExactInHoldings');
    expect(exactIn).toContain('buildExactInBridge');
    expect(exactOut).toContain('resolveExactOutDestinationRequirement');
    expect(exactOut).toContain('tryExactOutFastPaths');
    expect(exactOut).toContain('resolveExactOutProvider');
    expect(exactOut).toContain('buildExactOutBridge');
  });
});
