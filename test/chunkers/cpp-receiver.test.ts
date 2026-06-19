/**
 * C++ receiver-type resolution at edge-extraction time (cpp-general; the MQL
 * tag reuses these same tree-sitter-cpp shapes).
 *
 * An intra-class call with an IMPLICIT receiver — a bare `Calculate(x)` inside
 * a method of class C, the C++/MQL idiom — resolves to the enclosing class:
 * `C.Calculate`. Two classes defining a same-named method therefore key on
 * DISTINCT qualified callees instead of the conflated bare token.
 *
 * The honest precision boundary (exactly-one-sibling rule):
 *   - exactly 1 inline sibling method named `m` in the class → emit `C.m`
 *   - 0 siblings (a genuine global/library call like `Helper`) → stay BARE
 *   - >1 (overload) → stay BARE (no confident false edge)
 */

import { describe, test, expect } from 'bun:test';
import { chunkCodeTextFull } from '../../src/core/chunkers/code.ts';

const TWO_CLASSES_HPP = `class CAlpha {
public:
  double Calculate(double x) { return Helper(x); }
  double Run(double x) { return Calculate(x); }
};

class CBeta {
public:
  double Calculate(double x) { return x + 1.0; }
  double Start(double x) { return Calculate(x); }
};
`;

describe('C++ — implicit-this receiver resolution', () => {
  test('intra-class calls resolve to the enclosing class; globals stay bare', async () => {
    const { edges } = await chunkCodeTextFull(TWO_CLASSES_HPP, 'src/two.hpp', {
      chunkSizeTokens: 50,
    });
    const callees = edges.filter(e => e.edgeType === 'calls').map(e => e.toSymbol);

    // Sibling calls qualify to their OWN class — no conflation.
    expect(callees).toContain('CAlpha.Calculate');
    expect(callees).toContain('CBeta.Calculate');

    // A genuine global/library call has no sibling method → stays bare.
    expect(callees).toContain('Helper');
    expect(callees).not.toContain('CAlpha.Helper');
  });

  test('an overloaded sibling stays bare (no confident false edge)', async () => {
    const OVERLOADED_HPP = `class CGamma {
public:
  double Scale(double x) { return x; }
  double Scale(double x, double y) { return x + y; }
  double Run(double x) { return Scale(x); }
};
`;
    const { edges } = await chunkCodeTextFull(OVERLOADED_HPP, 'src/gamma.hpp', {
      chunkSizeTokens: 50,
    });
    const callees = edges.filter(e => e.edgeType === 'calls').map(e => e.toSymbol);
    // Two methods named Scale → ambiguous → the call stays bare, never a
    // confident pick of one overload.
    expect(callees).toContain('Scale');
    expect(callees).not.toContain('CGamma.Scale');
  });

  // Regression guard for the no-false-edge promise on the shape most likely to
  // break it: an OUT-OF-LINE method definition (`void CFoo::Bar(){...}` outside
  // the class body). A bare sibling call there has no ENCLOSING class_specifier
  // to walk up to — the walk reaches translation_unit and stops — so it stays
  // bare rather than being misattributed. (Resolving out-of-line defs via the
  // qualified_identifier declarator scope is a deferred follow-up; the hard
  // guarantee is that it never produces a false edge.)
  test('an out-of-line method definition keeps sibling calls bare', async () => {
    const OUT_OF_LINE_HPP = `class CFoo {
public:
  void Bar();
  void Baz();
};

void CFoo::Bar() {
  Baz();
}

void CFoo::Baz() {
}
`;
    const { edges } = await chunkCodeTextFull(OUT_OF_LINE_HPP, 'src/foo.hpp', {
      chunkSizeTokens: 50,
    });
    const callees = edges.filter(e => e.edgeType === 'calls').map(e => e.toSymbol);
    expect(callees).toContain('Baz');
    expect(callees).not.toContain('CFoo.Baz');
  });
});
