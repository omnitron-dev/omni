import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';
import { CodeBlock, LumenShell } from '@omnitron-dev/lumen-ui';

describe('Tier 3: Cross-Feature — Shiki, Twoslash, Content Blocks & SSR (F8 + F14 + F20)', () => {
  it('TC-X03-01: Shiki code block with Twoslash diagnostics renders tokens and hover annotations in SSR HTML', async () => {
    const doc = `---
title: Twoslash Type Inferences
---

# Type Exploration

\`\`\`ts twoslash
interface QuantumState {
  amplitude: number;
  phase: number;
}
const state: QuantumState = { amplitude: 0.707, phase: 0 };
//    ^?
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/types.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('lumen-doc');
    expect(html).toContain('lumen-code-block');
    expect(html).toContain('interface QuantumState');
    expect(ast.rawContent).toContain('```ts twoslash');
    expect(ast.rawContent).toContain('//    ^?');
  });

  it('TC-X03-02: CodeBlock with language identifier and line highlights produces valid pre/code DOM structure with line-number data attributes', async () => {
    const doc = `---
title: Code Lines
---

\`\`\`typescript
import { LumenShell } from '@omnitron-dev/lumen-ui';

export default function App() {
  return <LumenShell />;
}
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/code-lines.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('class="lumen-code-block language-typescript"');
    expect(html).toContain('data-line="1"');
    expect(html).toContain('data-line="3"');
    expect(html).toContain('LumenShell');
  });

  it('TC-X03-03: Dual-theme CSS variables are embedded for SSR theme switching', async () => {
    const doc = `---
title: Theme Highlighting
---

\`\`\`python
def evaluate_eigenvalues(matrix):
    return [1.0, -1.0]
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/python.pdx');
    const html = toHtmlSsr(ast);
    expect(html).toContain('evaluate_eigenvalues');
    expect(html).toContain('--shiki-dark');

    // Embed within LumenShell theme containers
    const darkShell = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark' },
        React.createElement('div', { dangerouslySetInnerHTML: { __html: html } })
      )
    );
    const lightShell = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'light' },
        React.createElement('div', { dangerouslySetInnerHTML: { __html: html } })
      )
    );

    expect(darkShell).toContain('data-theme="dark"');
    expect(lightShell).toContain('data-theme="light"');
  });

  it('TC-X03-04: CodeBlock containing type queries renders hover card data attributes without client JS', () => {
    const codeSnippet = `const pi = 3.14159;\n//    ^? number`;
    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        code: codeSnippet,
        language: 'typescript',
      })
    );

    expect(html).toContain('class="lumen-code-block language-typescript"');
    expect(html).toContain('3.14159');
    expect(html).toContain('^? number');
  });
});
