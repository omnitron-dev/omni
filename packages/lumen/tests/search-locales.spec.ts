import { describe, expect, it } from 'vitest';
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
