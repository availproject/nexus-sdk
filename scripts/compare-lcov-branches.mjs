import { readFile } from 'node:fs/promises';
import process from 'node:process';

const SCOPE_PREFIXES = [
  ['src/swap/**', 'src/swap/'],
  ['src/swap/execution/**', 'src/swap/execution/'],
  ['src/flows/**', 'src/flows/'],
];

const normalizeSourcePath = (sourcePath) => {
  const normalized = sourcePath.replaceAll('\\', '/');
  for (const root of ['src/', 'packages/', 'tests/']) {
    if (normalized.startsWith(root)) {
      return normalized;
    }

    const rootIndex = normalized.lastIndexOf(`/${root}`);
    if (rootIndex >= 0) {
      return normalized.slice(rootIndex + 1);
    }
  }

  return normalized;
};

const branchKey = ({ source, line, block, branch }) =>
  `${source}\u0000${line}\u0000${block}\u0000${branch}`;

export const parseLcovBranches = (contents) => {
  const branches = new Map();
  let source;

  for (const line of contents.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      source = normalizeSourcePath(line.slice(3));
      continue;
    }

    if (line === 'end_of_record') {
      source = undefined;
      continue;
    }

    if (!source || !line.startsWith('BRDA:')) {
      continue;
    }

    const [lineNumber, block, branch, rawTaken] = line.slice(5).split(',');
    if (!lineNumber || block === undefined || branch === undefined || rawTaken === undefined) {
      continue;
    }

    const identity = {
      source,
      line: Number(lineNumber),
      block,
      branch,
    };
    const key = branchKey(identity);
    const taken = rawTaken === '-' ? 0 : Number(rawTaken);
    const existing = branches.get(key);
    branches.set(key, {
      ...identity,
      taken: (existing?.taken ?? 0) + (Number.isFinite(taken) ? taken : 0),
    });
  }

  return branches;
};

const summarizeScope = (branches, prefix) => {
  const selected = [...branches.values()].filter(({ source }) => source.startsWith(prefix));
  const covered = selected.filter(({ taken }) => taken > 0).length;
  const total = selected.length;
  return {
    covered,
    total,
    percentage: total === 0 ? 100 : (covered / total) * 100,
  };
};

const formatDelta = (delta) => `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pp`;

export const compareLcovBranches = (baselineContents, currentContents) => {
  const baseline = parseLcovBranches(baselineContents);
  const current = parseLcovBranches(currentContents);
  const summaries = SCOPE_PREFIXES.map(([label, prefix]) => {
    const before = summarizeScope(baseline, prefix);
    const after = summarizeScope(current, prefix);
    return { label, before, after };
  });
  const newlyUncovered = [...baseline.entries()]
    .filter(([, branch]) => branch.source.startsWith('src/'))
    .filter(([, branch]) => branch.taken > 0)
    .filter(([key]) => (current.get(key)?.taken ?? 0) === 0)
    .map(([key, branch]) => ({ ...branch, currentTaken: current.get(key)?.taken }))
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.line - right.line ||
        left.block.localeCompare(right.block) ||
        left.branch.localeCompare(right.branch)
    );

  return { summaries, newlyUncovered };
};

const renderComparison = ({ summaries, newlyUncovered }) => {
  const lines = ['LCOV branch comparison', ''];

  for (const { label, before, after } of summaries) {
    lines.push(
      `${label}: ${before.covered}/${before.total} (${before.percentage.toFixed(2)}%) -> ` +
        `${after.covered}/${after.total} (${after.percentage.toFixed(2)}%) ` +
        `(${formatDelta(after.percentage - before.percentage)})`
    );
  }

  lines.push('');
  if (newlyUncovered.length === 0) {
    lines.push('Newly uncovered branches: none');
  } else {
    lines.push(`Newly uncovered branches (${newlyUncovered.length}):`);
    for (const branch of newlyUncovered) {
      lines.push(
        `- ${branch.source}:${branch.line} (block ${branch.block}, branch ${branch.branch}; ` +
          `baseline ${branch.taken}, current ${branch.currentTaken ?? 'missing'})`
      );
    }
  }

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const [, , baselinePath, currentPath] = process.argv;
  if (!baselinePath || !currentPath) {
    console.error(
      'Usage: node scripts/compare-lcov-branches.mjs <baseline-lcov.info> <current-lcov.info>'
    );
    process.exitCode = 2;
    return;
  }

  try {
    const [baseline, current] = await Promise.all([
      readFile(baselinePath, 'utf8'),
      readFile(currentPath, 'utf8'),
    ]);
    const comparison = compareLcovBranches(baseline, current);
    process.stdout.write(renderComparison(comparison));
    if (comparison.newlyUncovered.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
