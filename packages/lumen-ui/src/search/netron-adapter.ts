export interface NetronSearchResult {
  id: string;
  title: string;
  path: string;
  snippet: string;
  score: number;
}

function sanitizeSnippet(snippet: string): string {
  if (!snippet) return '';
  return snippet
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
}

export class NetronAdapter {
  constructor(
    private readonly rpcClient?: { search: (query: string, options?: any) => Promise<any[]> },
    private readonly endpoint: string = '/api/rpc/search'
  ) {}

  async search(query: string, limit: number = 10): Promise<NetronSearchResult[]> {
    if (!query.trim()) return [];

    if (this.rpcClient?.search) {
      try {
        const results = await this.rpcClient.search(query, { limit });
        return (results || []).map((r, idx) => ({
          id: r.documentId || `netron-${idx}`,
          title: r.title || 'Untitled',
          path: r.path || '',
          snippet: sanitizeSnippet(r.snippet || ''),
          score: r.score ?? 1.0,
        }));
      } catch {
        return [];
      }
    }

    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        const items = Array.isArray(data) ? data : data.results || [];
        return items.map((r: any, idx: number) => ({
          id: r.documentId || r.id || `netron-${idx}`,
          title: r.title || 'Untitled',
          path: r.path || '',
          snippet: sanitizeSnippet(r.snippet || ''),
          score: r.score ?? 1.0,
        }));
      } catch {
        return [];
      }
    }

    return [];
  }
}
