/**
 * MQL #include graph — end-to-end, source-scoped.
 *
 * `#include` is what binds an MQL product's modules together (the build pulls
 * in the transitive closure of includes). This indexes each `#include` as a
 * file→file edge (edge_type 'imports') keyed on a normalized file identity
 * (basename without extension), so the existing code-intel queries answer:
 *   - getCallersOf('Worker')  → "what includes Worker.mqh"
 *   - getCalleesOf('Holder')  → "what does Holder.mqh include"
 * and `getCalleesOf` chains for transitive build-closure.
 *
 * v1 ceiling (documented, not solved here): file identity is the bare basename,
 * so two same-named files in different directories collide; header-only files
 * with no anchorable chunk are skipped.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { importCodeFile } from '../src/core/import-file.ts';
import { runSources } from '../src/commands/sources.ts';

const WORKER_MQH = `class CWorker
{
public:
   double DoWork(double x) { return x * 2.0; }
};
`;

const HOLDER_MQH = `#include "Worker.mqh"

class CHolder
{
private:
   CWorker m_worker;
public:
   double Run(double x) { return m_worker.DoWork(x); }
};
`;

const SRC = 'mql-indicators';
let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  await runSources(engine, ['add', SRC, '--no-federated']);
  await importCodeFile(engine, 'Include/Worker.mqh', WORKER_MQH, { noEmbed: true, sourceId: SRC });
  await importCodeFile(engine, 'Include/Holder.mqh', HOLDER_MQH, { noEmbed: true, sourceId: SRC });
}, 60_000);

afterAll(async () => {
  if (engine) await engine.disconnect();
}, 30_000);

describe('MQL — #include graph (source-scoped)', () => {
  test('getCallersOf(Worker) → "what includes Worker.mqh"', async () => {
    const callers = await engine.getCallersOf('Worker', { sourceId: SRC });
    const inc = callers.filter(c => c.edge_type === 'imports');
    expect(inc.some(c => c.from_symbol_qualified === 'Holder')).toBe(true);
  });

  test('getCalleesOf(Holder) → "what does Holder.mqh include"', async () => {
    const callees = await engine.getCalleesOf('Holder', { sourceId: SRC });
    expect(callees.some(c => c.edge_type === 'imports' && c.to_symbol_qualified === 'Worker')).toBe(true);
  });

  test('include edges are source-isolated', async () => {
    const other = await engine.getCallersOf('Worker', { sourceId: 'default' });
    expect(other.some(c => c.edge_type === 'imports')).toBe(false);
  });
});
