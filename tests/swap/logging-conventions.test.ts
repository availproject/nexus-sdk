import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

const collectTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return extname(entry.name) === '.ts' ? [path] : [];
  });

const sourceFiles = [...collectTypeScriptFiles(join(root, 'src/swap')), join(root, 'src/flows/swap.ts')];

const debugCalls = sourceFiles.flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  const totalCalls = source.match(/logger\.debug\s*\(/g)?.length ?? 0;
  const literalCalls = [...source.matchAll(/logger\.debug\s*\(\s*(['"])(.*?)\1/g)].map(
    (match) => ({ file: relative(root, file), message: match[2] })
  );
  return [{ file: relative(root, file), totalCalls, literalCalls }];
});

describe('swap debug logging contract', () => {
  it('uses a literal message at every production debug call site', () => {
    for (const entry of debugCalls) {
      expect(entry.literalCalls.length, entry.file).toBe(entry.totalCalls);
    }
  });

  it('uses the swap.<stage>.<operation>.<event> taxonomy', () => {
    for (const { file, literalCalls } of debugCalls) {
      for (const { message } of literalCalls) {
        expect(message, `${file}: ${message}`).toMatch(
          /^swap(?:\.[a-z0-9]+(?:_[a-z0-9]+)*){3,}$/
        );
      }
    }
  });

  it('keeps every full debug message unique to one production call site', () => {
    const callSites = new Map<string, string[]>();
    for (const { literalCalls } of debugCalls) {
      for (const { file, message } of literalCalls) {
        callSites.set(message, [...(callSites.get(message) ?? []), file]);
      }
    }

    for (const [message, files] of callSites) {
      expect(files, message).toHaveLength(1);
    }
  });

  it('links the detailed logging standard from repository conventions', () => {
    const guide = join(root, 'src/domain/utils/logs.md');
    expect(existsSync(guide)).toBe(true);
    expect(readFileSync(join(root, 'docs/CONVENTIONS.md'), 'utf8')).toContain(
      'src/domain/utils/logs.md'
    );
  });
});
