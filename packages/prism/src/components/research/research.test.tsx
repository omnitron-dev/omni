import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchDocument, defineResearchWidget } from './document.js';
import { parseResearchMarkdown, researchLimits } from './parse.js';
import { registerTipTapNode, TipTapRenderer } from '../tiptap-renderer/index.js';
import { diagramSourceAllowed } from './diagram.js';
const html = (source: string) => renderToStaticMarkup(<ResearchDocument source={source} documentId="test" />);
describe('Research Markdown source contract', () => {
  it('retains source positions, Unicode headings and unambiguous duplicate anchors', () => {
    const p = parseResearchMarkdown('# Разум\n\n## Разум\n\n## Разум-2\n\n## 意识\n\nA $x^2$ proof.', 'doc');
    expect(new Set(p.headings.map((h) => h.id)).size).toBe(4);
    expect(p.headings.map((h) => h.title)).toEqual(['Разум', 'Разум', 'Разум-2', '意识']);
    expect(p.doc.content[0]?.attrs?.source).toMatchObject({ start: { line: 1, offset: 0 } });
    expect(p.diagnostics).toEqual([]);
  });
  it('resolves reference links and preserves untrusted or unknown source as inert text', () => {
    expect(html('[A][ref]\n\n[ref]: https://example.org')).toContain('href="https://example.org"');
    const source = '<script>alert(1)</script>\n\n:::mystery\nPreserve me\n:::';
    const p = parseResearchMarkdown(source);
    expect(p.diagnostics.map((d) => d.code)).toEqual(['raw_html', 'unknown_directive']);
    const rendered = html(source);
    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
    expect(rendered).toContain('Preserve me');
  });
  it('does not silently drop unsupported footnotes or malformed tabs', () => {
    const source = 'A note[^1].\n\n[^1]: Its source.\n\n:::tabs\nAccidental prose\n:::';
    expect(html(source)).toContain('Its source.');
    expect(html(source)).toContain('Accidental prose');
    expect(parseResearchMarkdown(source).diagnostics.some((d) => d.code === 'invalid_tabs')).toBe(true);
  });
  it('enforces source size and stable namespaces before interpretation', () => {
    expect(() => parseResearchMarkdown('x'.repeat(researchLimits.source + 1))).toThrow('document_limit');
    expect(() => parseResearchMarkdown('# a', '<bad>')).toThrow('invalid_document_prefix');
  });
  it('renders accessible math without trusting TeX links or HTML commands', () => {
    const good = html('An expression $x^2 + y^2$.');
    expect(good).toContain('<math');
    expect(good).toContain('annotation encoding="application/x-tex"');
    const untrusted = html('$\\href{javascript:alert(1)}{click}$');
    expect(untrusted).not.toContain('href="javascript:');
    expect(html('$\\unknowncommand{x}$')).toContain('prism-research__invalid-math');
    expect(html('$\\unknowncommand{x}$')).not.toContain('<details');
  });
  it('isolates widget capabilities per document and validates version and props', () => {
    const source = '```prism\n{"type":"counter","version":1,"props":{"value":3}}\n```';
    const widgets = {
      counter: defineResearchWidget(
        1,
        (v: unknown) => {
          if (!v || typeof v !== 'object' || !('value' in v) || typeof v.value !== 'number') throw Error();
          return { value: v.value };
        },
        ({ value }: { value: number }) => <output>{value}</output>
      ),
    };
    expect(renderToStaticMarkup(<ResearchDocument source={source} widgets={widgets} />)).toContain(
      '<output>3</output>'
    );
    expect(html(source)).not.toContain('<output>');
    expect(
      renderToStaticMarkup(<ResearchDocument source={source.replace('"version":1', '"version":2')} widgets={widgets} />)
    ).not.toContain('<output>');
    expect(
      renderToStaticMarkup(<ResearchDocument source={source.replace('"value":3', '"value":"bad"')} widgets={widgets} />)
    ).toContain('source is preserved');
  });
  it('ignores legacy global node registrations inside research documents', () => {
    registerTipTapNode('paragraph', () => <aside>global capability</aside>);
    expect(html('plain text')).not.toContain('global capability');
    expect(
      renderToStaticMarkup(<TipTapRenderer content={{ type: 'doc', content: [{ type: 'paragraph', content: [] }] }} />)
    ).toContain('global capability');
  });
  it('keeps diagram languages distinct and refuses source-controlled configuration', () => {
    expect(diagramSourceAllowed('flowchart LR\nA --> B', 'mermaid')).toBe(true);
    expect(diagramSourceAllowed('activityDiagram', 'pintora')).toBe(false);
    expect(diagramSourceAllowed('%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B', 'mermaid')).toBe(false);
    expect(diagramSourceAllowed('---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\nA-->B', 'mermaid')).toBe(
      false
    );
    expect(parseResearchMarkdown('```pintora\nactivityDiagram\n```').doc.content[0]?.attrs?.engine).toBe('pintora');
  });
  it('removes active link schemes including internalLink marks', () => {
    expect(html('[link](javascript:alert%281%29)')).not.toContain('href="javascript:');
    const rendered = renderToStaticMarkup(
      <TipTapRenderer
        inheritRegisteredNodes={false}
        content={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'bad',
                  marks: [{ type: 'internalLink', attrs: { href: 'javascript:alert(1)' } }],
                },
              ],
            },
          ],
        }}
      />
    );
    expect(rendered).not.toContain('href="javascript:');
  });
});
