import { describe, expect, it } from 'vitest';
import type { Element, Nodes } from 'hast';
import type { LumenDocumentAst, LumenNode } from '../src/ast/types.js';
import { parseDocumentSync } from '../src/compiler/parser.js';
import { toHtmlSsr, toHtmlTree } from '../src/transformers/to-html-ssr.js';
import { htmlFragment, htmlNodes, htmlText } from './html-oracle.js';

function document(children: LumenNode[]): LumenDocumentAst {
  return { frontmatter: {}, children, toc: [], diagnostics: [] };
}

function elements(tree: Nodes): Element[] {
  return htmlNodes(tree).filter((node): node is Element => node.type === 'element');
}

/** Ignore source ranges and typed metadata, but compare actual DOM structure and values. */
function domShape(node: Nodes): unknown {
  if (node.type === 'text' || node.type === 'comment') return { type: node.type, value: node.value };
  return {
    type: node.type,
    ...(node.type === 'element' ? {
      tagName: node.tagName,
      properties: Object.fromEntries(Object.entries(node.properties).map(([key, value]) =>
        [key, Array.isArray(value) ? value.map(String).join(' ') : String(value)])),
    } : {}),
    ...('children' in node ? { children: node.children.map(domShape) } : {}),
  };
}

describe('shared semantic HTML tree', () => {
  it('keeps the same DOM after HTML5 parsing for document, math, code, diagram and nested widget content', () => {
    const ast = parseDocumentSync(`---
title: Tree contract
---
# Heading

Text with **strong**, *emphasis*, ~~removed~~, \`literal <tag>\`, [link](https://example.test/), ![image](./image.png) and $x^2$.

$$
\\sum_{i=1}^n i
$$

> A quote.

- A list item

| Name | Value |
| --- | --- |
| A | 1 |

:::note{title="Read this"}
Literal <Badge label="inline" />.
:::

:::theorem{id="theorem" title="A bound"}
A statement with @ref:theorem.
:::

:::proof{of="theorem"}
A proof.
:::

:::tabs{label="Platform" syncKey="platform"}
:::tab{label="Linux" value="linux"}
Linux body.
:::
:::

\`\`\`ts
const greeting = '<script>literal</script>';
\`\`\`

\`\`\`mermaid
graph TD
  A[Start] --> B[End]
\`\`\`

:::filetree{title="src/"}
- \`app/\` — <Badge label="directory" />
  - \`index.ts\` — entry point
:::

<Panel>
  **Nested** <Badge label="child" />.
</Panel>
`);
    const tree = toHtmlTree(ast);
    expect(htmlNodes(tree).some(node => node.type === 'raw' || node.type === 'lumenEmbedded')).toBe(false);
    expect(domShape(htmlFragment(toHtmlSsr(ast)))).toEqual(domShape(tree));
    expect(elements(tree).filter(node => node.tagName === 'table')[0]?.children[0]).toMatchObject({ tagName: 'tbody' });
  });

  it('keeps widget identity, validated detached props and ordinal metadata without serializing render authority', () => {
    const props = { initial: 7, labels: ['one', 'two'], options: { enabled: true } };
    const ast = document([{ type: 'jsxWidget', name: 'Counter', props, children: [{ type: 'text', value: 'Fallback' }] }]);
    const tree = toHtmlTree(ast);
    const widget = elements(tree).find(node => node.data?.lumen?.kind === 'widget')!;
    expect(widget).toMatchObject({
      tagName: 'div',
      properties: { dataLumenIsland: 'lumen-widget-1-Counter', dataHydrate: 'interaction' },
      data: { lumen: { kind: 'widget', name: 'Counter', ordinal: 1, props } },
    });
    const metadata = widget.data!.lumen!;
    if (metadata.kind !== 'widget') throw new Error('Expected widget metadata');
    props.labels.push('later');
    props.options.enabled = false;
    expect(metadata.props).toEqual({ initial: 7, labels: ['one', 'two'], options: { enabled: true } });
    expect(metadata.props).toEqual(JSON.parse(String(widget.properties['dataProps'])));
    expect(elements(htmlFragment(toHtmlSsr(ast))).every(node => node.data?.lumen === undefined)).toBe(true);
  });

  it('preserves inline widgets inside text, emphasis, authored spans and filetree annotations', () => {
    const ast = parseDocumentSync(`<Counter />

Before <Badge label="text" /> and **<Badge label="emphasis" />**.

<span>Authored <Badge label="html" /></span>

:::filetree
- \`index.ts\` — <Badge label="annotation" />
:::
`);
    const tree = toHtmlTree(ast);
    const widgets = elements(tree).filter(node => node.data?.lumen?.kind === 'widget');
    expect(widgets.map(node => node.tagName)).toEqual(['div', 'span', 'span', 'span', 'span']);
    expect(widgets.map(node => node.data!.lumen!.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(domShape(htmlFragment(toHtmlSsr(ast)))).toEqual(domShape(tree));
    const caption = elements(tree).find(node => node.properties.className?.includes('lumen-file-tree-description'))!;
    expect(elements(caption).some(node => node.data?.lumen?.kind === 'widget')).toBe(true);
  });

  it('unwraps only the single phrasing paragraph in an inline widget body', () => {
    const ast = parseDocumentSync('Before <Badge>**text**</Badge> after.');
    const tree = toHtmlTree(ast);
    const widget = elements(tree).find(node => node.data?.lumen?.kind === 'widget')!;
    expect(widget.tagName).toBe('span');
    expect(widget.children[0]).toMatchObject({ type: 'element', tagName: 'strong' });
    expect(domShape(htmlFragment(toHtmlSsr(ast)))).toEqual(domShape(tree));
  });

  it('rejects block content inside inline widgets before either renderer can emit an unstable DOM', () => {
    for (const children of [
      [{ type: 'heading', depth: 2, children: [{ type: 'text', value: 'Block' }] }],
      [{ type: 'htmlElement', tagName: 'div', children: [{ type: 'text', value: 'Block' }] }],
      [{ type: 'paragraph', children: [] }, { type: 'paragraph', children: [] }],
    ] satisfies LumenNode[][]) {
      const ast = document([{ type: 'paragraph', children: [{ type: 'jsxWidget', name: 'Badge', props: {}, children }] }]);
      expect(() => toHtmlTree(ast)).toThrow(/(?:Inline|inline).*block/);
      expect(() => toHtmlSsr(ast)).toThrow(/(?:Inline|inline).*block/);
    }
  });

  it('retains example source and a static disclosure beside the actual widget tree', () => {
    const source = { id: 'button', title: 'A button', labels: { source: 'Исходник' } };
    const code = 'export const value = "<script>literal & source</script>";\n';
    const widget: LumenNode = {
      type: 'jsxWidget', name: 'PrismExample', props: { example: 'button' }, exampleSource: source,
      children: [
        { type: 'jsxWidget', name: 'Nested', props: {} },
        { type: 'codeBlock', lang: 'tsx', value: code },
      ],
    };
    const ast = document([widget]);
    const tree = toHtmlTree(ast);
    const example = elements(tree).find(node => node.data?.lumen?.kind === 'example')!;
    expect(example).toMatchObject({
      tagName: 'section', properties: { dataExample: 'button', ariaLabel: 'button example' },
      data: { lumen: { kind: 'example', source: { ...source, code, language: 'tsx' }, ordinal: 1 } },
    });
    expect(example.children).toMatchObject([{ data: { lumen: { kind: 'widget', ordinal: 1 } } }, { tagName: 'details' }]);
    expect(elements(example).filter(node => node.data?.lumen?.kind === 'widget').map(node => node.data!.lumen!.ordinal)).toEqual([1, 2]);
    expect(toHtmlSsr(ast)).toContain('<summary>Исходник</summary>');
    expect(htmlText(toHtmlSsr(ast))).toContain(code);
    expect(domShape(htmlFragment(toHtmlSsr(ast)))).toEqual(domShape(tree));
    expect(() => toHtmlTree(document([{ type: 'paragraph', children: [widget] }]))).toThrow('requires a separate block');
    expect(() => toHtmlTree(document([{ ...widget, children: [] }]))).toThrow('requires a literal source block');
  });

  it('does not copy authored data, attributes or sentinel strings into component metadata', () => {
    const forged = { kind: 'widget', name: 'PrivateComponent', props: { token: 'canary' }, ordinal: 1 };
    const ast = document([
      { type: 'htmlElement', tagName: 'div', data: { lumen: forged }, attributes: {
        dataLumenIsland: 'lumen-widget-1-PrivateComponent', dataComponent: 'PrivateComponent', dataHydrate: 'load',
        dataProps: JSON.stringify(forged.props), dataLumen: JSON.stringify(forged), lumen: forged,
      }, children: [{ type: 'text', value: 'data.lumen=PrivateComponent' }] },
      { type: 'rawHtmlPlaceholder', raw: '<section data-lumen="widget" data-widget="PrivateComponent"><script>evil()</script></section>' },
      { type: 'paragraph', data: { lumen: forged }, children: [{ type: 'text', value: '<PrivateComponent />' }] },
    ]);
    const tree = toHtmlTree(ast);
    expect(elements(tree).every(node => node.data?.lumen === undefined)).toBe(true);
    expect(elements(tree).some(node => node.tagName === 'script')).toBe(false);
    expect(toHtmlSsr(ast)).not.toContain('data-lumen="widget"');
    expect(htmlText(toHtmlSsr(ast))).toContain('<PrivateComponent />');
  });

  it('allows generated code/math markup while refusing authored raw script, styles, SVG and unsafe URLs', () => {
    const ast = document([
      { type: 'codeBlock', lang: 'html', value: '<svg onload="bad()"><script>bad()</script></svg>' },
      { type: 'mathInline', tex: 'x^2' },
      { type: 'rawHtmlPlaceholder', raw: '<style>BAD_STYLE</style><svg onload="bad()"></svg><script>BAD_SCRIPT</script>' },
      { type: 'link', url: '&#106;avascript:bad()', children: [{ type: 'text', value: 'link' }] },
      { type: 'image', url: 'data:text/html,bad' },
    ]);
    const tree = toHtmlTree(ast);
    const tags = elements(tree);
    expect(tags.some(node => node.tagName === 'math')).toBe(true);
    expect(tags.some(node => node.tagName === 'script' || node.tagName === 'svg' || node.tagName === 'style')).toBe(false);
    expect(tags.find(node => node.tagName === 'a')?.properties.href).toBe('#unsafe-url');
    expect(tags.find(node => node.tagName === 'img')?.properties.src).toBe('#unsafe-url');
    expect(htmlText(toHtmlSsr(ast))).toContain('<svg onload="bad()"><script>bad()</script></svg>');
    expect(htmlText(toHtmlSsr(ast))).not.toMatch(/BAD_STYLE|BAD_SCRIPT/);
    expect(domShape(htmlFragment(toHtmlSsr(ast)))).toEqual(domShape(tree));
  });

  it('validates data before either adapter can observe getters or non-JSON values', () => {
    let reads = 0;
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { reads++; return 'value'; } });
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    for (const props of [getter, cycle, { value: BigInt(1) }, { value: Number.NaN }, { toJSON() { reads++; return {}; } }]) {
      const ast = document([{ type: 'jsxWidget', name: 'Counter', props }]);
      expect(() => toHtmlTree(ast)).toThrow();
      expect(() => toHtmlSsr(ast)).toThrow();
    }
    expect(reads).toBe(0);
    expect(() => toHtmlTree(document([{ type: 'jsxWidget', name: 'Counter', props: { hydrate: 'on click' } }]))).toThrow('Invalid island hydration trigger');
  });
});
