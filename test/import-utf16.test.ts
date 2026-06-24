/**
 * Text-import encoding: MetaTrader MQL files (and many Windows-authored
 * notes) ship as UTF-16, not UTF-8. importFile() read every file with
 * readFileSync(path, 'utf-8'), which mis-decodes UTF-16 into a string full
 * of U+0000 — and Postgres then rejects the insert with
 * `invalid byte sequence for encoding "UTF8": 0x00`, so the whole sync
 * aborts. readTextFileUtf8() detects the encoding (BOM-aware, plus a
 * no-BOM UTF-16 heuristic) and returns clean UTF-8 text.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readTextFileUtf8 } from '../src/core/import-file.ts';

const SOURCE = '//+---+\nvoid OnTick(void)\n  {\n   double p = Bid;\n  }\n';
const NUL = String.fromCharCode(0);
let dir: string | null = null;

function tmp(name: string, bytes: Buffer): string {
  dir = mkdtempSync(join(tmpdir(), 'gb-utf16-'));
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

afterEach(() => {
  if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
});

describe('readTextFileUtf8 — encoding-aware text import', () => {
  test('UTF-16LE with BOM decodes to clean UTF-8', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SOURCE, 'utf16le')]);
    const out = readTextFileUtf8(tmp('ea.mq5', buf));
    expect(out).toBe(SOURCE);
    expect(out).not.toContain(NUL);
  });

  test('UTF-16BE with BOM decodes to clean UTF-8', () => {
    const le = Buffer.from(SOURCE, 'utf16le');
    const be = Buffer.from(le); be.swap16();
    const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    const out = readTextFileUtf8(tmp('ea.mqh', buf));
    expect(out).toBe(SOURCE);
    expect(out).not.toContain(NUL);
  });

  test('UTF-16LE WITHOUT BOM (MetaTrader export shape) decodes via heuristic', () => {
    const buf = Buffer.from(SOURCE, 'utf16le');
    const out = readTextFileUtf8(tmp('ea.mq4', buf));
    expect(out).toBe(SOURCE);
    expect(out).not.toContain(NUL);
  });

  test('plain UTF-8 is returned unchanged', () => {
    const buf = Buffer.from(SOURCE, 'utf8');
    expect(readTextFileUtf8(tmp('ea.ts', buf))).toBe(SOURCE);
  });

  test('UTF-8 with BOM has the BOM stripped', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SOURCE, 'utf8')]);
    const out = readTextFileUtf8(tmp('note.md', buf));
    expect(out).toBe(SOURCE);
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
  });
});
