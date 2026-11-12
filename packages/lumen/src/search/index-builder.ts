import * as pagefind from 'pagefind';
import { toHtmlSsr } from '@omnitron-dev/lumen-ast';
import type { CorpusGraph } from '../corpus/graph.js';
import { extractAstPlainText, projectCorpus, type CorpusProjectionOptions } from '../corpus/projection.js';
import type { LumenConfig } from '../config/schema.js';
import { tokenizeMultilingual } from './tokenizer.js';

let activeSearchBuilds = 0;

export interface SearchIndexEntry {
  id?: string;
  path: string;
  url?: string;
  title: string;
  excerpt?: string;
  tokens: string[];
}

export interface SearchIndexResult {
  manifestEntries: Record<string, string>;
  entries: SearchIndexEntry[];
  files: Record<string, string | Uint8Array>;
}

function buildExcerptText(projectedBodyText?: string, fallbackTitle?: string): string {
  if (!projectedBodyText) {
    return fallbackTitle ?? '';
  }
  const stripped = projectedBodyText.replace(/\s+/g, ' ').trim();
  return stripped.slice(0, 240);
}

export async function buildSearchIndex(
  corpus: CorpusGraph,
  config?: LumenConfig,
  options?: CorpusProjectionOptions
): Promise<SearchIndexResult> {
  const projectedCorpus = projectCorpus(corpus, options);
  const docs = projectedCorpus.getAllDocuments();
  const entries: SearchIndexEntry[] = [];

  let basePrefix = (config?.baseUrl ?? '/').replace(/\/+$/, '');
  if (basePrefix === '/') basePrefix = '';

  for (const doc of docs) {
    const textParts: string[] = [];
    if (typeof doc.title === 'string' && doc.title.length > 0) {
      textParts.push(doc.title);
    }
    if (typeof doc.path === 'string' && doc.path.length > 0) {
      textParts.push(doc.path);
    }
    for (const anchor of doc.anchors ?? []) {
      if (anchor) textParts.push(anchor);
    }
    if (doc.mathObjects) {
      for (const m of doc.mathObjects) {
        if (m.id) textParts.push(m.id);
        if (m.title) textParts.push(m.title);
      }
    }

    // Derive body text strictly from projected AST child nodes (never rawContent!)
    const projectedBodyText = doc.ast?.children ? extractAstPlainText(doc.ast.children) : '';
    if (projectedBodyText) {
      textParts.push(projectedBodyText);
    }

    const rawRoute = doc.routePath ?? `/${doc.path.replace(/\.(pdx|md)$/, '')}`;
    const normalizedPath = rawRoute.startsWith('/') ? rawRoute : `/${rawRoute}`;
    const resolvedUrl =
      basePrefix && !normalizedPath.startsWith(`${basePrefix}/`) ? `${basePrefix}${normalizedPath}` : normalizedPath;
    const safeTitle = typeof doc.title === 'string' ? doc.title : '';

    const tokens = tokenizeMultilingual(textParts.join(' '));
    entries.push({
      id: doc.id,
      path: normalizedPath,
      url: resolvedUrl,
      title: safeTitle,
      excerpt: buildExcerptText(projectedBodyText, safeTitle),
      tokens: Array.from(new Set(tokens)),
    });
  }

  activeSearchBuilds++;
  const created = await pagefind.createIndex({ keepIndexUrl: true }).catch(async (error: unknown) => {
    if (--activeSearchBuilds === 0) await pagefind.close();
    throw error;
  });
  if (created.errors.length || !created.index) {
    if (--activeSearchBuilds === 0) await pagefind.close();
    throw new Error(`Pagefind index creation failed: ${created.errors.join('; ')}`);
  }
  const index = created.index;
  const files: Record<string, string | Uint8Array> = {};
  const manifestEntries: Record<string, string> = {};
  try {
    for (const [i, doc] of docs.entries()) {
      const body = doc.ast ? toHtmlSsr(doc.ast) : `<p>${String(doc.title).replace(/[<>&]/g, '')}</p>`;
      const result = await index.addHTMLFile({
        url: entries[i]!.url!,
        content: `<html lang="${config?.defaultLocale ?? 'en'}"><body>${body}</body></html>`,
      });
      if (result.errors.length)
        throw new Error(`Pagefind indexing failed for ${doc.path}: ${result.errors.join('; ')}`);
    }
    const result = await index.getFiles();
    if (result.errors.length) throw new Error(`Pagefind output failed: ${result.errors.join('; ')}`);
    for (const file of result.files) {
      const path = `pagefind/${file.path}`;
      files[path] = file.content;
      manifestEntries[path] = path;
    }
  } finally {
    await index.deleteIndex();
    if (--activeSearchBuilds === 0) await pagefind.close();
  }

  return {
    manifestEntries,
    entries,
    files,
  };
}

export async function generateSearchIndex(
  corpus: CorpusGraph,
  config?: LumenConfig,
  options?: CorpusProjectionOptions
): Promise<SearchIndexResult> {
  return buildSearchIndex(corpus, config, options);
}
