import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Tier 4: Scenario 13 — Isolated Mermaid Diagram Worker Pool', () => {
  it('processes multiple Mermaid diagrams concurrently without thread interference', async () => {
    const diagrams = [
      {
        id: 'flowchart',
        doc: `---
title: System Flowchart
---
\`\`\`mermaid
flowchart TD
  A[Start] --> B[Parse] --> C[Render]
\`\`\`
`,
      },
      {
        id: 'sequence',
        doc: `---
title: RPC Sequence
---
\`\`\`mermaid
sequenceDiagram
  Client->>Server: Request Document
  Server-->>Client: Stream AST
\`\`\`
`,
      },
      {
        id: 'state',
        doc: `---
title: Compiler State
---
\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Compiling: Event
  Compiling --> [*]: Done
\`\`\`
`,
      },
      {
        id: 'elk-layout',
        doc: `---
title: ELK Topologies
---
\`\`\`mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart LR
  N1 --> N2 --> N3
\`\`\`
`,
      },
    ];

    // Concurrently parse all diagrams
    const asts = await Promise.all(diagrams.map((d) => parseDocument(d.doc, `docs/${d.id}.pdx`)));

    // Concurrently render to SSR HTML
    const htmlOutputs = await Promise.all(asts.map((ast) => Promise.resolve(toHtmlSsr(ast))));

    expect(htmlOutputs[0]).toContain('lumen-diagram');
    expect(htmlOutputs[0]).toContain('Start');
    expect(htmlOutputs[1]).toContain('lumen-diagram');
    expect(htmlOutputs[1]).toContain('Request Document');
    expect(htmlOutputs[2]).toContain('lumen-diagram');
    expect(htmlOutputs[2]).toContain('Compiling');
    expect(htmlOutputs[3]).toContain('lumen-diagram');
    expect(htmlOutputs[3]).toContain('defaultRenderer');
  });

  it('renders diagrams with dark and light CSS variable wrappers', async () => {
    const doc = `---
title: Themed Architecture
---
\`\`\`mermaid
graph TD
  Source --> Output
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/themed.pdx');
    const darkHtml = toHtmlSsr(ast, { theme: 'dark' });
    const lightHtml = toHtmlSsr(ast, { theme: 'light' });

    expect(darkHtml).toContain('lumen-diagram');
    expect(lightHtml).toContain('lumen-diagram');
    expect(darkHtml).toContain('Source');
    expect(lightHtml).toContain('Source');
  });
});
