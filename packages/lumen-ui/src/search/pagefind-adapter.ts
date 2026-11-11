export interface PagefindSearchResult {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  score?: number;
}

export class PagefindAdapter {
  private static readonly failedUrls = new Set<string>();
  private pagefindInstance: any = null;
  private isLoaded = false;
  private isFailed = false;
  private loadPromise: Promise<boolean> | null = null;

  constructor(private readonly pagefindPath: string = '/pagefind/pagefind.js') {}

  /**
   * Resets the permanent failure cache (useful in tests or when retrying after network recovery).
   */
  static resetFailureCache(): void {
    PagefindAdapter.failedUrls.clear();
  }

  /**
   * Indicates whether this adapter or its target URL is in a permanent failure state.
   */
  get isFailedState(): boolean {
    return this.isFailed || PagefindAdapter.failedUrls.has(this.pagefindPath);
  }

  /**
   * Indicates whether the Pagefind instance is loaded and ready.
   */
  get isReady(): boolean {
    return this.isLoaded;
  }

  async init(): Promise<boolean> {
    if (this.isLoaded) return true;
    if (typeof window === 'undefined') return false;

    // Fast path: if window.pagefind is already present in the global scope
    if ((window as any).pagefind) {
      try {
        this.pagefindInstance = (window as any).pagefind;
        await this.pagefindInstance?.init?.();
        this.isLoaded = true;
        this.isFailed = false;
        return true;
      } catch {
        this.isLoaded = false;
        this.isFailed = true;
        return false;
      }
    }

    // Permanent failure check: do not retry dynamic import if URL previously failed
    if (this.isFailed || PagefindAdapter.failedUrls.has(this.pagefindPath)) {
      return false;
    }

    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        this.pagefindInstance = await import(/* @vite-ignore */ this.pagefindPath);
        await this.pagefindInstance?.init?.();
        this.isLoaded = true;
        this.isFailed = false;
        return true;
      } catch {
        this.isLoaded = false;
        this.isFailed = true;
        PagefindAdapter.failedUrls.add(this.pagefindPath);
        return false;
      }
    })();

    return this.loadPromise;
  }

  async search(query: string, maxResults: number = 10): Promise<PagefindSearchResult[]> {
    const ok = await this.init();
    if (!ok || !this.pagefindInstance?.search) return [];

    try {
      const response = await this.pagefindInstance.search(query);
      const results = await Promise.all(
        (response.results || []).slice(0, maxResults).map(async (r: any) => {
          const data = await r.data();
          return {
            id: r.id || data.url,
            url: data.url,
            title: data.meta?.title || data.url,
            excerpt: data.excerpt || '',
            score: r.score,
          };
        })
      );
      return results;
    } catch {
      return [];
    }
  }
}
