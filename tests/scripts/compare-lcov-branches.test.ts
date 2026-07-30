import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), 'scripts/compare-lcov-branches.mjs');
const temporaryDirectories: string[] = [];

const writeLcov = async (contents: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-lcov-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'lcov.info');
  await writeFile(path, contents);
  return path;
};

const runComparator = async (baseline: string, current: string) => {
  try {
    const result = await execFileAsync(process.execPath, [scriptPath, baseline, current]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as Error & { code: number; stdout: string; stderr: string };
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('compare-lcov-branches', () => {
  it('reports exact newly uncovered branch identities and recursive scope deltas', async () => {
    const baseline = await writeLcov(`TN:
SF:/repo/src/swap/execution/bridge.ts
BRDA:10,0,0,1
BRDA:11,0,1,1
end_of_record
SF:/repo/src/swap/route.ts
BRDA:20,0,0,1
end_of_record
SF:/repo/src/flows/swap.ts
BRDA:30,0,0,1
end_of_record
`);
    const current = await writeLcov(`TN:
SF:/repo/src/swap/execution/bridge.ts
BRDA:10,0,0,0
BRDA:11,0,1,1
end_of_record
SF:/repo/src/swap/route.ts
BRDA:20,0,0,1
end_of_record
SF:/repo/src/flows/swap.ts
BRDA:30,0,0,1
end_of_record
`);

    const result = await runComparator(baseline, current);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'src/swap/**: 3/3 (100.00%) -> 2/3 (66.67%) (-33.33 pp)'
    );
    expect(result.stdout).toContain(
      'src/swap/execution/**: 2/2 (100.00%) -> 1/2 (50.00%) (-50.00 pp)'
    );
    expect(result.stdout).toContain(
      'src/swap/execution/bridge.ts:10 (block 0, branch 0; baseline 1, current 0)'
    );
  });

  it('succeeds when every previously covered branch remains covered', async () => {
    const baseline = await writeLcov(`TN:
SF:/repo/src/swap/route.ts
BRDA:20,0,0,1
end_of_record
`);
    const current = await writeLcov(`TN:
SF:/repo/src/swap/route.ts
BRDA:20,0,0,2
end_of_record
`);

    const result = await runComparator(baseline, current);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Newly uncovered branches: none');
  });

  it('ignores branch identity churn outside production source files', async () => {
    const baseline = await writeLcov(`TN:
SF:/repo/src/swap/route.ts
BRDA:20,0,0,1
end_of_record
SF:/repo/tests/helpers/swap.ts
BRDA:40,0,0,3
end_of_record
`);
    const current = await writeLcov(`TN:
SF:/repo/src/swap/route.ts
BRDA:20,0,0,1
end_of_record
`);

    const result = await runComparator(baseline, current);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Newly uncovered branches: none');
    expect(result.stdout).not.toContain('tests/helpers/swap.ts');
  });
});
