/**
 * Type-level drift assertion: `OperationName` (in `src/domain/errors.ts`) must stay
 * in sync with the public async surface of `NexusClient` plus the explicitly-tracked
 * exported utility helpers. This test file is consumed by `npm run typecheck:tests`
 * (which runs `tsc --noEmit -p tsconfig.tests.json`) — if drift happens, the file
 * fails to compile.
 *
 * Why this lives at the assembly layer (`tests/core/`): `src/domain/errors.ts` cannot
 * import from `src/core/` (package boundary), so we can't derive `OperationName` from
 * `NexusClient` directly. This test sits at a layer that can legitimately see both.
 */

import type { NexusClient } from '../../src/core/types';
import type { NexusUtils } from '../../src/core/utils';
import type { OperationName } from '../../src/domain/errors';

type AsyncMethodNames<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof T];

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/**
 * Hand-maintained list of utility helpers that get OTel boundary coverage.
 * Adding a name here without exporting it as an async function on `NexusUtils`
 * makes the utility-coverage check below fail.
 */
type CoveredUtilityNames = 'getCoinbaseRates' | 'getSupportedChains';

// ── Client method coverage ────────────────────────────────────────────────
// Every async member of NexusClient must appear in OperationName. The reverse
// is also enforced — adding a non-client name to OperationName breaks this.
type RequiredClientNames = Extract<AsyncMethodNames<NexusClient>, string>;
type ClientCoverageOk = Equal<RequiredClientNames, Exclude<OperationName, CoveredUtilityNames>>;
const _clientCoverageOk: ClientCoverageOk = true;
void _clientCoverageOk;

// ── Utility coverage ──────────────────────────────────────────────────────
// Every declared utility name must correspond to an async function on NexusUtils.
type UtilityCoverageOk = CoveredUtilityNames extends Extract<AsyncMethodNames<NexusUtils>, string>
  ? true
  : false;
const _utilityCoverageOk: UtilityCoverageOk = true;
void _utilityCoverageOk;
