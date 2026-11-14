import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument, toCleanMarkdown, toHtmlSsr } from '@omnitron-dev/lumen-ast';
import { defineLumenConfig } from '../config/define.js';
import { CorpusGraph } from './graph.js';
import { projectCorpus } from './projection.js';
import { resolveExampleSources } from './examples.js';
import { renderDocumentHtml } from '../ssg/render-html.js';
import { generateRouteMirrors } from '../ai/route-mirrors.js';

const roots: string[] = [];
const source = 'throw new Error("MUST NOT EXECUTE");\nexport default () => <div data-test="value">&{"<script>alert(1)</script>"}</div>;\n// [!code highlight]\n';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lumen-examples-'));
  roots.push(root);
  mkdirSync(join(root, 'examples'));
  writeFileSync(join(root, 'examples/sample.tsx'), source);
  return root;
}

async function corpus(markdown: string) {
  const graph = new CorpusGraph();
  graph.addDocument({ id: 'guide', path: 'guide.md', routePath: '/guide', title: 'Guide',
    hash: 'test', anchors: [], mathObjects: [], backlinks: [], ast: await parseDocument(markdown) });
  return graph;
}

const config = () => defineLumenConfig({ title: 'Examples', examples: {
  Demo: { sources: { sample: 'examples/sample.tsx', private: 'examples/must-not-read.tsx' },
    labels: { source: 'Исходник' } },
} });

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('trusted example source projection', () => {
  it('keeps one literal source for no-JS HTML, Markdown and the unchanged client identity', async () => {
    const root = fixture();
    const raw = await corpus('<Demo example="sample" title="Literal example" hydrate="visible" />');
    const projected = projectCorpus(raw);
    resolveExampleSources(projected, config(), root);
    const document = projected.getDocument('guide')!;
    expect(document.ast!.children[0]?.props).toEqual({ example: 'sample', title: 'Literal example', hydrate: 'visible' });
    expect(raw.getDocument('guide')!.ast!.children[0]?.children).toBeUndefined();
    const html = renderDocumentHtml(document.ast!);
    expect(html).toContain('data-example="sample"');
    expect(html).toContain('data-component="Demo"');
    const summary = JSDOM.fragment(html).querySelector('[data-example="sample"] details > summary');
    expect(summary?.textContent).toBe('Исходник');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('// [!code highlight]');
    expect(html).toContain('example-1-');
    const markdown = generateRouteMirrors(projected).get('/guide.md')!;
    expect(markdown).toContain(source);
    expect(markdown).not.toContain('data-props');
    expect(markdown).not.toContain('data-example');
    expect(toCleanMarkdown(document.ast!)).toContain(source);
    expect(toHtmlSsr(document.ast!)).toContain('<summary>Исходник</summary>');
    expect(readFileSync(join(root, 'examples/sample.tsx'), 'utf8')).toBe(source);
  });

  it('never resolves excluded documents, headings, containers or nested protected content', async () => {
    const root = fixture();
    const graph = await corpus('# Public\n\n<Demo example="sample" />\n\n<Demo example="private" access="internal" />\n\n## Secret {access=internal}\n\n<Demo example="private" />');
    const secret = await corpus('---\naccess: confidential\n---\n<Demo example="private" />');
    graph.addDocument({ ...secret.getDocument('guide')!, id: 'secret' });
    const projected = projectCorpus(graph);
    resolveExampleSources(projected, config(), root);
    expect(projected.getAllDocuments()).toHaveLength(1);
    const html = renderDocumentHtml(projected.getDocument('guide')!.ast!);
    expect(html).toContain('MUST NOT EXECUTE');
    expect(html).not.toContain('private');
    expect(html).not.toContain('Secret');
  });

  it.each(['../../secret', '__proto__', 'constructor', 'file:///etc/passwd'])('rejects an unregistered Markdown key %s', async id => {
    const projected = projectCorpus(await corpus(`<Demo example="${id}" />`));
    expect(() => resolveExampleSources(projected, config(), fixture())).toThrow('Unregistered example');
  });

  it('rejects symlink escapes, directories, oversized and non-UTF8 sources without executing them', async () => {
    const root = fixture();
    const outside = fixture();
    symlinkSync(join(outside, 'examples/sample.tsx'), join(root, 'examples/escape.tsx'));
    writeFileSync(join(root, 'examples/large.tsx'), Buffer.alloc(1024 * 1024 + 1));
    writeFileSync(join(root, 'examples/invalid.tsx'), Buffer.from([0xc3, 0x28]));
    for (const [path, error] of [['examples/escape.tsx', 'escapes'], ['examples', 'must be a file'],
      ['examples/large.tsx', 'at most 1 MiB'], ['examples/invalid.tsx', 'encoded data'],
      [join(root, 'examples/sample.tsx'), 'relative']]) {
      const selected = defineLumenConfig({ title: 'Site', examples: { Demo: { sources: { sample: path! } } } });
      const projected = projectCorpus(await corpus('<Demo example="sample" />'));
      expect(() => resolveExampleSources(projected, selected, root)).toThrow(error);
    }
  });
});
