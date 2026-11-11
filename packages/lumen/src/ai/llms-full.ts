import { toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';

export function generateLlmsFullTxt(corpus: CorpusGraph, _config: LumenConfig): string {
  const topoOrder = corpus.getTopologicalOrder();
  const documentSections: string[] = [];

  for (const docId of topoOrder) {
    const doc = corpus.getDocument(docId);
    if (!doc) continue;

    if (doc.ast) {
      const clean = toCleanMarkdown(doc.ast, { includeFrontmatter: true });
      if (clean.trim()) {
        documentSections.push(clean.trim());
      }
    } else {
      const title = doc.title || docId;
      const raw = doc.frontmatter?.['rawContent'] ?? '';
      documentSections.push(`# ${title}\n\n${raw}`.trim());
    }
  }

  const body = documentSections.join('\n\n---\n\n');
  return `# Complete Knowledge Graph Corpus\n\n${body}`.trim();
}
