import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('swap routing module structure', () => {
  it('keeps mode-owned routing modules in place', () => {
    const expectedModules = [
      'exact-in.ts',
      'exact-out.ts',
      'holdings.ts',
      'addresses.ts',
      'bridge.ts',
      'fast-paths.ts',
    ];

    for (const module of expectedModules) {
      expect(() =>
        readFileSync(resolve(repositoryRoot, 'src/swap/routing', module), 'utf8')
      ).not.toThrow();
    }
  });
});
