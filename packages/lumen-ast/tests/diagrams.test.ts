import { describe, it, expect } from 'vitest';
import { renderDiagramHtml, renderDiagramSvg, parseDocument } from '../src/index.js';

describe('Mermaid Diagrams & ELK Layout', () => {
  it('retains complete Mermaid source in a real island without pretending to produce SVG', () => {
    const code = 'sequenceDiagram\n  alt accepted\n    A->>B: Commit\n  else denied\n    B-->>A: Reject\n  end';
    const html1 = renderDiagramHtml(code, 1, 'docs/flow.pdx');
    const html2 = renderDiagramHtml(code, 2, 'docs/flow.pdx');
    expect(html1).toContain('lumen-diag-docs-flow-pdx-1');
    expect(html2).toContain('lumen-diag-docs-flow-pdx-2');
    expect(html1).toContain('data-component="MermaidDiagram"');
    expect(html1).toContain('alt accepted');
    expect(html1).toContain('else denied');
    expect(html1).not.toContain('<svg');
  });

  it('bounds source bytes and refuses a Node-only imitation renderer', async () => {
    expect(() => renderDiagramHtml('я'.repeat(32769))).toThrow('UTF-8 bytes');
    expect(() => renderDiagramHtml('graph TD\nA-->B', NaN)).toThrow('Invalid diagram index');
    await expect(renderDiagramSvg('graph TD\nA-->B', 'diagram')).rejects.toThrow('browser DOM');
  });

  it('integrates diagram blocks into document AST without collision', async () => {
    const doc = `---
title: Diagrams
---

\`\`\`mermaid
graph LR
  X --> Y
\`\`\`

Text between.

\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: Hello
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/multi.pdx');
    const diagrams = ast.children.filter((c) => c.type === 'diagram');
    expect(diagrams).toHaveLength(2);
    expect(diagrams[0]?.engine).toBe('mermaid');
    expect(diagrams[0]?.code).toContain('graph LR');
    expect(diagrams[1]?.code).toContain('sequenceDiagram');
  });
});
