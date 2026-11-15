import { describe, expect, it } from 'vitest';
import { parseDocumentSync, parseJsxTag, toCleanMarkdown, type LumenNode } from '../src/index.js';

function nodes(children: LumenNode[]): LumenNode[] {
  return children.flatMap((node) => [node, ...nodes(node.children ?? [])]);
}
function sourceOf(source: string, node: LumenNode | undefined): string {
  expect(node?.position, `${node?.type} must refer to the original parse input`).toBeDefined();
  const position = node!.position!;
  for (const point of [position.start, position.end]) {
    const prefix = source.slice(0, point.offset);
    const lines = prefix.split(/\r\n|\r|\n/);
    expect(point).toEqual({ offset: prefix.length, line: lines.length, column: lines.at(-1)!.length + 1 });
  }
  return source.slice(position.start.offset, position.end.offset);
}

describe('source positions use the original document', () => {
  it.each(['\n', '\r\n'])('retains frontmatter and multiline JSX offsets (%j)', (newline) => {
    const source = [
      '---',
      'title: Source map',
      '---',
      '',
      '<Demo',
      '  value={{ answer: 42 }}',
      '/>',
      '',
      '## See also',
      '',
      '[Related](./related)',
      '',
    ].join(newline);
    const ast = parseDocumentSync(source);
    expect(ast.diagnostics).toEqual([]);
    const tree = nodes(ast.children);
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'heading')
      )
    ).toBe('## See also');
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'link')
      )
    ).toBe('[Related](./related)');
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'jsxWidget')
      )
    ).toBe(['<Demo', '  value={{ answer: 42 }}', '/>'].join(newline));
  });

  it('maps headings and links inside recursively dedented JSX to their parent document', () => {
    const source =
      '\uFEFF# Intro\r\n\r\n<Outer>\r\n  <Inner>\r\n    ## Nested\r\n\r\n    [Read more](./next)\r\n  </Inner>\r\n</Outer>\r\n';
    const tree = nodes(parseDocumentSync(source).children);
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'heading' && node.id === 'nested')
      )
    ).toBe('## Nested');
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'link')
      )
    ).toBe('[Read more](./next)');
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'jsxWidget' && node.name === 'Inner')
      )
    ).toBe('<Inner>\r\n    ## Nested\r\n\r\n    [Read more](./next)\r\n  </Inner>');
  });

  it.each(['\n', '\r\n'])('preserves coordinates through tabs, complex attributes and references (%j)', (newline) => {
    const source =
      ':::tabs\n:::tab{label="A"}\nSee @thm:proof.\n:::\n:::\n\n:::theorem{x=[]}\nProof.\n:::\n\n## End\n'.replaceAll(
        '\n',
        newline
      );
    const ast = parseDocumentSync(source);
    expect(ast.diagnostics).toEqual([]);
    const tree = nodes(ast.children);
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'heading')
      )
    ).toBe('## End');
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'smartRef')
      )
    ).toBe('@thm:proof');
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'mathEnvironment')
      )
    ).toBe([':::theorem{x=[]}', 'Proof.', ':::'].join(newline));
  });

  it('keeps source coordinates distinct from decoded text and Unicode display width', () => {
    const source =
      '<Box>\n  😀 &amp; &#x41; \\* @api:@scope/pkg#method, then [@thm:lemma](./next).\n\n  ## **@ref:proof**\n</Box>\n';
    const ast = parseDocumentSync(source);
    expect(ast.diagnostics).toEqual([]);
    const tree = nodes(ast.children);
    expect(tree.filter((node) => node.type === 'smartRef').map((node) => sourceOf(source, node))).toEqual([
      '@api:@scope/pkg#method',
      '@thm:lemma',
      '@ref:proof',
    ]);
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'link')
      )
    ).toBe('[@thm:lemma](./next)');
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'heading')
      )
    ).toBe('## **@ref:proof**');
    for (const node of tree) if (node.position) sourceOf(source, node);
  });

  it('maps contracted directive attributes without padding the parser input', () => {
    const source =
      ':::theorem{dependsOn=["first-long-proof", "second-long-proof"] title="Long title"}\nBody.\n:::\n\n## Next\n';
    const ast = parseDocumentSync(source);
    expect(ast.diagnostics).toEqual([]);
    const tree = nodes(ast.children);
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'mathEnvironment')
      )
    ).toBe(source.slice(0, source.indexOf('\n\n')));
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'heading')
      )
    ).toBe('## Next');
  });

  it('does not reinterpret escaped text or alter code, math, URLs and old marker strings', () => {
    const source =
      '\\@ref:literal @ref\\:colon __LUMEN_COLON__\n\n`@ref:code` $@ref:math$\n\n[link](https://example.test/@ref:destination)\n\n```txt\n@ref:fence\n```\n\nSee @ref:actual.\n';
    const ast = parseDocumentSync(source);
    expect(ast.diagnostics).toEqual([]);
    const tree = nodes(ast.children);
    expect(tree.filter((node) => node.type === 'smartRef').map((node) => sourceOf(source, node))).toEqual([
      '@ref:actual',
    ]);
    expect(tree.find((node) => node.type === 'inlineCode')?.value).toBe('@ref:code');
    expect(tree.find((node) => node.type === 'mathInline')?.tex).toBe('@ref:math');
    expect(tree.find((node) => node.type === 'codeBlock')?.value).toBe('@ref:fence');
    expect(tree.find((node) => node.type === 'link')?.url).toBe('https://example.test/@ref:destination');
    const exported = toCleanMarkdown(ast);
    const roundtrip = nodes(parseDocumentSync(exported).children);
    expect(roundtrip.filter((node) => node.type === 'smartRef').map((node) => node.raw)).toEqual(['@ref:actual']);
  });

  it('binds JSX placeholders to their source ranges instead of trusting authored marker comments', () => {
    const source = '<!--__LUMEN_JSX_TOKEN_0__-->\n\n<Demo value={1} />\n\n## End\n';
    const ast = parseDocumentSync(source);
    expect(ast.diagnostics).toEqual([]);
    const tree = nodes(ast.children);
    expect(tree.filter((node) => node.type === 'jsxWidget').map((node) => sourceOf(source, node))).toEqual([
      '<Demo value={1} />',
    ]);
    expect(
      sourceOf(
        source,
        tree.find((node) => node.type === 'heading')
      )
    ).toBe('## End');
  });

  it('reports nested unsafe JSX at its original line and column', () => {
    const source = '---\r\ntitle: Test\r\n---\r\n\r\n<Outer>\r\n    <Inner value={run()} />\r\n</Outer>';
    const ast = parseDocumentSync(source, 'original.pdx');
    expect(ast.diagnostics).toMatchObject([
      { code: 'JSX_UNSAFE_EXPRESSION', file: 'original.pdx', line: 6, column: 5 },
    ]);
    expect(
      sourceOf(
        source,
        nodes(ast.children).find((node) => node.name === 'Inner')
      )
    ).toBe('<Inner value={run()} />');
  });

  it('uses the standalone JSX input as the coordinate origin', () => {
    const source = '\r\n  <Demo>\r\n    # Inside\r\n  </Demo>  ';
    const parsed = parseJsxTag(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(sourceOf(source, parsed.node)).toBe('<Demo>\r\n    # Inside\r\n  </Demo>');
    expect(
      sourceOf(
        source,
        nodes(parsed.node.children ?? []).find((node) => node.type === 'heading')
      )
    ).toBe('# Inside');
  });

  it('rejects forged reference source during Markdown export', () => {
    expect(() =>
      toCleanMarkdown({
        frontmatter: {},
        toc: [],
        diagnostics: [],
        children: [{ type: 'smartRef', raw: '@ref:ok\n<script>bad()</script>', domain: 'ref', target: 'ok' }],
      })
    ).toThrow('Invalid smart reference');
  });

  it('does not fabricate smart references from invalid prefixes', () => {
    const source = '@'.repeat(1_000) + ' @ref: @1:bad @ref:@bad See @ref:good.';
    const ast = parseDocumentSync(source);
    expect(ast.diagnostics).toEqual([]);
    expect(
      nodes(ast.children)
        .filter((node) => node.type === 'smartRef')
        .map((node) => sourceOf(source, node))
    ).toEqual(['@ref:good']);
  });
});
