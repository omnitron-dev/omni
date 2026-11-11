import { describe, it, expect } from 'vitest';
import { parseMermaidDirectives, DiagramRenderer, parseDocument } from '../src/index.js';

describe('Mermaid Diagrams & ELK Layout', () => {
  it('parses ELK layout configuration and diagram types from directives', () => {
    const elkMermaid = `%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TD
  A[Start] --> B[Process] --> C[Done]`;

    const config = parseMermaidDirectives(elkMermaid);
    expect(config.defaultRenderer).toBe('elk');
    expect(config.diagramType).toBe('flowchart');

    const sequenceMermaid = `sequenceDiagram
Client->>Server: Request`;
    const seqConfig = parseMermaidDirectives(sequenceMermaid);
    expect(seqConfig.diagramType).toBe('sequence');
  });

  it('renders isolated diagram figures with unique namespaced IDs', () => {
    const renderer = new DiagramRenderer();
    const code = 'graph TD\n  A --> B';

    const html1 = renderer.render(code, 1, 'docs/flow.pdx');
    const html2 = renderer.render(code, 2, 'docs/flow.pdx');

    expect(html1).toContain('lumen-diag-docs-flow-pdx-1');
    expect(html2).toContain('lumen-diag-docs-flow-pdx-2');
    expect(html1).toContain('lumen-diagram-mermaid');
    expect(html1).toContain('graph TD');
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
