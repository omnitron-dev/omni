import { describe, expect, it } from 'vitest';
import { createDocumentAccessPredicate, projectDocumentAccess } from '../src/ast/access.js';
import type { LumenDocumentAst, LumenNode } from '../src/ast/types.js';
import { parseDocumentSync } from '../src/compiler/parser.js';
import { toCleanMarkdown } from '../src/transformers/to-clean-markdown.js';
import { toHtmlSsr } from '../src/transformers/to-html-ssr.js';

function walk(nodes: LumenNode[]): LumenNode[] {
  return nodes.flatMap((node) => [node, ...walk(node.children ?? [])]);
}

function semantics(nodes: LumenNode[]): unknown {
  const fields = [
    'type',
    'value',
    'tex',
    'lang',
    'meta',
    'ordered',
    'start',
    'checked',
    'align',
    'url',
    'alt',
    'title',
    'identifier',
    'label',
    'referenceType',
    'depth',
    'code',
    'engine',
  ];
  return nodes.map((node) => ({
    ...Object.fromEntries(
      fields.filter((field) => node[field] !== undefined && node[field] !== null).map((field) => [field, node[field]])
    ),
    children: semantics(node.children ?? []),
  }));
}

function roundTrip(source: string) {
  const ast = parseDocumentSync(source);
  expect(ast.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  const markdown = toCleanMarkdown(ast);
  const reparsed = parseDocumentSync(markdown);
  expect(reparsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ast, markdown, reparsed };
}

describe('clean Markdown through the ordinary parser', () => {
  it.each([
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '&lt;img src=x onerror=alert(1)&gt;',
    '&lt;Counter initial={1} /&gt;',
    '&#42;literal emphasis&#42; &amp;copy; &#91;label&#93;(url) \\# plain',
    '\\:note[ordinary text] and \\$5, \\*literal\\*',
  ])('preserves literal text rather than activating syntax: %s', (source) => {
    const { ast, reparsed } = roundTrip(source);
    expect(semantics(reparsed.children)).toEqual(semantics(ast.children));
    expect(toHtmlSsr(reparsed)).toBe(toHtmlSsr(ast));
    expect(walk(reparsed.children).some((node) => node.type === 'htmlElement' || node.type === 'jsxWidget')).toBe(
      false
    );
  });

  it('round-trips arbitrary code delimiters, indentation, language and metadata', () => {
    const source =
      '`````markdown demo="nested"\n```js\nconst text = `<script>&x</script>`;\n```\n````\n  preserved indent\n`````\n\nHere is `` `value` `` and ``` two `` ticks ```.';
    const { ast, reparsed } = roundTrip(source);
    expect(semantics(reparsed.children)).toEqual(semantics(ast.children));
  });

  it('preserves ordered start, nested lists, task states and block content within list items', () => {
    const source =
      '3. First paragraph\n\n   Second paragraph\n\n   - [x] Completed **item**\n   - [ ] Pending\n\n     > A quoted child\n\n4. Next\n\n   ```js\n   run();\n   ```';
    const { ast, reparsed } = roundTrip(source);
    expect(semantics(reparsed.children)).toEqual(semantics(ast.children));
    expect(
      walk(reparsed.children)
        .filter((node) => node.type === 'listItem')
        .map((node) => node.checked)
    ).toContain(true);
  });

  it('emits real GFM table structure with alignments, pipes, formatting and inline code', () => {
    const source =
      '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a\\|b | **bold** and `x\\|y` | [link](https://example.test/a) |';
    const { ast, reparsed } = roundTrip(source);
    expect(reparsed.children[0]?.type).toBe('table');
    expect(semantics(reparsed.children)).toEqual(semantics(ast.children));
  });

  it('preserves link/image references, footnotes, hard breaks and thematic breaks', () => {
    const source =
      '[Named][key] and ![alt][image]. Note[^n].\n\n[key]: https://example.test/a_(b) "A title"\n[image]: /asset.png "Image"\n\n[^n]: A **footnote**.\n\nLine one\\\nLine two\n\n---';
    const { ast, reparsed } = roundTrip(source);
    expect(semantics(reparsed.children)).toEqual(semantics(ast.children));
  });

  it('preserves inline/display math and diagram source with embedded fence characters', () => {
    const source =
      'Formula $x^2 + \\alpha$ and price \\$5.\n\n$$\n\\frac{x}{y} + \\text{cost $5}\n$$\n\n````mermaid\nflowchart LR\n A["```"] --> B\n````';
    const { ast, reparsed } = roundTrip(source);
    expect(semantics(reparsed.children)).toEqual(semantics(ast.children));
  });

  it('uses the shared URL policy for direct links, images and reference definitions', () => {
    const { reparsed } = roundTrip(
      '[click](javascript:alert) ![image](data:text/html,x) [ref][bad]\n\n[bad]: vbscript:evil\n\n[safe](<https://example.test/a b?q=(x)> "quoted title")'
    );
    const urls = walk(reparsed.children)
      .filter((node) => typeof node.url === 'string')
      .map((node) => node.url);
    expect(urls).toEqual(['#unsafe-url', '#unsafe-url', '#unsafe-url', 'https://example.test/a b?q=(x)']);
    expect(toHtmlSsr(reparsed)).not.toMatch(/(?:href|src)="(?:javascript|data|vbscript):/);
  });

  it('preserves inline HTML adjacency and renders HTML children as HTML rather than Markdown', () => {
    const source =
      'Before <span>middle &lt;script&gt; *literal*</span> after.\n\n<section><p>**literal** &lt;img src=x onerror=boom&gt;</p><b>bold</b></section>';
    const { ast, markdown, reparsed } = roundTrip(source);
    expect(toHtmlSsr(reparsed)).toBe(toHtmlSsr(ast));
    expect(markdown).not.toContain('\\*literal');
    expect(markdown).not.toContain('\\<script');
  });

  it('removes runtime metadata at every HTML nesting level and does not expose blocked subtrees', () => {
    const source =
      '<section><div data-props="SECRET_PROPS"><span data-lumen-island="id" data-component="Thing">Fallback &lt;script&gt;</span></div><script data-widget="fake">HIDDEN_SCRIPT</script></section>';
    const { markdown, reparsed } = roundTrip(source);
    expect(markdown).not.toMatch(/SECRET_PROPS|HIDDEN_SCRIPT|data-props|data-component|data-lumen-island/);
    expect(toHtmlSsr(reparsed)).toContain('Fallback &lt;script&gt;');
    expect(toHtmlSsr(reparsed)).not.toContain('<script>');
  });

  it('keeps only the projected body when unwrapping an island', () => {
    const ast = parseDocumentSync(
      '<section data-lumen-island="id"><span>Visible &lt;script&gt;</span><div data-access="confidential">PRIVATE</div></section>'
    );
    const projected = projectDocumentAccess(ast, createDocumentAccessPredicate()).ast;
    const markdown = toCleanMarkdown(projected);
    const reparsed = parseDocumentSync(markdown);
    expect(toHtmlSsr(reparsed)).toContain('Visible &lt;script&gt;');
    expect(markdown).not.toMatch(/PRIVATE|data-lumen-island/);
    expect(toHtmlSsr(reparsed)).not.toContain('<script>');
  });

  it('serializes unknown leaves as text and never reads a container cache', () => {
    const ast: LumenDocumentAst = {
      frontmatter: {},
      toc: [],
      diagnostics: [],
      rawContent: 'PRIVATE_RAW',
      children: [
        { type: 'extension', raw: '<script>alert(1)</script> **literal**' },
        { type: 'extension', raw: 'PRIVATE_CACHE', value: 'PRIVATE_CACHE', children: [] },
      ],
    };
    const markdown = toCleanMarkdown(ast);
    const reparsed = parseDocumentSync(markdown);
    expect(
      walk(reparsed.children)
        .filter((node) => node.type === 'text')
        .map((node) => node.value)
        .join('')
    ).toBe('<script>alert(1)</script> **literal**');
    expect(toHtmlSsr(reparsed)).not.toContain('<script>');
    expect(markdown).not.toContain('PRIVATE');
  });

  it('expands smart references in inline and block contexts consistently', () => {
    const ast = parseDocumentSync('See @ref:lemma.');
    const reparsed = parseDocumentSync(toCleanMarkdown(ast, { expandSmartRefs: true }));
    const link = walk(reparsed.children).find((node) => node.type === 'link');
    expect(link?.url).toBe('#lemma');
    expect(link?.children?.[0]?.value).toBe('lemma');
  });

  it('retains a smart reference after projection clears source caches in mixed HTML', () => {
    const ast = parseDocumentSync('Before <span>safe</span> @ref:lemma.');
    const projected = projectDocumentAccess(ast, createDocumentAccessPredicate()).ast;
    const reparsed = parseDocumentSync(toCleanMarkdown(projected));
    expect(walk(reparsed.children).find((node) => node.type === 'smartRef')).toMatchObject({
      domain: 'ref',
      target: 'lemma',
      raw: '@ref:lemma',
    });
  });

  it('keeps an unknown literal leaf safe and readable inside authored HTML', () => {
    const ast: LumenDocumentAst = {
      frontmatter: {},
      toc: [],
      diagnostics: [],
      children: [
        { type: 'htmlElement', tagName: 'section', children: [{ type: 'extension', raw: '<script>literal</script>' }] },
      ],
    };
    const reparsed = parseDocumentSync(toCleanMarkdown(ast));
    expect(toHtmlSsr(reparsed)).toContain('&lt;script&gt;literal&lt;/script&gt;');
    expect(toHtmlSsr(reparsed)).not.toContain('<script>');
  });

  it('exports directive titles as literal labels and keeps their projected block structure', () => {
    const ast: LumenDocumentAst = {
      frontmatter: {},
      toc: [],
      diagnostics: [],
      children: [
        {
          type: 'admonition',
          title: '<script> *plain*',
          children: [
            {
              type: 'list',
              children: [
                { type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'body' }] }] },
              ],
            },
          ],
        },
      ],
    };
    const reparsed = parseDocumentSync(toCleanMarkdown(ast));
    expect(reparsed.children[0]?.type).toBe('blockquote');
    expect(walk(reparsed.children).some((node) => node.type === 'list')).toBe(true);
    expect(toHtmlSsr(reparsed)).toContain('&lt;script&gt; *plain*');
    expect(toHtmlSsr(reparsed)).not.toContain('<script>');
  });
});
