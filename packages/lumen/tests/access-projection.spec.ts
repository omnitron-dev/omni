import { describe, expect, it } from 'vitest';
import { parseDocumentSync } from '@omnitron-dev/lumen-ast';
import { buildStaticSite, CorpusGraph, defineLumenConfig } from '../src/index.js';

function corpus(source: string): CorpusGraph {
  const graph = new CorpusGraph();
  graph.addDocument({
    id: 'guide',
    path: 'guide.pdx',
    title: 'Guide',
    hash: 'fixture',
    anchors: [],
    mathObjects: [],
    backlinks: [],
    ast: parseDocumentSync(source),
  });
  return graph;
}
function text(output: Awaited<ReturnType<typeof buildStaticSite>>): string {
  return JSON.stringify([...output.pages, ...output.mirrors, ...output.assets, output.llmsTxt, output.llmsFullTxt]);
}

describe('SSG authorization across all generated artifacts', () => {
  const config = defineLumenConfig({ title: 'Access fixture' });

  it('omits restricted Markdown within HTML from pages, mirrors, search and LLM exports', async () => {
    const graph = corpus(
      '# Visible guide\n\nPublic sentence.\n\n<section data-access="confidential">\n\n## SECRET_HEADING\n\nSECRET_BODY\n\n</section>\n\nPublic ending.'
    );
    const publicOutput = await buildStaticSite(graph, config);
    expect(text(publicOutput)).not.toContain('SECRET_');
    expect(publicOutput.pages.get('/guide')).toContain('Public sentence');
    expect(publicOutput.llmsFullTxt).toContain('Public ending');
    const privileged = await buildStaticSite(graph, config, { roles: ['admin'] });
    expect(privileged.pages.get('/guide')).toContain('SECRET_BODY');
    expect(privileged.llmsFullTxt).toContain('SECRET_BODY');
  });

  it('does not include malformed metadata even when the requested audience is admin', async () => {
    const output = await buildStaticSite(corpus('---\naccess: [broken\n---\nPRIVATE_PAYLOAD'), config, {
      roles: ['admin'],
    });
    expect(output.pagesCount).toBe(0);
    expect(text(output)).not.toContain('PRIVATE_PAYLOAD');
    expect(output.llmsTxt).not.toContain('Guide');
  });

  it('carries the same configurable grants through every output stage', async () => {
    const graph = corpus('---\naccess: internal\n---\n# Internal guide\n\nINTERNAL_CONTENT');
    const allowed = await buildStaticSite(graph, config, {
      roles: ['reviewer'],
      accessFilter: { grants: { reviewer: ['docs.read.internal'] } },
    });
    expect(allowed.pages.get('/guide')).toContain('INTERNAL_CONTENT');
    expect(allowed.llmsFullTxt).toContain('INTERNAL_CONTENT');
    const denied = await buildStaticSite(graph, config, {
      roles: ['staff'],
      accessFilter: { grants: { staff: ['docs.read.public'] } },
    });
    expect(denied.pagesCount).toBe(0);
    expect(text(denied)).not.toContain('INTERNAL_CONTENT');
  });
});
