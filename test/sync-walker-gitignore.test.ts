/**
 * Walker `.gitignore`-honoring regression tests.
 *
 * Closes the bug class where `collectSyncableFiles` walked gitignored content
 * on disk (build outputs, generated artifacts, vendored caches) and ingested
 * it. The walker already skips `.git`, `node_modules`, `ops`, and dot-dirs;
 * gitignored files are the same class of non-source noise. Pins:
 *
 * 1. Gitignored files and directories are skipped; non-ignored files collected.
 * 2. A nested gitignored directory is skipped wholesale.
 * 3. Non-git directories degrade to no filtering (prior behavior preserved).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectSyncableFiles } from '../src/commands/import.ts';
import { withEnv } from './helpers/with-env.ts';

let tmp: string;

function gitInit(dir: string): void {
  // `git ls-files --others --ignored --exclude-standard` needs an initialized
  // work tree and a `.gitignore`; no commits or user identity are required.
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
}

// Paths relative to `tmp`, normalized to forward slashes so assertions hold on
// both POSIX and Windows (`join` yields `\` on Windows).
function rel(files: string[]): string[] {
  return files.map(f => f.replace(tmp, '').replace(/\\/g, '/'));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gbrain-gitignore-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('collectSyncableFiles honors .gitignore', () => {
  test('1. gitignored files and dirs are skipped; tracked files collected', async () => {
    await withEnv({ GBRAIN_EMBEDDING_MULTIMODAL: undefined }, () => {
      gitInit(tmp);
      writeFileSync(join(tmp, '.gitignore'), 'build/\nsecret.md\n');
      writeFileSync(join(tmp, 'real.md'), '# real\n');
      writeFileSync(join(tmp, 'secret.md'), '# secret\n');
      mkdirSync(join(tmp, 'build'));
      writeFileSync(join(tmp, 'build', 'generated.md'), '# generated\n');

      const names = rel(collectSyncableFiles(tmp, { strategy: 'markdown' }));

      expect(names).toContain('/real.md');
      expect(names).not.toContain('/secret.md');
      expect(names.every(n => !n.startsWith('/build/'))).toBe(true);
    });
  });

  test('2. nested gitignored directory is skipped wholesale', async () => {
    await withEnv({ GBRAIN_EMBEDDING_MULTIMODAL: undefined }, () => {
      gitInit(tmp);
      writeFileSync(join(tmp, '.gitignore'), 'artifacts/\n');
      mkdirSync(join(tmp, 'docs'), { recursive: true });
      writeFileSync(join(tmp, 'docs', 'guide.md'), '# guide\n');
      mkdirSync(join(tmp, 'artifacts', 'deep', 'nested'), { recursive: true });
      writeFileSync(join(tmp, 'artifacts', 'deep', 'nested', 'report.md'), '# report\n');

      const names = rel(collectSyncableFiles(tmp, { strategy: 'markdown' }));

      expect(names).toContain('/docs/guide.md');
      expect(names.every(n => !n.startsWith('/artifacts/'))).toBe(true);
    });
  });

  test('3. non-git directory degrades to no filtering', async () => {
    await withEnv({ GBRAIN_EMBEDDING_MULTIMODAL: undefined }, () => {
      // No `git init`: a stray `.gitignore` has no effect, so the file it
      // would ignore is still collected — the walker is unchanged for
      // non-git sources.
      writeFileSync(join(tmp, '.gitignore'), 'ignored.md\n');
      writeFileSync(join(tmp, 'kept.md'), '# kept\n');
      writeFileSync(join(tmp, 'ignored.md'), '# still collected\n');

      const names = rel(collectSyncableFiles(tmp, { strategy: 'markdown' }));

      expect(names).toContain('/kept.md');
      expect(names).toContain('/ignored.md');
    });
  });
});
