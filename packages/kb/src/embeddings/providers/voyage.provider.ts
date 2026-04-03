import type { IEmbeddingProvider } from '../../core/types.js';

export interface VoyageProviderConfig {
  apiKey: string;
  codeModel?: string;
  textModel?: string;
  baseUrl?: string;
  batchSize?: number;
}

/**
 * Voyage AI embedding provider.
 * Uses voyage-code-3 for code and voyage-4-large for text by default.
 */
export class VoyageEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'voyage';
  readonly dimension = 1024;

  private readonly apiKey: string;
  private readonly codeModel: string;
  private readonly textModel: string;
  private readonly baseUrl: string;
  private readonly batchSize: number;

  constructor(config: VoyageProviderConfig) {
    this.apiKey = config.apiKey;
    this.codeModel = config.codeModel ?? 'voyage-code-3';
    this.textModel = config.textModel ?? 'voyage-4-large';
    this.baseUrl = config.baseUrl ?? 'https://api.voyageai.com/v1';
    this.batchSize = config.batchSize ?? 128;
  }

  async embedCode(texts: string[]): Promise<number[][]> {
    return this.embed(texts, this.codeModel);
  }

  async embedText(texts: string[]): Promise<number[][]> {
    return this.embed(texts, this.textModel);
  }

  private async embed(texts: string[], model: string): Promise<number[][]> {
    const results: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: batch,
          input_type: 'document',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Voyage API error (${response.status}): ${error}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
      };

      results.push(...data.data.map(d => d.embedding));
    }

    return results;
  }
}
