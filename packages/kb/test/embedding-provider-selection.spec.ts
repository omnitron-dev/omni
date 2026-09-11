/**
 * Choosing an embedding provider crashed the service that chose it.
 *
 * `KnowledgeBaseService.createEmbeddingProvider()` loaded each provider with
 * `require(...)`, under a comment about lazy-loading to avoid bundling unused
 * deps. This package is `"type": "module"`, so `require` is not defined in it:
 * every one of the three branches threw `ReferenceError: require is not
 * defined` the moment its provider was configured — and it runs in the
 * CONSTRUCTOR, so the service could not be built at all.
 *
 * Semantic search was unreachable in both directions: name a provider and the
 * service throws, name none and you get `NullEmbeddingProvider`. Nothing
 * distinguished "embeddings are off" from "embeddings are broken".
 *
 * Static imports now, because the thing the comment was avoiding does not
 * exist here: all three provider modules import a single type and call global
 * `fetch`.
 */

import { describe, it, expect } from 'vitest';

import { KnowledgeBaseService } from '../src/titan/kb.service.js';

const store = { init: async () => {}, close: async () => {} } as never;

describe('embedding provider selection', () => {
  for (const provider of ['voyage', 'openai', 'ollama'] as const) {
    it(`builds the service with the ${provider} provider`, () => {
      expect(
        () => new KnowledgeBaseService({ embeddings: { provider } } as never, store)
      ).not.toThrow();
    });
  }

  it('falls back to the null provider when none is named', () => {
    expect(() => new KnowledgeBaseService({} as never, store)).not.toThrow();
  });

  it('falls back to the null provider for a name it does not know', () => {
    expect(
      () => new KnowledgeBaseService({ embeddings: { provider: 'nope' } } as never, store)
    ).not.toThrow();
  });
});
