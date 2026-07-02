import process from 'node:process';
import { fileURLToPath } from 'node:url';

export type CliArgs = Record<string, string>;

// Tiny --flag/--flag value parser. A flag without a following value (e.g.
// the last token, or followed by another --flag) is stored as the string
// 'true' so callers can branch on presence without a separate boolean shape.
export const parseFlags = (argv: string[] = process.argv): CliArgs => {
  const out: CliArgs = {};
  for (let i = 2; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t?.startsWith('--')) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
};

// Run `main(args)` only when the calling file was invoked directly (e.g.
// `tsx packages/tools/src/e2e/balance-check.ts --mode before`). When the
// file is imported as a module, this is a no-op.
//
// Errors thrown by `main` are surfaced as `${errorPrefix}: ${message}` on
// stderr and set process.exitCode = 1. The CLI is free to set a different
// exitCode itself (e.g. 2 for "result not ok") inside `main` before
// returning normally.
export const runIfMain = (
  importMetaUrl: string,
  main: (args: CliArgs) => Promise<void>,
  errorPrefix: string
): void => {
  if (process.argv[1] !== fileURLToPath(importMetaUrl)) return;
  main(parseFlags()).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${errorPrefix}: ${message}\n`);
    process.exitCode = 1;
  });
};
