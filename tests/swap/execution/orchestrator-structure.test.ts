import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('swap execution orchestration ownership', () => {
  it('keeps the stage sequence in the swap feature instead of the public flow', () => {
    expect(() =>
      readFileSync(
        resolve(repositoryRoot, 'src/swap/execution/orchestrator.ts'),
        'utf8'
      )
    ).not.toThrow();

    const flow = readFileSync(resolve(repositoryRoot, 'src/flows/swap.ts'), 'utf8');
    expect(flow).toContain("from '../swap/execution/orchestrator'");
    expect(flow).not.toContain("from '../swap/execution/source-swaps'");
    expect(flow).not.toContain("from '../swap/execution/bridge'");
    expect(flow).not.toContain("from '../swap/execution/destination-swap'");
    expect(flow).not.toContain("from '../swap/execution/failure-cleanup'");
  });
});
