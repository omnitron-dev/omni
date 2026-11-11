import { describe, it, expect } from 'vitest';
import {
  parseDocument,
  toHtmlSsr,
  FORMAL_MATH_ENV_TYPES,
  MathNumberingEngine,
  generateMathAnchor,
  resolveProofLink,
  QED_SYMBOL,
} from '../src/index.js';

describe('10 Formal Mathematical Environments, Numbers & Proofs', () => {
  it('covers all ten formal math environments with attributes', async () => {
    for (const env of FORMAL_MATH_ENV_TYPES) {
      const doc = `---
title: Test ${env}
---

:::${env}{id="${env}-1" title="${env} Title" status="verified"}
Content for ${env}
:::
`;
      const ast = await parseDocument(doc, `docs/${env}.pdx`);
      expect(ast.children).toBeDefined();
      const mathNode = ast.children.find((c) => c.type === 'mathEnvironment');
      expect(mathNode).toBeDefined();
      expect(mathNode?.envKind).toBe(env);
      expect(mathNode?.id).toBe(`${env}-1`);
      expect(mathNode?.title).toBe(`${env} Title`);
    }
  });

  it('assigns sequential numbers and respects explicit number overrides', () => {
    const engine = new MathNumberingEngine();

    // Theorem 1
    const t1 = engine.assignNumber('theorem', {});
    expect(t1).toBe('1');

    // Theorem 2
    const t2 = engine.assignNumber('theorem', {});
    expect(t2).toBe('2');

    // Explicit override
    const tExplicit = engine.assignNumber('theorem', { number: '3.14' });
    expect(tExplicit).toBe('3.14');

    // Unnumbered explicitly
    const tUnnumbered = engine.assignNumber('theorem', { unnumbered: true });
    expect(tUnnumbered).toBeUndefined();

    // Remarks and proofs are unnumbered by default
    const p1 = engine.assignNumber('proof', {});
    expect(p1).toBeUndefined();
  });

  it('generates deterministic anchor slugs and resolves proof links', () => {
    const existing = new Set<string>();
    const anchor1 = generateMathAnchor('theorem', { title: 'Spectral Theorem' }, 1, existing);
    expect(anchor1).toBe('theorem-spectral-theorem');

    const anchorDuplicate = generateMathAnchor('theorem', { title: 'Spectral Theorem' }, 2, existing);
    expect(anchorDuplicate).toBe('theorem-spectral-theorem-2');

    const proofLink = resolveProofLink({ of: 'theorem-spectral-theorem' });
    expect(proofLink.hasTarget).toBe(true);
    expect(proofLink.targetId).toBe('theorem-spectral-theorem');
    expect(proofLink.qedSymbol).toBe(QED_SYMBOL);
  });

  it('renders proof environments with target link and tombstone symbol in SSR', async () => {
    const doc = `---
title: Proof Test
---

:::proof{of="thm-purity"}
The trace remains bounded by unit norm.
:::
`;
    const ast = await parseDocument(doc, 'docs/proof.pdx');
    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-math-proof');
    expect(html).toContain('lumen-proof-target');
    expect(html).toContain('of <a href="#thm-purity">#thm-purity</a>');
    expect(html).toContain('lumen-qed');
    expect(html).toContain('∎');
  });
});
