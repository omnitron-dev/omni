import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr, splitTextWithSmartRefs, ADMONITION_KINDS } from '../src/index.js';

describe('Smart Cross-References & Directives (Admonitions, Tabs)', () => {
  it('parses inline smart references with target, symbol, and package', () => {
    const text = 'Refer to @thm:spectral-decomp and @api:CorpusGraph#resolveAnchor for details.';
    const nodes = splitTextWithSmartRefs(text);

    expect(nodes.length).toBe(5);
    expect(nodes[1]?.type).toBe('smartRef');
    expect(nodes[1]?.domain).toBe('thm');
    expect(nodes[1]?.target).toBe('spectral-decomp');

    expect(nodes[3]?.type).toBe('smartRef');
    expect(nodes[3]?.domain).toBe('api');
    expect(nodes[3]?.target).toBe('CorpusGraph#resolveAnchor');
    expect(nodes[3]?.symbol).toBe('resolveAnchor');
  });

  it('renders admonition directives across all supported kinds', async () => {
    for (const kind of ADMONITION_KINDS) {
      const doc = `---
title: Admonition ${kind}
---

:::${kind}{title="Custom ${kind}"}
Alert content for ${kind}.
:::
`;
      const ast = await parseDocument(doc, `docs/${kind}.pdx`);
      const admonNode = ast.children.find((c) => c.type === 'admonition');
      expect(admonNode).toBeDefined();
      expect(admonNode?.kind).toBe(kind);
      expect(admonNode?.title).toBe(`Custom ${kind}`);

      const html = toHtmlSsr(ast);
      expect(html).toContain(`lumen-admonition-${kind}`);
      expect(html).toContain(`Custom ${kind}`);
    }
  });

  it('parses nested tabs and tab items with sync keys', async () => {
    const doc = `---
title: Tabs Example
---

:::tabs{syncKey="package-managers"}
:::tab{label="pnpm" value="pnpm"}
\`\`\`bash
pnpm add @omnitron-dev/lumen
\`\`\`
:::
:::tab{label="npm" value="npm"}
\`\`\`bash
npm i @omnitron-dev/lumen
\`\`\`
:::
:::
`;

    const ast = await parseDocument(doc, 'docs/tabs.pdx');
    const tabsNode = ast.children.find((c) => c.type === 'tabs');
    expect(tabsNode).toBeDefined();
    expect(tabsNode?.syncKey).toBe('package-managers');
    expect(tabsNode?.children?.length).toBe(2);
    expect(tabsNode?.children?.[0]?.label).toBe('pnpm');
    expect(tabsNode?.children?.[1]?.label).toBe('npm');

    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-tabs');
    expect(html).toContain('data-sync-key="package-managers"');
    expect(html).toContain('lumen-tab-item');
    expect(html).toContain('<h3 class="lumen-tab-label">pnpm</h3>');
    expect(html).toContain('<section class="lumen-tab-item" data-value="npm" aria-label="npm">');
    expect(html).toContain('data-widget="LumenDocumentTabs"');
    expect(html).not.toMatch(/role="tab(list|panel)?"| hidden[ >]/);
  });
});
