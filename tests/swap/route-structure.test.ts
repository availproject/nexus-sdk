import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('swap routing module structure', () => {
  it('keeps route.ts as a small facade over mode-owned routing modules', () => {
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

    const facade = readFileSync(resolve(repositoryRoot, 'src/swap/route.ts'), 'utf8');
    expect(facade.split('\n').length).toBeLessThan(150);
  });
});
