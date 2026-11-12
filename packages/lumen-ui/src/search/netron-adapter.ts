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

/** Structural contract of the queried LumenService search method. */
export interface NetronSearchClient {
  search(query: string, options?: { limit?: number }): Promise<Array<{
    documentId: string;
    title: string;
    path: string;
    snippet: string;
    score: number;
  }>>;
}

export class NetronAdapter {
  constructor(private readonly rpcClient: NetronSearchClient) {}

  async search(query: string, limit: number = 10): Promise<NetronSearchResult[]> {
    if (!query.trim()) return [];
    const results = await this.rpcClient.search(query, { limit });
    return results.map(result => ({
      id: result.documentId,
      title: result.title,
      path: result.path,
      snippet: stripDangerousTagsLinear(result.snippet),
      score: result.score,
    }));
  }
}
