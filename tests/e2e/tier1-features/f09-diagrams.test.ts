import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 9: Build-Time Diagram Generation', () => {
  it('TC-F09-01: parses Mermaid flowchart diagram blocks in markdown AST', async () => {
    const doc = `---
title: Mermaid Flowchart
---

\`\`\`mermaid
graph TD
  Start[Initial State] --> Process[Compiling AST]
  Process --> Finish[Static HTML]
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/flowchart.pdx');
    expect(ast.rawContent).toContain('```mermaid');
    expect(ast.rawContent).toContain('graph TD');
  });

  it('TC-F09-02: parses ELK layout engine directive configuration in Mermaid block', async () => {
    const doc = `---
title: ELK Flowchart
---

\`\`\`mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TD
  A --> B --> C
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/elk.pdx');
    expect(ast.rawContent).toContain('"defaultRenderer": "elk"');
  });

  it('TC-F09-03: parses Mermaid sequence diagram syntax', async () => {
    const doc = `---
title: Sequence Diagram
---

\`\`\`mermaid
sequenceDiagram
  Client->>Server: Query Symbol Contract
  Server-->>Client: Contract Metadata JSON
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/sequence.pdx');
    expect(ast.rawContent).toContain('sequenceDiagram');
    expect(ast.rawContent).toContain('Client->>Server: Query');
  });

  it('TC-F09-04: renders document containing diagrams to SSR HTML', async () => {
    const doc = `---
title: Diagram SSR
---

\`\`\`mermaid
stateDiagram-v2
  [*] --> Active
  Active --> [*]
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/diagram-ssr.pdx');
    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
    expect(html).toContain('stateDiagram-v2');
  });

  it('TC-F09-05: handles multiple diagram blocks in a single document without collision', async () => {
    const doc = `---
title: Multi Diagrams
---

\`\`\`mermaid
graph LR
  A --> B
\`\`\`

Text between diagrams.

\`\`\`mermaid
graph TD
  C --> D
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/multi-diagram.pdx');
    expect(ast.rawContent).toContain('graph LR');
    expect(ast.rawContent).toContain('graph TD');
  });
});
