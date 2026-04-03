import type { IEmbeddingProvider } from '../../core/types.js';

/**
 * Null embedding provider — returns empty embeddings.
 * Used when no embedding API is configured. KB falls back to full-text search only.
 */
export class NullEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'null';
  readonly dimension = 0;

  async embedCode(_texts: string[]): Promise<number[][]> {
    return _texts.map(() => []);
  }

  async embedText(_texts: string[]): Promise<number[][]> {
    return _texts.map(() => []);
  }
}
