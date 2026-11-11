import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 9: Build-Time Diagram Generation Boundaries', () => {
  it('TC-B09-01: handles broken or invalid Mermaid diagram syntax without throwing unhandled exceptions', async () => {
    const brokenMermaidDoc = `---
title: Broken Diagram
---

\`\`\`mermaid
flowchart TD
  A --->>> B ??? C !!!
  Broken Syntax Unclosed [Bracket
\`\`\`
`;

    const ast = await parseDocument(brokenMermaidDoc, 'docs/broken-diagram.pdx');
    expect(ast).toBeDefined();
    expect(ast.rawContent).toContain('Broken Syntax');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
  });

  it('TC-B09-02: renders empty diagram block (0 bytes body) safely', async () => {
    const emptyDiagramDoc = `---
title: Empty Diagram
---

\`\`\`mermaid
\`\`\`
`;

    const ast = await parseDocument(emptyDiagramDoc, 'docs/empty-diagram.pdx');
    expect(ast.rawContent).toContain('```mermaid');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
  });

  it('TC-B09-03: processes cyclic graph definitions in diagrams without infinite recursion', async () => {
    const cyclicDiagramDoc = `---
title: Cyclic Diagram
---

\`\`\`mermaid
graph TD
  Node1 --> Node2
  Node2 --> Node3
  Node3 --> Node4
  Node4 --> Node1
\`\`\`
`;

    const ast = await parseDocument(cyclicDiagramDoc, 'docs/cyclic-diagram.pdx');
    expect(ast.rawContent).toContain('Node4 --> Node1');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
    expect(html).toContain('Node1');
  });

  it('TC-B09-04: handles oversized diagrams with 300+ nodes and edges without heap overflow', async () => {
    const lines: string[] = ['```mermaid', 'graph LR'];
    const nodeCount = 300;
    for (let i = 0; i < nodeCount; i++) {
      lines.push(`  N${i}[Node ${i}] --> N${(i + 1) % nodeCount}[Node ${(i + 1) % nodeCount}]`);
    }
    lines.push('```');
    const oversizedDoc = `---\ntitle: Oversized Diagram\n---\n\n${lines.join('\n')}`;

    const startTime = Date.now();
    const ast = await parseDocument(oversizedDoc, 'docs/oversized-diagram.pdx');
    const elapsed = Date.now() - startTime;

    expect(ast.rawContent).toContain(`N${nodeCount - 1}`);
    expect(elapsed).toBeLessThan(3_000);
  });

  it('TC-B09-05: escapes malicious HTML and XSS payloads within diagram node labels', async () => {
    const xssDiagramDoc = `---
title: XSS Diagram
---

\`\`\`mermaid
graph TD
  A["<img src=x onerror=alert(1)>"] --> B["<script>alert(2)</script>"]
  B --> C["javascript:alert(3)"]
\`\`\`
`;

    const ast = await parseDocument(xssDiagramDoc, 'docs/xss-diagram.pdx');
    const html = toHtmlSsr(ast);

    // Malicious script tags must not be emitted unescaped
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;');
  });
});
