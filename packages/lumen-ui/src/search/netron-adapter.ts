export interface NetronSearchResult {
  id: string;
  title: string;
  path: string;
  snippet: string;
  score: number;
}

function stripDangerousTagsLinear(snippet: string): string {
  if (!snippet) return '';
  let lower = snippet.toLowerCase();
  let current = snippet;

  for (const blocked of ['script', 'style']) {
    let out = '';
    let cursor = 0;
    const openToken = `<${blocked}`;
    const closeToken = `</${blocked}`;

    while (cursor < current.length) {
      const idx = lower.indexOf(openToken, cursor);
      if (idx === -1) {
        out += current.slice(cursor);
        break;
      }
      const nextChar = lower[idx + openToken.length] ?? '';
      if (nextChar && nextChar !== '>' && nextChar !== '/' && !/\s/.test(nextChar)) {
        out += current.slice(cursor, idx + openToken.length);
        cursor = idx + openToken.length;
        continue;
      }
      out += current.slice(cursor, idx);
      const closeIdx = lower.indexOf(closeToken, idx + openToken.length);
      if (closeIdx === -1) {
        break;
      }
      const closeEnd = lower.indexOf('>', closeIdx + closeToken.length);
      if (closeEnd === -1) {
        break;
      }
      cursor = closeEnd + 1;
    }

    current = out;
    lower = current.toLowerCase();
  }

  return current;
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
          id: r.documentId || r.id || `netron-${idx}`,
          title: r.title || 'Untitled',
          path: r.path || r.url || '',
          snippet: stripDangerousTagsLinear(r.snippet || ''),
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
          path: r.path || r.url || '',
          snippet: stripDangerousTagsLinear(r.snippet || ''),
          score: r.score ?? 1.0,
        }));
      } catch {
        return [];
      }
    }

    return [];
  }
}
