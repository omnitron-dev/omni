import { describe, expect, it } from 'vitest';
import { parseDocumentSync } from '../src/compiler/parser.js';
import { createDocumentAccessPredicate, projectDocumentAccess } from '../src/ast/access.js';
import { toCleanMarkdown } from '../src/transformers/to-clean-markdown.js';
import { toHtmlSsr } from '../src/transformers/to-html-ssr.js';

const project = (source: string, roles = ['anonymous']) =>
  projectDocumentAccess(parseDocumentSync(source), createDocumentAccessPredicate(roles));

describe('canonical document access projection', () => {
  it.each([null, '', false, 0, [], {}, 'restricted', 'unknown'])(
    'rejects invalid classification %j even for admin',
    (access) => {
      expect(createDocumentAccessPredicate(['admin'])(access)).toBe(false);
    }
  );

  it('applies heading restrictions to complete sections and nested subsections', () => {
    const source =
      '# Public\nVisible.\n\n## Private {access="confidential"}\nHidden body.\n\n### Public label {access="public"}\nStill hidden.\n\n## Visible again\nVisible tail.';
    const result = project(source);
    const output = JSON.stringify(result.ast);
    expect(output).not.toContain('Hidden body');
    expect(output).not.toContain('Still hidden');
    expect(output).not.toContain('Private');
    expect(output).toContain('Visible tail');
    expect(result.ast.toc.map((item) => item.title)).toEqual(['Public', 'Visible again']);
    expect(toCleanMarkdown(project(source, ['admin']).ast)).toContain('Hidden body');
  });

  it('restricts nested directives from parsed attributes and preserves public siblings', () => {
    const source =
      'Visible before.\n\n:::note{access="confidential" title="Private note"}\nHidden directive.\n:::\n\nVisible after.';
    const result = project(source);
    expect(result.strippedAny).toBe(true);
    expect(JSON.stringify(result.ast)).not.toContain('Hidden directive');
    expect(toCleanMarkdown(result.ast)).toContain('Visible after');
    expect(toCleanMarkdown(project(source, ['admin']).ast)).toContain('Hidden directive');
  });

  it('decodes HTML attributes and restricts nested content without losing public siblings', async () => {
    const source =
      '<div data-access="public"><p>Visible HTML</p><section data-access="confid&#101;ntial">Hidden HTML</section></div>';
    const result = project(source);
    expect(JSON.stringify(result.ast)).not.toContain('Hidden HTML');
    expect(JSON.stringify(result.ast)).toContain('Visible HTML');
    expect(toCleanMarkdown(result.ast)).toContain('Visible HTML');
    expect(await toHtmlSsr(result.ast)).not.toContain('Hidden HTML');
    expect(JSON.stringify(project(source, ['admin']).ast)).toContain('Hidden HTML');
  });

  it.each([
    '<section data-access="confidential">\n\nHidden separated paragraph.\n\n</section>\n\nVisible tail.',
    'Before <span data-access="confidential">Hidden inline text.</span> after.',
    '<section data-access="confidential">\n\n## Hidden Markdown heading\n\nHidden heading body.\n\n</section>\n\nVisible tail.',
  ])('preserves HTML access scope across Markdown nodes: %s', (source) => {
    const result = project(source);
    expect(JSON.stringify(result.ast)).not.toContain('Hidden');
    expect(JSON.stringify(project(source, ['admin']).ast)).toContain('Hidden');
  });

  it('intersects conflicting policy declarations and clears raw source and diagnostics', () => {
    const ast = parseDocumentSync('Visible.');
    ast.children.push({
      type: 'paragraph',
      access: 'public',
      props: { 'data-access': 'confidential' },
      children: [{ type: 'text', value: 'Hidden props' }],
    });
    ast.diagnostics.push({ code: 'AUTHOR_ONLY', severity: 'warning', message: 'Hidden diagnostic' });
    const result = projectDocumentAccess(ast, createDocumentAccessPredicate());
    expect(JSON.stringify(result.ast)).not.toContain('Hidden');
    expect(result.ast.rawContent).toBeUndefined();
    expect(result.ast.diagnostics).toEqual([]);
  });

  it('does not reinterpret permissions as roles and supports explicit grants', () => {
    expect(createDocumentAccessPredicate(['docs.read.confidential'])('confidential')).toBe(false);
    expect(createDocumentAccessPredicate([], {}, ['docs.read.confidential'])('confidential')).toBe(true);
    expect(createDocumentAccessPredicate(['staff'], { grants: { staff: ['docs.read.public'] } })('internal')).toBe(
      false
    );
  });

  it('preserves complex directive examples and nested fences verbatim', () => {
    const literal =
      ':::tabs{syncKey="demo"}\n:::tab{label="Example"}\n:::theorem{access="confidential" dependsOn=["a", "b"]}\nExample.\n:::\n:::\n:::';
    const ast = parseDocumentSync('````markdown\n' + literal + '\n````');
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0]?.value).toBe(literal);
  });

  it('retains literal access examples in fenced code', () => {
    const source = '```markdown\n:::note{access="confidential"}\nLiteral example.\n:::\n```';
    const result = project(source);
    expect(result.strippedAny).toBe(false);
    expect(toCleanMarkdown(result.ast)).toContain('Literal example');
  });
});
