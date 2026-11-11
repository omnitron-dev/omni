import { toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';

export function generateRouteMirrors(corpus: CorpusGraph, _config: LumenConfig): Map<string, string> {
  const mirrors = new Map<string, string>();
  const docs = corpus.getAllDocuments();

  for (const doc of docs) {
    const cleanMd = doc.ast
      ? toCleanMarkdown(doc.ast, {
          includeFrontmatter: true,
          stripInternalProps: true,
        })
      : `# ${doc.title}\n\n${doc.path}`;

    const baseRoute = doc.routePath ?? `/${doc.path.replace(/\.(pdx|md)$/, '')}`;
    const normalizedRoute = baseRoute.startsWith('/') ? baseRoute : `/${baseRoute}`;

    mirrors.set(normalizedRoute, cleanMd);
    mirrors.set(`${normalizedRoute}.md`, cleanMd);

    // Also register without srcDir prefix (e.g. /docs/intro -> /intro)
    const strippedRoute = normalizedRoute.replace(/^\/docs\//, '/');
    if (strippedRoute !== normalizedRoute) {
      mirrors.set(strippedRoute, cleanMd);
      mirrors.set(`${strippedRoute}.md`, cleanMd);
    }
  }

  return mirrors;
}
