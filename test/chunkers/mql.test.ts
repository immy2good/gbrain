/**
 * MQL (MetaQuotes MQL4/MQL5) code-intelligence tests.
 *
 * MQL is a C/C++ subset; gbrain parses it with the shipped tree-sitter-cpp
 * grammar under a distinct `mql` language tag (so UX, filters, and qualified
 * symbol identity are isolated from C++). These fixtures are derived from real
 * iTradeAIMS indicator source (CPipCalculator) and are deliberately free of
 * the MQL `input`/`sinput` keywords, which need a pre-parse shim (later slice).
 */

import { describe, test, expect } from 'bun:test';
import { chunkCodeText, detectCodeLanguage } from '../../src/core/chunkers/code.ts';

// Derived from itradeaims-indicators mt4/Include/AIMS/Utils/PipCalculator.mqh.
// Inline class methods + an implicit-`this` method call (CalculatePips ->
// PriceToPips) — the call-graph tracer the edge slice depends on.
const PIP_CALCULATOR_MQH = `#property strict

class CPipCalculator
{
private:
   double m_pointSize;
   int    m_digits;

   void CalculatePointSize()
   {
      m_digits = (int)MarketInfo(Symbol(), MODE_DIGITS);
      m_pointSize = (m_digits == 5 || m_digits == 3) ? Point * 10.0 : Point;
   }

public:
   CPipCalculator()
   {
      CalculatePointSize();
   }

   double PriceToPips(double priceDifference)
   {
      if(m_pointSize == 0) return 0;
      return MathAbs(priceDifference) / m_pointSize;
   }

   double CalculatePips(double price1, double price2)
   {
      return PriceToPips(price1 - price2);
   }

   double GetPointSize() const
   {
      return m_pointSize;
   }
};
`;

describe('MQL — detectCodeLanguage', () => {
  test('maps .mq4 / .mq5 / .mqh to the mql language tag', () => {
    expect(detectCodeLanguage('Indicator.mq4')).toBe('mql');
    expect(detectCodeLanguage('Expert.mq5')).toBe('mql');
    expect(detectCodeLanguage('Include/AIMS/Utils/PipCalculator.mqh')).toBe('mql');
  });

  test('is case-insensitive for MQL extensions', () => {
    expect(detectCodeLanguage('FOO.MQH')).toBe('mql');
  });
});

describe('MQL — class method definitions', () => {
  test('emits each class method as its own chunk scoped to the class', async () => {
    const chunks = await chunkCodeText(
      PIP_CALCULATOR_MQH,
      'Include/AIMS/Utils/PipCalculator.mqh',
      { chunkSizeTokens: 50 },
    );

    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(c.metadata.language).toBe('mql');

    const priceToPips = chunks.find(c => c.metadata.symbolName === 'PriceToPips');
    expect(priceToPips).toBeDefined();
    expect(priceToPips!.metadata.parentSymbolPath).toEqual(['CPipCalculator']);

    const calculatePips = chunks.find(c => c.metadata.symbolName === 'CalculatePips');
    expect(calculatePips).toBeDefined();
    expect(calculatePips!.metadata.parentSymbolPath).toEqual(['CPipCalculator']);
  });
});
