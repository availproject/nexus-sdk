import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/**
 * Layering rules — each entry forbids any file under `from` from importing
 * anything that resolves under any of the `to` directories. The check is
 * textual (grep-style) on `from`/`require` import strings; it matches
 * `'.../<target>'` and `'.../<target>/something'`.
 *
 * Add rules as the layering contract tightens. Today:
 * - services must not depend on flows (pre-existing).
 * - analytics must not depend on core/sdk or feature-specific layers (added
 *   alongside the `operation-boundary.ts` extraction: typed-op wrappers and
 *   the BridgeOperationOptions/SwapResult types live in core/swap; the
 *   analytics layer stays generic).
 */
const RULES = [
  { from: 'src/services', forbidden: ['flows'] },
  { from: 'src/analytics', forbidden: ['core', 'swap', 'execute', 'flows', 'bridge'] },
];

const walk = (dir, files = []) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files; // dir doesn't exist — silently skip
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }
  return files;
};

// No `g` flag: `RegExp.test` with `g` is stateful via `lastIndex`, which can
// silently skip matches when the same regex is reused across files. We only
// need yes/no "does this string contain a match" semantics here.
const buildPatterns = (target) => [
  new RegExp(String.raw`from\s+['"][^'"]*\/${target}(?:\/[^'"]*)?['"]`),
  new RegExp(String.raw`require\(['"][^'"]*\/${target}(?:\/[^'"]*)?['"]\)`),
];

const violations = [];

for (const { from, forbidden } of RULES) {
  const dir = join(ROOT, from);
  const files = walk(dir);
  for (const target of forbidden) {
    const patterns = buildPatterns(target);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (patterns.some((re) => re.test(content))) {
        violations.push({ file, from, target });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Dependency direction violations:');
  for (const { file, from, target } of violations) {
    console.error(`- ${file}: ${from} must not import ${target}`);
  }
  process.exit(1);
}
