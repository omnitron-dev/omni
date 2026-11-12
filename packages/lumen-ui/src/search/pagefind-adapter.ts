export interface PagefindSearchResult {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  score?: number;
}

interface PagefindModule {
  init?: () => Promise<unknown>;
  search: (query: string) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Loads only the explicitly configured index; failures can be retried. */
export class PagefindAdapter {
  private pagefindInstance: PagefindModule | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private loadError: unknown;

  constructor(private readonly pagefindPath: string = '/pagefind/pagefind.js') {}

  get isFailedState(): boolean { return this.loadError !== undefined; }
  get isReady(): boolean { return this.pagefindInstance !== null; }

  async init(): Promise<boolean> {
    if (this.pagefindInstance) return true;
    if (typeof window === 'undefined' && !this.pagefindPath.startsWith('file:')) return false;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const module: unknown = await import(/* @vite-ignore */ this.pagefindPath);
        if (!isRecord(module) || typeof module.search !== 'function' ||
          (module.init !== undefined && typeof module.init !== 'function')) {
          throw new Error('The configured module does not expose the Pagefind search API');
        }
        const pagefind = module as unknown as PagefindModule;
        await pagefind.init?.();
        this.pagefindInstance = pagefind;
        this.loadError = undefined;
        return true;
      } catch (error) {
        this.loadError = error;
        return false;
      }
    })().finally(() => { this.loadPromise = null; });

    return this.loadPromise;
  }

  async search(query: string, maxResults: number = 10): Promise<PagefindSearchResult[]> {
    if (!Number.isInteger(maxResults) || maxResults < 0 || maxResults > 100) {
      throw new RangeError('Search result limit must be an integer between 0 and 100');
    }
    if (typeof query !== 'string' || new TextEncoder().encode(query).length > 4096) {
      throw new RangeError('Search query must be text of at most 4096 UTF-8 bytes');
    }
    if (!query.trim() || maxResults === 0) return [];
    if (!await this.init() || !this.pagefindInstance) {
      throw new Error('Local search index is unavailable. Try again when the connection is restored.', { cause: this.loadError });
    }

    try {
      const response = await this.pagefindInstance.search(query);
      if (!isRecord(response) || !Array.isArray(response.results)) {
        throw new Error('Pagefind returned an invalid search response');
      }
      return await Promise.all(response.results.slice(0, maxResults).map(async (result: unknown) => {
        if (!isRecord(result) || typeof result.data !== 'function') {
          throw new Error('Pagefind returned an invalid search result');
        }
        const data: unknown = await result.data();
        if (!isRecord(data) || typeof data.url !== 'string' ||
          (data.excerpt !== undefined && typeof data.excerpt !== 'string')) {
          throw new Error('Pagefind returned invalid result data');
        }
        return {
          id: typeof result.id === 'string' ? result.id : data.url,
          url: data.url,
          title: isRecord(data.meta) && typeof data.meta.title === 'string' ? data.meta.title : data.url,
          excerpt: typeof data.excerpt === 'string' ? data.excerpt : '',
          score: typeof result.score === 'number' && Number.isFinite(result.score) ? result.score : undefined,
        };
      }));
    } catch (cause) {
      throw new Error('Local search failed. Try the search again.', { cause });
    }
  }
}
