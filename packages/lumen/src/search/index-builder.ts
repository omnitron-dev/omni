import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';
import { tokenizeMultilingual } from './tokenizer.js';

export interface SearchIndexEntry {
  path: string;
  title: string;
  tokens: string[];
}

export interface SearchIndexResult {
  manifestEntries: Record<string, string>;
  entries: SearchIndexEntry[];
}

export async function generateSearchIndex(corpus: CorpusGraph, _config: LumenConfig): Promise<SearchIndexResult> {
  const docs = corpus.getAllDocuments();
  const entries: SearchIndexEntry[] = [];

  for (const doc of docs) {
    const textParts: string[] = [doc.title, doc.path, ...(doc.anchors ?? [])];
    if (doc.mathObjects) {
      for (const m of doc.mathObjects) {
        textParts.push(m.id);
        if (m.title) textParts.push(m.title);
      }
    }
    if (doc.ast?.rawContent) {
      textParts.push(doc.ast.rawContent);
    }

    const tokens = tokenizeMultilingual(textParts.join(' '));
    entries.push({
      path: doc.routePath ?? `/${doc.path.replace(/\.(pdx|md)$/, '')}`,
      title: doc.title,
      tokens: Array.from(new Set(tokens)),
    });
  }

  const manifestEntries: Record<string, string> = {
    'pagefind/pagefind.js': 'pagefind/pagefind.js',
    'pagefind/pagefind-entry.json': 'pagefind/pagefind-entry.json',
    'pagefind/pagefind.wasm': 'pagefind/pagefind.wasm',
  };

  return {
    manifestEntries,
    entries,
  };
}
