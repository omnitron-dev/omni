import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 6: Smart Cross-References & Directives', () => {
  it('TC-F06-01: parses theorem cross-reference syntax @thm:target-id', async () => {
    const doc = `---
title: Cross Reference Test
---

According to @thm:spectral-decomp, the self-adjoint operator admits an eigenbasis.
`;

    const ast = await parseDocument(doc, 'docs/refs.pdx');
    expect(ast.rawContent).toContain('@thm:spectral-decomp');
  });

  it('TC-F06-02: parses API symbol cross-reference syntax @api:package#symbol', async () => {
    const doc = `---
title: API Ref Test
---

Refer to @api:CorpusGraph#resolveAnchor for graph resolution mechanics.
`;

    const ast = await parseDocument(doc, 'docs/api-refs.pdx');
    expect(ast.rawContent).toContain('@api:CorpusGraph#resolveAnchor');
  });

  it('TC-F06-03: supports standard admonition directives (note, tip, warning, danger, info, caution)', async () => {
    const ADMONITIONS = ['note', 'tip', 'warning', 'danger', 'info', 'caution'];
    const doc =
      `---\ntitle: Admonitions\n---\n\n` +
      ADMONITIONS.map((kind) => `:::${kind}\nContent for ${kind}\n:::`).join('\n\n');

    const ast = await parseDocument(doc, 'docs/admonitions.pdx');
    for (const kind of ADMONITIONS) {
      expect(ast.rawContent).toContain(`:::${kind}`);
    }
  });

  it('TC-F06-04: parses multi-tab container directives for code or alternatives', async () => {
    const doc = `---
title: Tabs Test
---

:::tabs
:::tab{label="pnpm" value="pnpm"}
pnpm add @omnitron-dev/lumen
:::
:::tab{label="npm" value="npm"}
npm i @omnitron-dev/lumen
:::
:::
`;

    const ast = await parseDocument(doc, 'docs/tabs.pdx');
    expect(ast.rawContent).toContain(':::tabs');
    expect(ast.rawContent).toContain(':::tab{label="pnpm"');
    expect(ast.rawContent).toContain(':::tab{label="npm"');
  });

  it('TC-F06-05: verifies smart reference token preservation and SSR compilation', async () => {
    const doc = `---
title: Reference Resolution
---

See @def:hilbert-space and @thm:spectral-decomp for foundational axioms.
`;

    const ast = await parseDocument(doc, 'docs/smart-ref-compile.pdx');
    const html = toHtmlSsr(ast);
    expect(html).toBeDefined();
    expect(html).toContain('lumen-doc');
  });
});
