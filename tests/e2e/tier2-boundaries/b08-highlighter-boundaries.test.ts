import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 8: Build-Time Syntax Highlighting Boundaries', () => {
  it('TC-B08-01: falls back gracefully when given unknown or unsupported language identifiers', async () => {
    const unknownLangDoc = `---
title: Unknown Language
---

\`\`\`custom-dsl-xyz-999
DEFINE_STATE(Omega, [1, 0, 0, 1]);
TRANSITION(Omega -> Sigma);
\`\`\`
`;

    const ast = await parseDocument(unknownLangDoc, 'docs/unknown-lang.pdx');
    expect(ast).toBeDefined();
    expect(ast.rawContent).toContain('```custom-dsl-xyz-999');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
    expect(html).toContain('DEFINE_STATE');
  });

  it('TC-B08-02: renders empty code block (0 characters) without undefined errors', async () => {
    const emptyCodeDoc = `---
title: Empty Code Block
---

\`\`\`typescript
\`\`\`
`;

    const ast = await parseDocument(emptyCodeDoc, 'docs/empty-code.pdx');
    expect(ast.rawContent).toContain('```typescript');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
  });

  it('TC-B08-03: handles massive 10,000+ line code snippet without stack overflow or V8 heap crash', async () => {
    const lineCount = 10_000;
    const codeLines: string[] = ['```typescript'];
    for (let i = 0; i < lineCount; i++) {
      codeLines.push(`const variable_${i}: number = ${i} * 2;`);
    }
    codeLines.push('```');
    const massiveDoc = `---\ntitle: Massive Code Block\n---\n\n${codeLines.join('\n')}`;

    const startTime = Date.now();
    const ast = await parseDocument(massiveDoc, 'docs/massive-code.pdx');
    const elapsed = Date.now() - startTime;

    expect(ast.rawContent).toContain('variable_9999');
    expect(elapsed).toBeLessThan(5_000);
  });

  it('TC-B08-04: rejects malformed Twoslash error directives before emitting HTML', async () => {
    const malformedTwoslashDoc = `---
title: Malformed Twoslash
---

\`\`\`ts twoslash
// @errors: not-a-number
// @unknownCompilerFlag: true
// @target: ES99999
const invalid = "twoslash";
//    ^?
\`\`\`
`;

    const ast = await parseDocument(malformedTwoslashDoc, 'docs/malformed-twoslash.pdx');
    expect(ast.rawContent).toContain('// @errors: not-a-number');
    expect(ast.rawContent).toContain('// @unknownCompilerFlag: true');

    expect(() => toHtmlSsr(ast)).toThrow('Invalid Twoslash @errors directive');
  });

  it('TC-B08-05: escapes raw HTML tags and script injections embedded within code blocks', async () => {
    const codeWithHtml = `---
title: Code with HTML
---

\`\`\`html
<script>alert("xss-in-code")</script>
<iframe src="https://example.com" onload="malicious()"></iframe>
<style>body { display: none; }</style>
\`\`\`
`;

    const ast = await parseDocument(codeWithHtml, 'docs/code-html.pdx');
    const html = toHtmlSsr(ast);

    // Unescaped tags must not exist in SSR output
    expect(html).not.toContain('<script>alert("xss-in-code")</script>');
    expect(html).not.toContain('<iframe src=');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;iframe');
  });
});
