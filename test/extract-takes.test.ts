import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { extractTakesFromDb } from '../src/core/cycle/extract-takes.ts';
import { extractTakesFromPages, parseClaimsJson } from '../src/core/extract-takes-from-pages.ts';
import { TAKES_FENCE_BEGIN, TAKES_FENCE_END } from '../src/core/takes-fence.ts';
import {
  __setChatTransportForTests,
  configureGateway,
  resetGateway,
  type ChatOpts,
  type ChatResult,
} from '../src/core/ai/gateway.ts';

let engine: PGLiteEngine;
let alicePageId: number;

const ALICE_BODY = `# Alice Example

Some prose.

## Takes

${TAKES_FENCE_BEGIN}
| # | claim | kind | who | weight | since | source |
|---|-------|------|-----|--------|-------|--------|
| 1 | CEO of Acme | fact | world | 1.0 | 2017-01 | Crustdata |
| 2 | Strong technical founder | take | garry | 0.85 | 2026-04-29 | OH 2026-04-29 |
| 3 | ~~Will reach $50B~~ | bet | garry | 0.7 | 2026-04-29 → 2026-06 | superseded |
${TAKES_FENCE_END}

## Notes
Other content.
`;

const BOB_BODY_NO_FENCE = '# Bob\n\nNo takes here.\n';

const CHARLIE_BODY_MALFORMED = `## Takes

${TAKES_FENCE_BEGIN}
| # | claim | kind | who | weight | since | source |
|---|-------|------|-----|--------|-------|--------|
| 1 | Valid | fact | world | 1.0 | 2026-01 | x |
| 2 | Bad weight | take | garry | not-a-number | 2026-01 | x |
${TAKES_FENCE_END}
`;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  const alice = await engine.putPage('people/alice-example', {
    title: 'Alice', type: 'person', compiled_truth: ALICE_BODY,
  });
  await engine.putPage('people/bob-example', {
    title: 'Bob', type: 'person', compiled_truth: BOB_BODY_NO_FENCE,
  });
  await engine.putPage('people/charlie-example', {
    title: 'Charlie', type: 'person', compiled_truth: CHARLIE_BODY_MALFORMED,
  });
  alicePageId = alice.id;
});

afterAll(async () => {
  await engine.disconnect();
});

describe('extractTakesFromDb', () => {
  test('full walk: parses fenced pages and skips non-fenced', async () => {
    const result = await extractTakesFromDb(engine);
    expect(result.pagesScanned).toBe(3);
    expect(result.pagesWithTakes).toBe(2); // alice + charlie
    // alice has 3, charlie has 1 valid → 4 upserted
    expect(result.takesUpserted).toBe(4);
    // charlie has 1 malformed warning
    expect(result.warnings.some(w => w.includes('non-numeric weight'))).toBe(true);
  });

  test('takes table actually populated', async () => {
    const aliceTakes = await engine.listTakes({ page_id: alicePageId });
    expect(aliceTakes).toHaveLength(2); // active=true filter, row 3 is struck
    const allTakes = await engine.listTakes({ page_id: alicePageId, active: false });
    expect(allTakes).toHaveLength(1); // only row 3
    expect(allTakes[0].row_num).toBe(3);
    expect(allTakes[0].active).toBe(false);
  });

  test('incremental: slugs filter restricts to specified pages', async () => {
    // Re-extract only alice (no-op since data already matches)
    const result = await extractTakesFromDb(engine, { slugs: ['people/alice-example'] });
    expect(result.pagesScanned).toBe(1);
  });

  test('dry-run: counts but does not delete or rewrite', async () => {
    const before = await engine.listTakes({ page_id: alicePageId });
    const result = await extractTakesFromDb(engine, {
      slugs: ['people/alice-example'],
      dryRun: true,
    });
    expect(result.takesUpserted).toBe(3); // 3 takes parsed (would-be upserts)
    const after = await engine.listTakes({ page_id: alicePageId });
    expect(after.length).toBe(before.length);
  });

  test('rebuild=true deletes existing rows before re-insert', async () => {
    // Insert a one-off ad-hoc take to verify it gets cleared
    await engine.addTakesBatch([
      { page_id: alicePageId, row_num: 99, claim: 'Ad-hoc test', kind: 'fact', holder: 'world', weight: 1.0 },
    ]);
    const before = await engine.listTakes({ page_id: alicePageId });
    expect(before.some(t => t.row_num === 99)).toBe(true);

    const result = await extractTakesFromDb(engine, {
      slugs: ['people/alice-example'],
      rebuild: true,
    });
    expect(result.takesUpserted).toBe(3);

    const after = await engine.listTakes({ page_id: alicePageId, active: false });
    expect(after.some(t => t.row_num === 99)).toBe(false);
    // Original 3 takes restored.
    const all = await engine.listTakes({ page_id: alicePageId, active: false });
    const allRowNums = all.map(t => t.row_num).sort();
    expect(allRowNums).toContain(3);
  });
});

describe('extractTakesFromPages', () => {
  test('parseClaimsJson parses valid take claims and drops invalid rows', () => {
    const claims = parseClaimsJson(JSON.stringify([
      { claim: 'GBrain should prefer configured local chat for bootstrap work.', kind: 'take', weight: 0.8 },
      { claim: '', kind: 'take', weight: 0.5 },
      { claim: 'Bad kind', kind: 'story', weight: 0.5 },
    ]));

    expect(claims).toEqual([
      {
        claim: 'GBrain should prefer configured local chat for bootstrap work.',
        kind: 'take',
        weight: 0.8,
      },
    ]);
  });

  test('uses configured chat model by default instead of hardcoded Anthropic', async () => {
    configureGateway({ chat_model: 'ollama:llama3', env: {} });
    __setChatTransportForTests(async (opts: ChatOpts): Promise<ChatResult> => {
      if (opts.model?.startsWith('anthropic:')) {
        throw new Error(`unexpected hardcoded model: ${opts.model}`);
      }
      return {
        text: JSON.stringify([
          { claim: 'Local chat can bootstrap takes without hosted credentials.', kind: 'take', weight: 0.7 },
        ]),
        blocks: [],
        stopReason: 'end',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
        model: 'ollama:llama3',
        providerId: 'ollama',
      };
    });

    try {
      const inserted: unknown[] = [];
      const engine = {
        async executeRaw() {
          return [
            {
              id: 123,
              slug: 'concepts/local-chat',
              source_id: 'default',
              type: 'concept',
              compiled_truth: 'Local model bootstrap evidence. '.repeat(20),
              updated_at: new Date(),
            },
          ];
        },
        async addTakesBatch(batch: unknown[]) {
          inserted.push(...batch);
          return batch.length;
        },
      };

      const result = await extractTakesFromPages(engine as never, {
        bootstrapEnabled: true,
        maxPages: 1,
      });

      expect(result).toMatchObject({
        consent_gate_blocked: false,
        llm_unavailable: false,
        pages_scanned: 1,
        claims_extracted: 1,
      });
      expect(inserted.length).toBe(1);
    } finally {
      __setChatTransportForTests(null);
      resetGateway();
    }
  });
});
