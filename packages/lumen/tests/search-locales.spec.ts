import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { parseDocumentSync } from '@omnitron-dev/lumen-ast';
import { CorpusGraph } from '../src/corpus/graph.js';
import { defineLumenConfig } from '../src/config/define.js';
import { buildSearchIndex } from '../src/search/index-builder.js';

function corpus(locales: Array<string | undefined>): CorpusGraph {
  const graph = new CorpusGraph();
  locales.forEach((locale, i) => {
    graph.addDocument({ id: `guide-${i}`, path: `guide-${i}.md`, title: `Guide ${i}`,
      hash: `fixture-${i}`, anchors: [], mathObjects: [], backlinks: [],
      ...(locale === undefined ? {} : { locale }), ast: parseDocumentSync(`# Guide ${i}\n\nNeedle.`) });
  });
  return graph;
}

describe('Pagefind language indexes', () => {
  it('keeps document languages separate and applies the default only to unlabelled documents', async () => {
    const config = defineLumenConfig({ title: 'Guide', locales: ['en', 'fr'], defaultLocale: 'en' });
    const result = await buildSearchIndex(corpus(['en', 'FR', undefined]), config);
    const bytes = result.files['pagefind/pagefind-entry.json']!;
    const entry = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
    expect(Object.keys(entry.languages).sort()).toEqual(['en', 'fr']);
    expect(entry.languages.en.page_count).toBe(2);
    expect(entry.languages.fr.page_count).toBe(1);
  });

  it.each(['en" data-pagefind-ignore="all', '', 'en_US'])('rejects invalid document language %j', async locale => {
    await expect(buildSearchIndex(corpus([locale]))).rejects.toThrow();
  });
});

it.each([false, true])('publishes relocatable Pagefind routes and public result URLs with trailingSlash=%s', async trailingSlash => {
  const graph = corpus(['en', 'en', 'en', 'en']);
  const routes = ['/', '/intro', '/manual/nested', '/standalone.html'];
  for (const [index, doc] of graph.getAllDocuments().entries()) doc.routePath = routes[index]!;
  const config = defineLumenConfig({ title: 'Manual', baseUrl: '/manual/', trailingSlash });
  const result = await buildSearchIndex(graph, config);
  const canonical = ['/', trailingSlash ? '/intro/' : '/intro', trailingSlash ? '/manual/nested/' : '/manual/nested', '/standalone.html'];
  expect(result.entries.map(entry => entry.url).sort()).toEqual(canonical.map(route => '/manual' + route).sort());
  const paths = Object.entries(result.files).filter(([name]) => name.endsWith('.pf_fragment')).map(([, bytes]) => {
    const fragment = gunzipSync(bytes).toString();
    return JSON.parse(fragment.slice('pagefind_dcd'.length)).url;
  });
  expect(paths.sort()).toEqual(canonical.sort());
});
