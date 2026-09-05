/**
 * The Ollama provider sent one HTTP request per text.
 *
 * Its two siblings behind the same `IEmbeddingProvider` interface — openai and
 * voyage — both slice `texts` into batches and send `input: batch`. Ollama, the
 * DEFAULT provider ("fully local, free, private"), sent `input: text` inside a
 * `for (const text of texts)` loop, one round trip per symbol, against a local
 * model server that pays per-call overhead each time. Its response handling was
 * already written for the batch shape: it reads `data.embeddings` as
 * `number[][]` and spreads it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { OllamaEmbeddingProvider } from '../src/embeddings/providers/ollama.provider.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('OllamaEmbeddingProvider', () => {
  it('sends texts in batches rather than one request each', async () => {
    const sent: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body as string);
      sent.push(body.input);
      const inputs = body.input as string[];
      return {
        ok: true,
        json: async () => ({ embeddings: inputs.map((t) => [t.length, 0, 0]) }),
      } as any;
    }) as any;

    const provider = new OllamaEmbeddingProvider({ batchSize: 2 });
    const vectors = await provider.embedCode(['a', 'bb', 'ccc', 'dddd', 'eeeee']);

    // Five texts, batch size two: three requests, not five.
    expect(sent).toEqual([['a', 'bb'], ['ccc', 'dddd'], ['eeeee']]);
    // And the vectors come back in input order.
    expect(vectors).toEqual([[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0]]);
  });

  it('refuses a response that does not carry one vector per input', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      // Two inputs, one embedding back.
      json: async () => ({ embeddings: [[1, 2, 3]] }),
    })) as any;

    const provider = new OllamaEmbeddingProvider({ batchSize: 8 });

    // Silently returning a short array would misalign every symbol after the
    // gap with somebody else's vector — the indexer zips by index — and the
    // corruption would only ever show up as bad search results.
    await expect(provider.embedCode(['a', 'b'])).rejects.toThrow(/embedding/i);
  });

  it('makes no request for an empty input list', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;

    const provider = new OllamaEmbeddingProvider();
    expect(await provider.embedCode([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
