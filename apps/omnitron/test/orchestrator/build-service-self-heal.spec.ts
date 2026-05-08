/**
 * BuildService stale-metafile detection (B8).
 *
 * The bug: esbuild's incremental watch metafile can drift out of sync
 * with disk when source files are edited mid-rebuild — a torn write
 * or an editor-save race. The reported error references line numbers
 * past the file's current EOF.
 *
 * Yesterday's symptom: `apps/main/src/database/repositories/index.ts:
 * 299:39: ERROR: Could not resolve "./help-category.repository.js"`
 * — but the file was 297 lines and contained no such import. Stale
 * metafile.
 *
 * Test strategy: drive `looksLikeStaleMetafile` (now exposed as a
 * private method) directly with synthetic error payloads and a real
 * temp file whose line count we control. The recreation path itself
 * runs against a real esbuild + temp directory — that's covered by
 * the integration-style externalize spec already in the suite, so
 * we test the detection logic surgically here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BuildService } from '../../src/orchestrator/build-service.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-service-self-heal-'));
const sourceFile = path.join(tmpRoot, 'src.ts');

beforeAll(() => {
  // 10-line source so we can synthesize "error past EOF" without
  // any ambiguity.
  fs.writeFileSync(sourceFile, Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`).join('\n'));
});

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe('BuildService.looksLikeStaleMetafile (B8)', () => {
  // Reach past the privacy modifier — the detection helper is private
  // by design (it's an implementation detail of self-heal); tests
  // exercise it via a cast.
  const svc = new BuildService(true);
  const detect = (errors: any[], entry: string) =>
    (svc as any).looksLikeStaleMetafile(errors, entry);

  it('flags an error whose line number exceeds the source file length', () => {
    const errors = [
      { location: { file: sourceFile, line: 999 }, text: 'phantom' },
    ];
    expect(detect(errors, sourceFile)).toBe(true);
  });

  it('does NOT flag an error whose line is within the source', () => {
    const errors = [
      { location: { file: sourceFile, line: 5 }, text: 'real' },
    ];
    expect(detect(errors, sourceFile)).toBe(false);
  });

  it('forgives off-by-one for trailing newlines', () => {
    // Line 11 on a 10-line file = legitimate (cursor on the EOF newline).
    // Line 12 = stale.
    const errors10 = [
      { location: { file: sourceFile, line: 11 }, text: 'eof' },
    ];
    const errors12 = [
      { location: { file: sourceFile, line: 12 }, text: 'past-eof' },
    ];
    expect(detect(errors10, sourceFile)).toBe(false);
    expect(detect(errors12, sourceFile)).toBe(true);
  });

  it('ignores errors with no location', () => {
    const errors = [{ text: 'no location' }];
    expect(detect(errors, sourceFile)).toBe(false);
  });

  it('ignores errors pointing at a non-existent file', () => {
    const errors = [
      { location: { file: '/this/path/does/not/exist.ts', line: 999 }, text: 'phantom' },
    ];
    expect(detect(errors, sourceFile)).toBe(false);
  });

  it('handles relative file paths by resolving against the entry dir', () => {
    const relativeName = path.basename(sourceFile);
    const errors = [
      { location: { file: relativeName, line: 9999 }, text: 'rel' },
    ];
    expect(detect(errors, sourceFile)).toBe(true);
  });
});
