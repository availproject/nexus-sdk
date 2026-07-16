import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import rollupConfigs from '../../rollup.config.mjs';

const packageJson = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8')
);

describe('Rollup dependency externalization', () => {
  it('uses one external predicate for JavaScript and declaration builds', () => {
    const predicates = rollupConfigs.map((config) => config.external);

    for (const predicate of predicates) {
      expect(typeof predicate).toBe('function');
    }
    expect(new Set(predicates).size).toBe(1);
  });

  it('externalizes every declared dependency and its subpaths', () => {
    const external = rollupConfigs[0].external;

    expect(typeof external).toBe('function');
    if (typeof external !== 'function') return;

    for (const dependency of Object.keys(packageJson.dependencies)) {
      expect(external(dependency)).toBe(true);
      expect(external(`${dependency}/subpath`)).toBe(true);
    }
  });

  it('preserves Node built-ins without matching dependency prefix collisions', () => {
    const external = rollupConfigs[0].external;

    expect(typeof external).toBe('function');
    if (typeof external !== 'function') return;

    expect(external('crypto')).toBe(true);
    expect(external('node:crypto')).toBe(true);
    expect(external('@avail-project/nexus-types-extra')).toBe(false);
    expect(external('axios-retry')).toBe(false);
    expect(external('./domain')).toBe(false);
  });
});
