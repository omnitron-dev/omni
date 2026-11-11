import { describe, it, expect } from 'vitest';
import { LumenMacroRegistry, parseDocument } from '@omnitron-dev/lumen-ast';

describe('Feature 7: Shared KaTeX Macro Registry', () => {
  it('TC-F07-01: initializes macro registry and registers custom LaTeX macros', () => {
    const registry = new LumenMacroRegistry({
      '\\R': '\\mathbb{R}',
      '\\C': '\\mathbb{C}',
      '\\braket': '\\langle #1 \\rangle',
    });

    expect(registry.has('\\R')).toBe(true);
    expect(registry.has('\\braket')).toBe(true);
    expect(registry.size()).toBe(3);

    const macros = registry.getMacros();
    expect(macros['\\R']).toBe('\\mathbb{R}');
    expect(macros['\\braket']).toBe('\\langle #1 \\rangle');
  });

  it('TC-F07-02: registers additional macros incrementally without losing existing entries', () => {
    const registry = new LumenMacroRegistry({ '\\R': '\\mathbb{R}' });
    registry.register({ '\\N': '\\mathbb{N}', '\\norm': '\\left\\| #1 \\right\\|' });

    expect(registry.size()).toBe(3);
    expect(registry.getMacros()['\\N']).toBe('\\mathbb{N}');
    expect(registry.getMacros()['\\R']).toBe('\\mathbb{R}');
  });

  it('TC-F07-03: verifies macro consistency across document headings and body text', async () => {
    const doc = `---
title: Spaces over $\\R^n$
---

# Spaces over $\\R^n$

## Subspaces in $\\C^m$ {#subspaces}

Elements $x \\in \\R^n$ satisfy orthogonality conditions.
`;

    const ast = await parseDocument(doc, 'docs/macros.pdx');
    expect(ast.frontmatter.title).toContain('$\\R^n$');
    expect(ast.toc[0].title).toContain('$\\R^n$');
    expect(ast.toc[1].title).toContain('$\\C^m$');
  });

  it('TC-F07-04: enforces isolated scoping between distinct macro registry instances', () => {
    const globalRegistry = new LumenMacroRegistry({ '\\R': '\\mathbb{R}' });
    const localRegistry = new LumenMacroRegistry(globalRegistry.getMacros());

    localRegistry.register({ '\\localMacro': '\\mathcal{L}' });

    expect(localRegistry.has('\\localMacro')).toBe(true);
    expect(globalRegistry.has('\\localMacro')).toBe(false);
  });

  it('TC-F07-05: clears and resets registry entries cleanly', () => {
    const registry = new LumenMacroRegistry({ '\\R': '\\mathbb{R}', '\\C': '\\mathbb{C}' });
    expect(registry.size()).toBe(2);

    registry.clear();
    expect(registry.size()).toBe(0);
    expect(registry.has('\\R')).toBe(false);
  });
});
