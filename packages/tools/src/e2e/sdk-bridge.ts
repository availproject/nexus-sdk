// Root package.json has no "type": "module", so the SDK source is treated as
// CJS when tsx loads it from this ESM package. Named imports across that
// boundary lose their names and only surface on `.default`. This file does
// the namespace-import-and-pick dance once so callers can use clean names.
// Mirrors the pattern already used for sdkCore in balance-check.ts /
// list-chains.ts / check-settlements.ts.

import * as sdkErrors from '../../../../src/domain/errors';
import * as sdkUtils from '../../../../src/utils';

type Utils = typeof import('../../../../src/utils');
type Errors = typeof import('../../../../src/domain/errors');

const pick = <M, K extends keyof M>(ns: unknown, key: K, source: string): M[K] => {
  const mod = ns as Partial<M> & { default?: Partial<M> };
  const value = mod[key] ?? mod.default?.[key];
  if (value === undefined) {
    throw new Error(`Failed to load ${String(key)} from SDK ${source} export.`);
  }
  return value as M[K];
};

export const formatTokenBalance = pick<Utils, 'formatTokenBalance'>(
  sdkUtils,
  'formatTokenBalance',
  '/utils'
);

export const NexusError = pick<Errors, 'NexusError'>(sdkErrors, 'NexusError', '/domain/errors');
