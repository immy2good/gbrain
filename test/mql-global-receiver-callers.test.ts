/**
 * File-scope GLOBAL object receiver resolution.
 *
 * Real MQL indicators wire the entry layer (OnInit/OnCalculate/OnChartEvent) to
 * their class internals through file-scope global singletons:
 *
 *     CUnifiedDashboard g_dashboard;          // file scope
 *     void OnInit() { g_dashboard.Refresh(); }
 *
 * Member-field (`m_x.M()`) and local-object receivers already resolve to the
 * receiver's declared class type. A GLOBAL object declared at translation-unit
 * scope is the same mechanism applied to the file-scope symbol table — without
 * it, the dominant indicator→class boundary stays bare and `code_blast` can't
 * climb from a class method to the indicator's entry points.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { importCodeFile } from '../src/core/import-file.ts';
import { runSources } from '../src/commands/sources.ts';

const SRC = 'mql-indicators';

const DASH_MQH = `class CDash
{
public:
   void Refresh(void) { Repaint(); }
   void Repaint(void) {}
};
`;

// The global singleton is declared AND used in the indicator file — the exact
// shape of the confluence MT5 indicators (CUnifiedDashboard g_dashboard; …).
const INDICATOR_MQ5 = `#include "Dash.mqh"

CDash g_dashboard;

void OnInit()
{
   g_dashboard.Refresh();
}
`;

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  await runSources(engine, ['add', SRC, '--no-federated']);
  await importCodeFile(engine, 'Include/Dash.mqh', DASH_MQH, { noEmbed: true, sourceId: SRC });
  await importCodeFile(engine, 'Indicators/Probe.mq5', INDICATOR_MQ5, { noEmbed: true, sourceId: SRC });
}, 60_000);

afterAll(async () => {
  if (engine) await engine.disconnect();
}, 30_000);

describe('MQL — file-scope global object receiver resolution', () => {
  test('g_dashboard.Refresh() in OnInit keys on the global type (CDash.Refresh)', async () => {
    const callees = await engine.getCalleesOf('OnInit', { allSources: true });
    expect(callees.some(c => c.to_symbol_qualified === 'CDash.Refresh')).toBe(true);
  });

  test('getCallersOf(CDash.Refresh) finds the entry-point caller OnInit', async () => {
    const callers = await engine.getCallersOf('CDash.Refresh', { allSources: true });
    expect(callers.some(c => c.from_symbol_qualified.includes('OnInit'))).toBe(true);
  });
});
