import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';
import { createCorpusBuilder } from '../harness/corpus-builder.js';

describe('Feature 5: Formal Mathematical Environments Boundaries', () => {
  it('TC-B05-01: parses document with unclosed math environment without crash', async () => {
    const unclosedDoc = `---
title: Unclosed Environment
---

:::theorem{id="thm-unclosed" title="Incomplete Theorem"}
For every positive operator $A > 0$, $\\log(A)$ exists.
Body continues without matching closing delimiter.

# Next Heading
`;

    const ast = await parseDocument(unclosedDoc, 'docs/unclosed.pdx');
    expect(ast).toBeDefined();
    expect(ast.rawContent).toContain(':::theorem');
    expect(ast.rawContent).toContain('thm-unclosed');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
  });

  it('TC-B05-02: handles non-standard and unknown math environment types gracefully', async () => {
    const customDoc = `---
title: Custom Math Directive
---

:::conjecture{id="cnj-collatz" title="Collatz Conjecture"}
Every positive integer sequence reaches 1 under the $3n+1$ mapping.
:::

:::postulate{id="post-quantum" title="State Collapse"}
Measurement causes projection onto an eigenspace.
:::
`;

    const ast = await parseDocument(customDoc, 'docs/custom.pdx');
    expect(ast.rawContent).toContain(':::conjecture');
    expect(ast.rawContent).toContain(':::postulate');

    const html = toHtmlSsr(ast);
    expect(html).toContain('Collatz Conjecture');
  });

  it('TC-B05-03: handles empty math environment body (0 bytes) without layout corruption', async () => {
    const emptyBodyDoc = `---
title: Empty Math Block
---

:::theorem{id="thm-empty" title="Empty Body Theorem"}
:::
`;

    const ast = await parseDocument(emptyBodyDoc, 'docs/empty-thm.pdx');
    expect(ast.rawContent).toContain(':::theorem{id="thm-empty"');

    const html = toHtmlSsr(ast);
    expect(html).toContain('Empty Body Theorem');
  });

  it('TC-B05-04: handles math environment with missing id or missing title attribute', async () => {
    const anonymousDoc = `---
title: Anonymous Theorem
---

:::theorem
An anonymous theorem without explicit ID or title attributes.
:::

:::lemma{number="2.4"}
Numbered lemma without string title.
:::
`;

    const ast = await parseDocument(anonymousDoc, 'docs/anon.pdx');
    expect(ast.rawContent).toContain(':::theorem');
    expect(ast.rawContent).toContain(':::lemma{number="2.4"}');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
  });

  it('TC-B05-05: detects mutually cyclic math dependencies across theorem graphs', () => {
    const builder = createCorpusBuilder()
      .addMathObject({
        id: 'thm-cycle-a',
        envType: 'theorem',
        title: 'Theorem Cycle A',
        docId: 'doc1',
        dependsOn: ['thm-cycle-b'],
      })
      .addMathObject({
        id: 'thm-cycle-b',
        envType: 'theorem',
        title: 'Theorem Cycle B',
        docId: 'doc1',
        dependsOn: ['thm-cycle-c'],
      })
      .addMathObject({
        id: 'thm-cycle-c',
        envType: 'theorem',
        title: 'Theorem Cycle C',
        docId: 'doc1',
        dependsOn: ['thm-cycle-a'],
      });

    const graph = builder.build();
    const cycles = graph.detectMathCycles();

    expect(cycles.length).toBeGreaterThan(0);
    const cycleNodes = cycles.flat();
    expect(cycleNodes).toContain('thm-cycle-a');
    expect(cycleNodes).toContain('thm-cycle-b');
    expect(cycleNodes).toContain('thm-cycle-c');
  });
});
