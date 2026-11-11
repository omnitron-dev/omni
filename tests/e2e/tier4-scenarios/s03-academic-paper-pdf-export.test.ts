import { describe, it, expect } from 'vitest';
import { parseDocument, toTypst, compileTypst, toCleanMarkdown, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Tier 4: Scenario 03 — Typst Academic PDF Multi-Paper Generation', () => {
  it('compiles multi-section mathematical paper from .pdx AST to Typst and generates PDF buffer', async () => {
    const paperPdx = `---
title: Non-Commutative Spectral Measures on Von Neumann Algebras
authors: ["LuxQuant Research"]
abstract: We establish rigorous bounds on spectral rigidity for unbounded self-adjoint operators.
---

# Introduction

In quantum statistical mechanics, observables are represented by self-adjoint operators.

:::axiom{id="ax-spectral-projectors" title="Spectral Projector Completeness"}
For any self-adjoint operator $A = \\int \\lambda dE(\\lambda)$, the resolution of the identity satisfies $\\int dE(\\lambda) = I$.
:::

:::theorem{id="thm-purity-entropy" title="Von Neumann Entropy Bound"}
For any state $\\rho$, $S(\\rho) = -\\operatorname{Tr}(\\rho \\ln \\rho) \\ge 0$, with equality if and only if $\\rho$ is pure.
:::

:::proof{of="thm-purity-entropy"}
Convexity of $x \\ln x$ and unitary diagonalization directly yield non-negativity.
:::

# Numerical Simulation

Observables converge under discrete Trotter-Suzuki expansions.
`;

    // 1. Parse AST
    const ast = await parseDocument(paperPdx, 'papers/spectral-measures.pdx');
    expect(ast.frontmatter.title).toContain('Von Neumann Algebras');

    // 2. Multi-target transformation: Clean Markdown (arXiv / pre-print abstract)
    const cleanMd = toCleanMarkdown(ast, { includeFrontmatter: true });
    expect(cleanMd).toContain('Von Neumann Algebras');
    expect(cleanMd).toContain('Spectral Projector Completeness');

    // 3. Multi-target transformation: SSR HTML
    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
    expect(html).toContain('thm-purity-entropy');

    // 4. Generate Typst source markup
    const typstSource = toTypst(ast, {
      title: 'Non-Commutative Spectral Measures',
      paperSize: 'a4',
      author: 'LuxQuant Research',
    });

    expect(typstSource).toContain('#set page(paper: "a4")');
    expect(typstSource).toContain('= Non-Commutative Spectral Measures');
    expect(typstSource).toContain('LuxQuant Research');
    expect(typstSource).toContain('Spectral Projector Completeness');
    expect(typstSource).toContain('Von Neumann Entropy Bound');

    // 5. Compile to binary PDF buffer
    const pdfBuffer = await compileTypst(ast, {
      title: 'Non-Commutative Spectral Measures',
      paperSize: 'a4',
    });

    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.byteLength).toBeGreaterThan(0);
    const decoded = new TextDecoder().decode(pdfBuffer);
    expect(decoded).toContain('Spectral Projector Completeness');
  });
});
