/**
 * gbrain sources set-strategy <id> <markdown|code|auto>
 *
 * Persists the per-source sync strategy in sources.config.strategy so the
 * auto-sync cycle (which reads `cfg.strategy ?? 'markdown'`) keeps classifying
 * files the same way on every incremental run. Without it, a per-run
 * `sync --strategy code|auto` is forgotten and changed code files revert to
 * prose.
 *
 * Validates:
 *   - Happy path: writes config.strategy for each of markdown|code|auto
 *   - Invalid strategy → exit code 2 with usage
 *   - Missing source id → exit code 4
 *   - Missing arguments → exit code 2
 *   - Other config fields (e.g. federated) are preserved
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { runSources } from '../src/commands/sources.ts';

describe('gbrain sources set-strategy', () => {
  let engine: PGLiteEngine;
  let origExit: typeof process.exit;
  let exitCode: number | null;

  beforeAll(async () => {
    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();
  });

  afterAll(async () => {
    await engine.disconnect();
    process.exit = origExit;
  });

  beforeEach(async () => {
    await resetPgliteState(engine);
    exitCode = null;
    origExit = process.exit;
    (process as unknown as { exit: (n: number) => never }).exit = ((n: number) => {
      exitCode = n;
      throw new Error(`__test_exit_${n}__`);
    }) as never;
  });

  async function seedSource(id: string, config = '{}'): Promise<void> {
    await engine.executeRaw(
      `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, id, config],
    );
  }

  async function readStrategy(id: string): Promise<string | null> {
    const rows = await engine.executeRaw<{ strategy: string | null }>(
      `SELECT config->>'strategy' AS strategy FROM sources WHERE id = $1`,
      [id],
    );
    return rows[0]?.strategy ?? null;
  }

  test('happy path: set to "code"', async () => {
    await seedSource('test-src');
    await runSources(engine, ['set-strategy', 'test-src', 'code']);
    expect(await readStrategy('test-src')).toBe('code');
  });

  test('happy path: set to "auto"', async () => {
    await seedSource('test-src');
    await runSources(engine, ['set-strategy', 'test-src', 'auto']);
    expect(await readStrategy('test-src')).toBe('auto');
  });

  test('happy path: set to "markdown"', async () => {
    await seedSource('test-src');
    await runSources(engine, ['set-strategy', 'test-src', 'markdown']);
    expect(await readStrategy('test-src')).toBe('markdown');
  });

  test('rejection: invalid strategy → exit 2', async () => {
    await seedSource('test-src');
    try {
      await runSources(engine, ['set-strategy', 'test-src', 'prose']);
    } catch (err) {
      expect((err as Error).message).toContain('__test_exit_2__');
    }
    expect(exitCode).toBe(2);
    expect(await readStrategy('test-src')).toBeNull(); // no mutation
  });

  test('rejection: missing source id → exit 4', async () => {
    try {
      await runSources(engine, ['set-strategy', 'nonexistent-source', 'code']);
    } catch (err) {
      expect((err as Error).message).toContain('__test_exit_4__');
    }
    expect(exitCode).toBe(4);
  });

  test('rejection: missing arguments → exit 2', async () => {
    try {
      await runSources(engine, ['set-strategy']);
    } catch (err) {
      expect((err as Error).message).toContain('__test_exit_2__');
    }
    expect(exitCode).toBe(2);
  });

  test('rejection: missing strategy (only id) → exit 2', async () => {
    await seedSource('test-src');
    try {
      await runSources(engine, ['set-strategy', 'test-src']);
    } catch (err) {
      expect((err as Error).message).toContain('__test_exit_2__');
    }
    expect(exitCode).toBe(2);
    expect(await readStrategy('test-src')).toBeNull();
  });

  test('preserves other config fields (federated)', async () => {
    await seedSource('test-src', '{"federated": true}');
    await runSources(engine, ['set-strategy', 'test-src', 'auto']);
    const rows = await engine.executeRaw<{ federated: boolean | null; strategy: string | null }>(
      `SELECT (config->>'federated')::boolean AS federated, config->>'strategy' AS strategy
       FROM sources WHERE id = 'test-src'`,
    );
    expect(rows[0].strategy).toBe('auto');
    expect(rows[0].federated).toBe(true);
  });
});
