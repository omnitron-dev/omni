/**
 * The knowledge base reported how many embeddings it held with a constant.
 *
 * `SurrealKbStore.getStats()` counted seven tables and then returned
 * `embeddingsIndexed: 0` — a literal. `omnitron kb status` printed it as
 * «Embeddings: 0» and the MCP `kb.status` tool returned it as a measurement.
 * It was true only while nothing embedded: `KnowledgeBaseService` (titan)
 * indexes with Voyage, OpenAI or Ollama when one is configured, which is the
 * one case where the number is worth reading.
 *
 * The store under test is this worktree's source, over SurrealDB's in-memory
 * engine — the same engine family the CLI opens on disk.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { SurrealKbStore } from '../../../../packages/kb/src/surreal/client.js';

let store: SurrealKbStore | null = null;

afterEach(async () => {
  await store?.close();
  store = null;
});

const spec = (title: string, embedding?: number[]) => ({
  module: 'titan/netron',
  title,
  content: `${title} content`,
  tags: [],
  summary: '',
  filePath: `kb/specs/${title}.md`,
  dependsOn: [],
  tokens: 3,
  ...(embedding ? { embedding } : {}),
});

describe('embeddingsIndexed', () => {
  it('counts the rows that carry a vector, across the tables that can', async () => {
    store = new SurrealKbStore({ url: 'mem://' });
    await store.initialize();

    await store.upsertSpecs([spec('with-vector', [0.1, 0.2, 0.3]), spec('without-vector')] as never);
    await store.upsertSymbols([
      {
        name: 'Netron',
        kind: 'class',
        module: 'titan/netron',
        filePath: 'src/netron/netron.ts',
        line: 1,
        signature: 'class Netron',
        decorators: [],
        members: [],
        embedding: [0.4, 0.5, 0.6],
      },
    ] as never);
    await store.upsertGotchas([
      { title: 'no vector here', module: 'titan/netron', severity: 'warning', content: 'plain', tags: [] },
    ] as never);

    const stats = await store.getStats();

    expect(stats.specs).toBe(2);
    expect(stats.symbols).toBe(1);
    expect(stats.gotchas).toBe(1);
    expect(stats.embeddingsIndexed, 'one spec and one symbol carry a vector').toBe(2);
  }, 60_000);

  it('is zero when nothing embedded — measured, not assumed', async () => {
    store = new SurrealKbStore({ url: 'mem://' });
    await store.initialize();
    await store.upsertSpecs([spec('plain')] as never);

    const stats = await store.getStats();

    expect(stats.specs).toBe(1);
    expect(stats.embeddingsIndexed).toBe(0);
  }, 60_000);
});
