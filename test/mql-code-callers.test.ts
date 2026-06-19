/**
 * MQL code-intelligence — end-to-end code-callers / code-callees.
 *
 * Imports a real-derived MQL class into PGLite and asserts the intra-class
 * call edge (CalculatePips -> PriceToPips) is queryable via getCallersOf /
 * getCalleesOf. This is the slice-1 tracer bullet: a call edge usable
 * end-to-end for MQL through importCodeFile, not just harvested by the chunker.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { importCodeFile } from '../src/core/import-file.ts';

// Derived from itradeaims-indicators mt4/Include/AIMS/Utils/PipCalculator.mqh.
const PIP_CALCULATOR_MQH = `#property strict

class CPipCalculator
{
private:
   double m_pointSize;

public:
   double PriceToPips(double priceDifference)
   {
      if(m_pointSize == 0) return 0;
      return MathAbs(priceDifference) / m_pointSize;
   }

   double CalculatePips(double price1, double price2)
   {
      return PriceToPips(price1 - price2);
   }
};
`;

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  await importCodeFile(
    engine,
    'Include/AIMS/Utils/PipCalculator.mqh',
    PIP_CALCULATOR_MQH,
    { noEmbed: true },
  );
}, 60_000);

afterAll(async () => {
  if (engine) await engine.disconnect();
}, 30_000);

describe('MQL — code-callers / code-callees end-to-end', () => {
  test('CalculatePips is a caller of PriceToPips', async () => {
    const callers = await engine.getCallersOf('PriceToPips', { allSources: true });
    const hit = callers.find(r => r.from_symbol_qualified.includes('CalculatePips'));
    expect(hit).toBeDefined();
    expect(hit!.edge_type).toBe('calls');
  });

  // Query semantics: getCallersOf/getCalleesOf match the edge's qualified name
  // EXACTLY. The implicit call `PriceToPips(...)` emits a bare-token edge
  // (to = 'PriceToPips'), while the caller chunk carries its qualified name
  // (from = 'CPipCalculator.CalculatePips'). So callers resolve by the short
  // callee name and callees by the qualified caller name. Precise receiver-type
  // resolution (so both directions key on the fully-qualified symbol, and
  // overloaded/virtual dispatch is marked) is the next slice.
  test('PriceToPips is a callee of CalculatePips (qualified caller)', async () => {
    const callees = await engine.getCalleesOf('CPipCalculator.CalculatePips', { allSources: true });
    expect(callees.some(r => r.to_symbol_qualified === 'PriceToPips')).toBe(true);
  });
});
