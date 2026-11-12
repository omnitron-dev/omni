import { expect, it } from 'vitest';
import { parseDocument } from './parser.js';
import { toHtmlSsr } from '../transformers/to-html-ssr.js';

it('renders one document title and gives repeated implicit headings unique public anchors', async () => {
  const ast = await parseDocument('---\ntitle: Example\n---\n# Example\n\n## Install\n\n## Install\n\n## Install');
  expect(ast.toc.map((item) => item.id)).toEqual(['example', 'install', 'install-1', 'install-2']);
  expect(toHtmlSsr(ast).match(/<h1\b/g)).toHaveLength(1);
});
it('rejects repeated explicit anchors instead of silently changing external links', async () => {
  const ast = await parseDocument('## First {#stable}\n\n## Second {#stable}');
  expect(ast.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'LUMEN_DUPLICATE_ANCHOR', severity: 'error' })])
  );
});
