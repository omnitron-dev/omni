/**
 * Chunker — the unit that decides what the knowledge base can find.
 *
 * This package had 3914 lines of source and no tests at all, while its
 * `test` script (`vitest run`) exits 1 with "No test files found" — so the
 * package could not pass its own check even in principle.
 *
 * The chunker is where that matters most: it turns a source file into the
 * chunks that get embedded and searched. A line that lands in no chunk is a
 * line nobody can find again, and nothing about the output would look wrong —
 * the index simply answers "not found" for code that is right there. So the
 * property pinned hardest below is coverage: every line of the input must
 * appear in some chunk.
 */

import { describe, it, expect } from 'vitest';

import { Chunker } from '../src/embeddings/chunker.js';
import type { ISymbolDoc } from '../src/core/types.js';

const symbol = (name: string, line: number, filePath = 'a.ts'): ISymbolDoc =>
  ({ name, line, filePath }) as ISymbolDoc;

/** Lines of `content` that appear in no chunk. */
function uncovered(content: string, chunks: Array<{ content: string }>): string[] {
  const joined = chunks.map((chunk) => chunk.content).join('\n');
  return content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .filter((line) => !joined.includes(line));
}

describe('Chunker.chunkWithSymbols', () => {
  it('loses nothing between two adjacent symbols', () => {
    // The gap is deliberately shorter than the 5-line threshold that would
    // give it a chunk of its own — it has to be absorbed by the preceding
    // symbol instead of being dropped.
    const content = [
      'export const A = 1;',
      'const BETWEEN_ONE = 42;',
      'const BETWEEN_TWO = 7;',
      'export const B = 2;',
    ].join('\n');

    const chunks = new Chunker().chunkWithSymbols(content, 'a.ts', 'kb', [
      symbol('A', 1),
      symbol('B', 4),
    ]);

    expect(uncovered(content, chunks)).toEqual([]);
  });

  it('loses nothing across a gap large enough for its own chunk', () => {
    const lines = ['export const A = 1;'];
    for (let i = 0; i < 20; i++) lines.push(`const gap${i} = ${i};`);
    lines.push('export const B = 2;');
    const content = lines.join('\n');

    const chunks = new Chunker().chunkWithSymbols(content, 'a.ts', 'kb', [
      symbol('A', 1),
      symbol('B', lines.length),
    ]);

    expect(uncovered(content, chunks)).toEqual([]);
  });

  it('attributes each chunk to the symbol it came from', () => {
    const content = ['export function first() {}', '', 'export function second() {}'].join('\n');

    const chunks = new Chunker().chunkWithSymbols(content, 'a.ts', 'kb', [
      symbol('first', 1),
      symbol('second', 3),
    ]);

    expect(chunks.map((chunk) => chunk.symbol)).toEqual(['first', 'second']);
    expect(chunks.every((chunk) => chunk.package === 'kb')).toBe(true);
    expect(chunks.every((chunk) => chunk.source === 'a.ts')).toBe(true);
  });

  it('ignores symbols belonging to other files', () => {
    const content = 'export const only = 1;';

    const chunks = new Chunker().chunkWithSymbols(content, 'a.ts', 'kb', [
      symbol('elsewhere', 1, 'b.ts'),
    ]);

    // No symbol matches this file, so it falls back to line chunking — the
    // content still has to come out.
    expect(uncovered(content, chunks)).toEqual([]);
    expect(chunks.every((chunk) => chunk.symbol === undefined)).toBe(true);
  });

  it('splits a symbol that exceeds maxTokens, and keeps all of it', () => {
    const lines = ['export class Big {'];
    for (let index = 0; index < 400; index++) lines.push(`  method${index}() { return ${index}; }`);
    lines.push('}');
    const content = lines.join('\n');

    const chunker = new Chunker({ targetTokens: 40, maxTokens: 60, overlapLines: 2 });
    const chunks = chunker.chunkWithSymbols(content, 'a.ts', 'kb', [symbol('Big', 1)]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.symbol === 'Big')).toBe(true);
    expect(uncovered(content, chunks)).toEqual([]);
  });

  it('keeps a symbol under maxTokens in a single chunk', () => {
    const content = ['export function small() {', '  return 1;', '}'].join('\n');

    const chunks = new Chunker().chunkWithSymbols(content, 'a.ts', 'kb', [symbol('small', 1)]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(content);
  });
});

describe('Chunker.chunkByLines', () => {
  it('covers the whole file', () => {
    const content = Array.from({ length: 200 }, (_, index) => `const line${index} = ${index};`).join('\n');

    const chunks = new Chunker({ targetTokens: 50 }).chunkByLines(content, 'a.ts', 'kb');

    expect(chunks.length).toBeGreaterThan(1);
    expect(uncovered(content, chunks)).toEqual([]);
  });

  it('terminates when the overlap is larger than a chunk', () => {
    // `start = Math.max(start + 1, end - overlapLines)` is what keeps this from
    // looping forever when overlapLines exceeds the chunk size; without the
    // `start + 1` floor the window would never advance.
    const content = Array.from({ length: 50 }, (_, index) => `x${index}`).join('\n');

    const chunks = new Chunker({ targetTokens: 1, overlapLines: 100 }).chunkByLines(content, 'a.ts', 'kb');

    expect(chunks.length).toBeGreaterThan(0);
    expect(uncovered(content, chunks)).toEqual([]);
  });

  it('handles an empty file without producing an empty chunk stream', () => {
    const chunks = new Chunker().chunkByLines('', 'a.ts', 'kb');
    expect(chunks.every((chunk) => typeof chunk.content === 'string')).toBe(true);
  });
});

describe('chunk ranges', () => {
  it('are 1-based, inclusive, ordered and never inverted', () => {
    const lines = ['export class Big {'];
    for (let index = 0; index < 120; index++) lines.push(`  method${index}() { return ${index}; }`);
    lines.push('}');
    const content = lines.join('\n');

    const chunks = new Chunker({ targetTokens: 40, maxTokens: 60 }).chunkWithSymbols(
      content,
      'a.ts',
      'kb',
      [symbol('Big', 1)]
    );

    for (const chunk of chunks) {
      // An inverted or zero range would point a search result at nothing.
      expect(chunk.range.start).toBeGreaterThanOrEqual(1);
      expect(chunk.range.end).toBeGreaterThanOrEqual(chunk.range.start);
      expect(chunk.range.end).toBeLessThanOrEqual(lines.length);
      expect(chunk.tokens).toBeGreaterThan(0);

      // The range must describe the content actually carried, or a citation
      // points at the wrong lines.
      const claimed = lines.slice(chunk.range.start - 1, chunk.range.end).join('\n');
      expect(chunk.content).toBe(claimed);
    }
  });
});
