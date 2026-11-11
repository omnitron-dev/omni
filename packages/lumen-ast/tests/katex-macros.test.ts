import { describe, it, expect } from 'vitest';
import { LumenMacroRegistry, parseDocument, renderKaTeX, toHtmlSsr } from '../src/index.js';

describe('KaTeX Macro Registry & Consistency Across Body, Headers, ToC', () => {
  it('manages full lifecycle of LumenMacroRegistry', () => {
    const registry = new LumenMacroRegistry({
      '\\R': '\\mathbb{R}',
      '\\inner': '\\langle #1, #2 \\rangle',
    });

    expect(registry.has('\\R')).toBe(true);
    expect(registry.has('\\inner')).toBe(true);
    expect(registry.has('\\missing')).toBe(false);
    expect(registry.size()).toBe(2);

    const record = registry.toRecord();
    expect(record['\\R']).toBe('\\mathbb{R}');
    expect(record['\\inner']).toBe('\\langle #1, #2 \\rangle');

    const cloned = registry.clone();
    cloned.register({ '\\C': '\\mathbb{C}' });
    expect(cloned.size()).toBe(3);
    expect(registry.size()).toBe(2);

    registry.clear();
    expect(registry.size()).toBe(0);
    expect(registry.has('\\R')).toBe(false);
  });

  it('renders LaTeX formulas with macro substitution and error recovery', () => {
    const registry = new LumenMacroRegistry({ '\\R': '\\mathbb{R}' });

    const validResult = renderKaTeX('\\R^n', { macros: registry });
    expect(validResult.html).toContain('mathbb');
    expect(validResult.error).toBeUndefined();

    // Invalid TeX recovers without crash
    const brokenResult = renderKaTeX('\\invalidMacroXYZ{unclosed', { throwOnError: false });
    expect(brokenResult.html).toContain('lumen-invalid-math');
    expect(brokenResult.error).toBeDefined();
  });

  it('preserves mathematical macros consistently across ToC and body SSR', async () => {
    const doc = `---
title: Spaces over $\\R^n$
---

# Spaces over $\\R^n$

## Subspaces in $\\C^m$ {#subspaces}

Let $x \\in \\R^n$ be a vector.
`;

    const ast = await parseDocument(doc, 'docs/spaces.pdx');
    expect(ast.toc[0]?.title).toContain('$\\R^n$');
    expect(ast.toc[1]?.title).toContain('$\\C^m$');
    expect(ast.toc[1]?.id).toBe('subspaces');

    const registry = new LumenMacroRegistry({
      '\\R': '\\mathbb{R}',
      '\\C': '\\mathbb{C}',
    });

    const html = toHtmlSsr(ast, { macros: registry });
    expect(html).toContain('lumen-doc');
    expect(html).toContain('lumen-inline-math');
  });
});
