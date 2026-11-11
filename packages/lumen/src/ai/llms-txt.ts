import type { CorpusGraph } from '../corpus/graph.js';
import type { LumenConfig } from '../config/schema.js';

export function generateLlmsTxt(corpus: CorpusGraph, config: LumenConfig): string {
  const title = config.title || 'Lumen Documentation';
  const tagline =
    config.tagline || 'High performance documentation system for modern scientific and engineering projects.';

  const url = (config.url ?? 'http://localhost:3000').replace(/\/+$/, '');
  let baseUrl = config.baseUrl ?? '/';
  if (!baseUrl.startsWith('/')) baseUrl = `/${baseUrl}`;
  if (!baseUrl.endsWith('/')) baseUrl = `${baseUrl}/`;

  const lines: string[] = [`# ${title}`, '', `> ${tagline}`, '', '## Documentation Index'];

  const docs = corpus.getAllDocuments();
  if (docs.length === 0) {
    lines.push('- No documents currently registered.');
  } else {
    for (const doc of docs) {
      let route = doc.routePath ?? doc.path.replace(/\.(pdx|md)$/, '');
      const srcDirPrefix = (config.srcDir || 'docs').replace(/\/+$/, '') + '/';
      if (route.startsWith(srcDirPrefix)) {
        route = route.slice(srcDirPrefix.length);
      }
      route = route.replace(/^\/+/, '');

      let summary = doc.frontmatter?.['description'] as string | undefined;
      if (!summary && doc.ast?.rawContent) {
        const paragraphs = doc.ast.rawContent
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean);
        summary = paragraphs.find((p) => !p.startsWith('#') && !p.startsWith('---'));
      }
      if (!summary) {
        summary = doc.title || 'Documentation module';
      }

      // Truncate long summary for llms.txt index
      const cleanSummary = summary.replace(/[\r\n]+/g, ' ').trim();
      lines.push(`- [${doc.title || doc.id}](${url}${baseUrl}${route}.md): ${cleanSummary}`);
    }
  }

  return lines.join('\n').trim();
}
