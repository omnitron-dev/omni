import type { IEmbeddingProvider } from '../../core/types.js';

export interface OllamaProviderConfig {
  model?: string;
  url?: string;
  dimension?: number;
  /**
   * Texts per request. Ollama's `/api/embed` takes `input` as a string or an
   * array; the sibling providers (openai, voyage) already batch, and this one
   * did not. Kept smaller than theirs because the model runs locally and a
   * batch is resident memory, not somebody else's fleet.
   */
  batchSize?: number;
}

/**
 * Ollama embedding provider — fully local, free, private.
 * Uses nomic-embed-text by default (768 dimensions).
 */
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'ollama';
  readonly dimension: number;

  private readonly model: string;
  private readonly url: string;
  private readonly batchSize: number;

  constructor(config: OllamaProviderConfig = {}) {
    this.model = config.model ?? 'nomic-embed-text';
    this.url = config.url ?? 'http://localhost:11434';
    this.dimension = config.dimension ?? 768;
    this.batchSize = config.batchSize ?? 64;
  }

  async embedCode(texts: string[]): Promise<number[][]> {
    return this.embed(texts);
  }

  async embedText(texts: string[]): Promise<number[][]> {
    return this.embed(texts);
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const response = await fetch(`${this.url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: batch,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${error}`);
      }

      const data = await response.json() as {
        embeddings: number[][];
      };

      // Callers zip the result against their inputs BY INDEX
      // (`symbols.map((s, i) => ({ ...s, embedding: vectors[i] }))`), so a
      // response that is short by one silently gives every symbol after the
      // gap somebody else's vector — corruption that surfaces only as bad
      // search results, long after indexing. Fail here instead; the indexer
      // catches embedding failures and stores the symbols without vectors.
      if (!Array.isArray(data.embeddings) || data.embeddings.length !== batch.length) {
        throw new Error(
          `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${batch.length} inputs`,
        );
      }

      results.push(...data.embeddings);
    }

    return results;
  }
}
