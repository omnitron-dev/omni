import { describe, expect, it } from 'vitest';
import { parseDocument, toHtmlSsr, toCleanMarkdown, toTypst } from '../src/index.js';

const source = `:::filetree{title="my-service/"}
- \`src/\` — application source
  - \`main.ts\` — entry point
  - \`modules/\`
    - \`users.module.ts\` — feature module
- \`empty/\` — reserved directory
- \`package.json\` — [commands](https://example.com/commands)
:::`;

describe('filetree document block', () => {
  it('renders native open directory disclosures, static file names and semantic annotations', async () => {
    const ast = await parseDocument(source);
    const html = toHtmlSsr(ast);
    expect(html).toContain('<figure class="lumen-file-tree"><figcaption>my-service/</figcaption>');
    expect(html.match(/<details open>/g)).toHaveLength(2);
    expect(html.match(/<summary>/g)).toHaveLength(2);
    expect(html).toContain('<code>main.ts</code>');
    expect(html).toContain('lumen-file-tree-description"> — entry point');
    expect(html).toContain('href="https://example.com/commands"');
    expect(html).not.toContain('data-lumen-island');
    expect(html).not.toContain('role="tree"');
    expect(html).not.toContain('href="main.ts"');
  });

  it('retains the title, nested paths and annotations in Markdown and PDF source', async () => {
    const ast = await parseDocument(source);
    const markdown = toCleanMarkdown(ast);
    expect(markdown).toContain('**my-service/**');
    expect(markdown).toContain('  - `main.ts` — entry point');
    expect(markdown).toContain('    - `users.module.ts` — feature module');
    expect(markdown).toContain('[commands](https://example.com/commands)');
    const typst = toTypst(ast);
    expect(typst).toContain('my\\-service\\/');
    expect(typst).toContain('  - `main.ts` — entry point');
    expect(typst).toContain('    - `users.module.ts` — feature module');
  });

  it('escapes names and captions without turning document text into HTML', async () => {
    const ast = await parseDocument(':::filetree{title="<img src=x>"}\n- `<script>alert(1)</script>` — literal name\n:::');
    const html = toHtmlSsr(ast);
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
  });

  it.each([
    ':::filetree\nNot a list\n:::',
    ':::filetree\n1. `ordered.ts`\n:::',
    ':::filetree\n- Missing inline code\n:::',
    ':::filetree\n- `file.ts`\n\n  Unexpected second paragraph\n:::',
  ])('rejects malformed structure consistently: %s', async invalid => {
    const ast = await parseDocument(invalid);
    for (const emit of [toHtmlSsr, toCleanMarkdown, toTypst]) expect(() => emit(ast)).toThrow(/filetree/);
  });
});
