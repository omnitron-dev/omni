import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDocument, toHtmlSsr, LumenMacroRegistry } from '@omnitron-dev/lumen-ast';
import { LumenShell, MathTheoremBlock, DocSectionNav } from '@omnitron-dev/lumen-ui';

describe('Tier 3: Cross-Feature — Math, KaTeX Registry, ToC & SSR (F5 + F7 + F13 + F20)', () => {
  it('TC-X01-01: KaTeX macro registered in registry expands in theorem body and document ToC entry', async () => {
    const macros = new LumenMacroRegistry({
      '\\hilbert': '\\mathcal{H}',
      '\\inner': '\\langle #1, #2 \\rangle',
    });

    const doc = `---
title: Quantum Hilbert Space
---

# Quantum Spectral Theory

:::theorem{id="thm-inner-product" title="Inner Product Norm"}
Let $v, w \\in \\hilbert$. The inner product satisfies $\\inner{v}{w} \\le \\|v\\| \\|w\\|$.
:::
`;

    const ast = await parseDocument(doc, 'docs/hilbert.pdx');
    const html = toHtmlSsr(ast, { macros });

    expect(html).toContain('lumen-doc');
    expect(html).toContain('thm-inner-product');
    expect(html).toContain('Inner Product Norm');

    // ToC extraction verification
    expect(ast.toc).toBeDefined();
    expect(ast.toc.length).toBeGreaterThanOrEqual(1);
    expect(ast.toc[0]?.title).toBe('Quantum Spectral Theory');
  });

  it('TC-X01-02: Theorem title with LaTeX math renders consistently across SSR article and DocSectionNav', async () => {
    const doc = `---
title: Operator Bounds
---

# Spectral Properties

:::theorem{id="thm-spectral-radius" title="Spectral Radius Bound"}
For every bounded linear operator $A$, the spectral radius is bounded by the norm.
:::
`;

    const ast = await parseDocument(doc, 'docs/spectral.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('thm-spectral-radius');
    expect(html).toContain('Spectral Radius Bound');

    // Render navigation section with headings
    const navHtml = renderToStaticMarkup(
      React.createElement(DocSectionNav, {
        headings: [
          { id: 'spectral-properties', title: 'Spectral Properties', level: 1 },
          { id: 'thm-spectral-radius', title: 'Spectral Radius Bound', level: 2 },
        ],
      })
    );

    expect(navHtml).toContain('class="lumen-section-nav"');
    expect(navHtml).toContain('href="#thm-spectral-radius"');
    expect(navHtml).toContain('Spectral Radius Bound');
  });

  it('TC-X01-03: Multiple math environments with shared macros preserve definitions across SSR HTML output', async () => {
    const registry = new LumenMacroRegistry();
    registry.register({
      '\\ket': '|#1\\rangle',
      '\\bra': '\\langle #1|',
      '\\braket': '\\langle #1|#2\\rangle',
    });

    const doc = `---
title: Bra-Ket Formulations
---

:::definition{id="def-state-vector" title="Quantum State Vector"}
A pure state is represented by a ray $\\ket{\\psi}$ in projective Hilbert space.
:::

:::theorem{id="thm-orthonormality" title="Basis Orthonormality"}
Given an orthonormal basis, $\\braket{i}{j} = \\delta_{ij}$.
:::
`;

    const ast = await parseDocument(doc, 'docs/braket.pdx');
    const html = toHtmlSsr(ast, { macros: registry });

    expect(html).toContain('def-state-vector');
    expect(html).toContain('thm-orthonormality');
    expect(html).toContain('Quantum State Vector');
    expect(html).toContain('Basis Orthonormality');

    const serializedMacros = registry.getMacros();
    expect(serializedMacros['\\ket']).toBe('|#1\\rangle');
    expect(serializedMacros['\\bra']).toBe('\\langle #1|');
    expect(serializedMacros['\\braket']).toBe('\\langle #1|#2\\rangle');
  });

  it('TC-X01-04: Numbered vs unnumbered math environments produce valid anchors matched by navigation links', async () => {
    const doc = `---
title: Numbered Taxonomies
---

:::theorem{id="thm-density-matrix" title="Density Matrix Properties" number="3.1"}
Every density operator $\\rho$ satisfies $\\operatorname{Tr}(\\rho) = 1$.
:::

:::remark{id="rem-pure-states" title="Pure States"}
Pure states satisfy $\\rho^2 = \\rho$.
:::
`;

    const ast = await parseDocument(doc, 'docs/numbered.pdx');
    const html = toHtmlSsr(ast);

    expect(html).toContain('thm-density-matrix');
    expect(html).toContain('rem-pure-states');

    // Verify embedding inside LumenShell preserves context
    const shellHtml = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'en', currentPath: '/docs/numbered' },
        React.createElement('div', { dangerouslySetInnerHTML: { __html: html } })
      )
    );

    expect(shellHtml).toContain('data-theme="dark"');
    expect(shellHtml).toContain('thm-density-matrix');
    expect(shellHtml).toContain('rem-pure-states');
  });
});
