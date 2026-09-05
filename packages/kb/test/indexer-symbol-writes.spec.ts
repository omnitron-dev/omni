/**
 * Symbols must be written once, not written and then rewritten.
 *
 * `indexSource` handles four collections. Specs, gotchas and patterns all
 * embed first and then call their single `upsert*`. Symbols — the largest
 * collection by an order of magnitude, thousands against dozens — used to
 * `upsertSymbols(extraction.symbols)`, then compute embeddings, then
 * `upsertSymbols(symbolsWithEmbeddings)` over the same set. `upsertSymbols`
 * issues one database query per element, so the biggest collection was the one
 * paying for two full passes.
 */
import { describe, it, expect, vi } from 'vitest';

import { Indexer } from '../src/indexer/indexer.js';

function fakeStore() {
  const symbolWrites: unknown[][] = [];
  return {
    symbolWrites,
    store: {
      upsertModule: vi.fn(async () => {}),
      upsertSymbols: vi.fn(async (symbols: unknown[]) => {
        symbolWrites.push(symbols.map((s) => ({ ...(s as object) })));
      }),
      upsertDependencies: vi.fn(async () => {}),
      upsertManifest: vi.fn(async () => {}),
      upsertSpecs: vi.fn(async () => {}),
      upsertGotchas: vi.fn(async () => {}),
      upsertPatterns: vi.fn(async () => {}),
      upsertChunks: vi.fn(async () => {}),
    } as any,
  };
}

function prepare(indexer: Indexer, embedCode: () => Promise<number[][]>) {
  vi.spyOn(indexer as any, 'loadPrebuiltExtraction').mockResolvedValue({
    symbols: [
      { name: 'a', signature: '() => void', module: 'm', filePath: 'a.ts', line: 1, kind: 'function' },
      { name: 'b', signature: '() => void', module: 'm', filePath: 'b.ts', line: 2, kind: 'function' },
    ],
    decorators: [],
    dependencies: [],
    repoMap: { packages: [], dependencyGraph: [] },
    manifest: { hash: 'h' },
  });
  (indexer as any).specsManager = {
    loadFromSource: async () => ({ specs: [], gotchas: [], patterns: [] }),
  };

  return {
    source: {
      path: '/nowhere',
      packageName: 'pkg',
      type: 'package',
      config: { module: 'm', name: 'n', tags: [], extract: { symbols: true } },
    } as any,
    options: {
      usePrebuilt: true,
      embeddings: { dimension: 3, embedCode, embedText: async () => [] },
    } as any,
  };
}

describe('Indexer - symbol writes', () => {
  it('writes the symbol set once, with embeddings attached', async () => {
    const indexer = new Indexer();
    const { symbolWrites, store } = fakeStore();
    const { source, options } = prepare(indexer, async () => [
      [1, 1, 1],
      [2, 2, 2],
    ]);

    await (indexer as any).indexSource(source, store, options, [], []);

    expect(store.upsertSymbols).toHaveBeenCalledTimes(1);
    expect(symbolWrites[0]).toEqual([
      expect.objectContaining({ name: 'a', embedding: [1, 1, 1] }),
      expect.objectContaining({ name: 'b', embedding: [2, 2, 2] }),
    ]);
  });

  it('still writes the symbols once when embedding fails', async () => {
    const indexer = new Indexer();
    const { symbolWrites, store } = fakeStore();
    const { source, options } = prepare(indexer, async () => {
      throw new Error('ollama down');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await (indexer as any).indexSource(source, store, options, [], []);

    // Unchanged failure behaviour: warn, and store the symbols without vectors.
    expect(store.upsertSymbols).toHaveBeenCalledTimes(1);
    expect(symbolWrites[0]).toEqual([
      expect.not.objectContaining({ embedding: expect.anything() }),
      expect.not.objectContaining({ embedding: expect.anything() }),
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
