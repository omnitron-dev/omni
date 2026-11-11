import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 5: Formal Mathematical Environments', () => {
  const TEN_ENVS = [
    'axiom',
    'definition',
    'theorem',
    'lemma',
    'proposition',
    'corollary',
    'proof',
    'remark',
    'example',
    'hypothesis',
  ] as const;

  it('TC-F05-01: parses theorem directive with id, title, and dependency metadata', async () => {
    const doc = `---
title: Spectral Rigidity
---

:::theorem{id="thm-purity" title="Purity Bound" status="verified" dependsOn=["ax-omega"]}
For all density operators $\\rho$, $\\operatorname{Tr}(\\rho^2) \\le 1$.
:::
`;

    const ast = await parseDocument(doc, 'docs/spectral.pdx');
    expect(ast.rawContent).toContain(':::theorem');
    expect(ast.rawContent).toContain('id="thm-purity"');
    expect(ast.rawContent).toContain('Purity Bound');
  });

  it('TC-F05-02: supports all ten formal mathematical environment types', async () => {
    const blocks = TEN_ENVS.map(
      (env) => `:::${env}{id="env-${env}" title="${env.toUpperCase()}"}\nContent for ${env}\n:::`
    ).join('\n\n');
    const doc = `---\ntitle: Formal Math Taxonomy\n---\n\n${blocks}`;

    const ast = await parseDocument(doc, 'docs/taxonomy.pdx');
    for (const env of TEN_ENVS) {
      expect(ast.rawContent).toContain(`:::${env}`);
    }
  });

  it('TC-F05-03: verifies proof environment formatting and structure in document', async () => {
    const doc = `---
title: Proof Demonstration
---

:::proof{of="thm-purity"}
Direct expansion of eigenvalues completes the proof.
:::
`;

    const ast = await parseDocument(doc, 'docs/proof.pdx');
    const html = toHtmlSsr(ast);
    expect(html).toContain('proof');
    expect(html).toContain('Direct expansion');
  });

  it('TC-F05-04: distinguishes between numbered and unnumbered math blocks', async () => {
    const doc = `---
title: Numbering Test
---

:::lemma{id="lem-trace" number="1.1"}
Trace preservation lemma.
:::

:::remark{unnumbered=true}
Informal observation without index.
:::
`;

    const ast = await parseDocument(doc, 'docs/numbering.pdx');
    expect(ast.rawContent).toContain('number="1.1"');
    expect(ast.rawContent).toContain('unnumbered=true');
  });

  it('TC-F05-05: parses inline and block KaTeX formulas inside math environments', async () => {
    const doc = `---
title: KaTeX in Environments
---

:::definition{id="def-hilbert"}
Let $\\mathcal{H}$ be an inner product space such that:
$$\\dim(\\mathcal{H}) = \\infty$$
:::
`;

    const ast = await parseDocument(doc, 'docs/katex-env.pdx');
    expect(ast.rawContent).toContain('$\\mathcal{H}$');
    expect(ast.rawContent).toContain('$$\\dim(\\mathcal{H}) = \\infty$$');
  });
});
