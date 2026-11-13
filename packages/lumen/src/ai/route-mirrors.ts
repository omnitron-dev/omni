import { toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import type { CorpusGraph } from '../corpus/graph.js';
import { projectCorpus, type CorpusProjectionOptions } from '../corpus/projection.js';
import type { LumenConfig } from '../config/schema.js';
import { markdownMirrorPath } from '../corpus/routes.js';

export function generateRouteMirrors(
  corpus: CorpusGraph,
  _config?: LumenConfig,
  options?: CorpusProjectionOptions
): Map<string, string> {
  const mirrors = new Map<string, string>();
  const projectedCorpus = projectCorpus(corpus, options);
  const docs = projectedCorpus.getAllDocuments();

  for (const doc of docs) {
    const cleanMd = doc.ast
      ? toCleanMarkdown(doc.ast, {
          includeFrontmatter: true,
        })
      : `# ${doc.title}\n\n${doc.path}`;

    const baseRoute = doc.routePath ?? `/${doc.path.replace(/\.(pdx|md)$/, '')}`;
    const normalizedRoute = baseRoute.startsWith('/') ? baseRoute : `/${baseRoute}`;

    mirrors.set(normalizedRoute, cleanMd);
    mirrors.set(markdownMirrorPath(normalizedRoute), cleanMd);
  }

  return mirrors;
}
