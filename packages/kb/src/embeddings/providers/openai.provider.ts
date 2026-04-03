import type { IEmbeddingProvider } from '../../core/types.js';

export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  batchSize?: number;
}

/**
 * OpenAI embedding provider.
 * Uses text-embedding-3-large by default.
 */
export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openai';
  readonly dimension = 1536;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly batchSize: number;

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'text-embedding-3-large';
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.batchSize = config.batchSize ?? 2048;
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
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${error}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
      };

      results.push(...data.data.map(d => d.embedding));
    }

    return results;
  }
}
