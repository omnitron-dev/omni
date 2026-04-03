import type { IEmbeddingProvider } from '../../core/types.js';

export interface OllamaProviderConfig {
  model?: string;
  url?: string;
  dimension?: number;
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

  constructor(config: OllamaProviderConfig = {}) {
    this.model = config.model ?? 'nomic-embed-text';
    this.url = config.url ?? 'http://localhost:11434';
    this.dimension = config.dimension ?? 768;
  }

  async embedCode(texts: string[]): Promise<number[][]> {
    return this.embed(texts);
  }

  async embedText(texts: string[]): Promise<number[][]> {
    return this.embed(texts);
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const response = await fetch(`${this.url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${error}`);
      }

      const data = await response.json() as {
        embeddings: number[][];
      };

      results.push(...data.embeddings);
    }

    return results;
  }
}
