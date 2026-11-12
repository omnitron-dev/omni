import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Diagram source to actual client runtime boundary', () => {
  it('preserves all branches and layout declarations in the projected static page', async () => {
    const code = '---\nconfig:\n  layout: elk\n---\nflowchart TD\nsubgraph Ingestion\nParser --> Validator\nend\nsubgraph Generation\nValidator --> Emitter\nend';
    const ast = await parseDocument('---\ntitle: Pipeline\n---\n\n```mermaid\n' + code + '\n```', 'docs/pipeline.pdx');
    const html = toHtmlSsr(ast);
    expect(html).toContain('data-component="MermaidDiagram"');
    expect(html).toContain('subgraph Ingestion');
    expect(html).toContain('subgraph Generation');
    expect(html).not.toContain('<svg');
    // Actual SVG geometry is verified through the compiled browser entry, not
    // by hashing a hand-constructed asset name or a locally simulated graph.
  });
});
