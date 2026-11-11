import { toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import type { CorpusGraph } from '../corpus/graph.js';
import { projectCorpus, type CorpusProjectionOptions } from '../corpus/projection.js';
import type { LumenConfig } from '../config/schema.js';

export function generateLlmsFullTxt(
  corpus: CorpusGraph,
  _config: LumenConfig,
  options?: CorpusProjectionOptions
): string {
  const projectedCorpus = projectCorpus(corpus, options);
  const topoOrder = projectedCorpus.getTopologicalOrder();
  const documentSections: string[] = [];

  for (const docId of topoOrder) {
    const doc = projectedCorpus.getDocument(docId);
    if (!doc) continue;

    if (doc.ast) {
      const clean = toCleanMarkdown(doc.ast, { includeFrontmatter: true });
      if (clean.trim()) {
        documentSections.push(clean.trim());
      }
    } else {
      const title = doc.title || docId;
      documentSections.push(`# ${title}`.trim());
    }
  }

  const body = documentSections.join('\n\n---\n\n');
  return `# Complete Knowledge Graph Corpus\n\n${body}`.trim();
}
