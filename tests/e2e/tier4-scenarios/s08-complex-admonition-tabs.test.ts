import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr, toCleanMarkdown } from '@omnitron-dev/lumen-ast';

describe('Tier 4: Scenario 08 — Complex Admonition & Tabbed Layout Parity', () => {
  it('parses nested admonition directives and renders consistent structures across HTML and clean markdown', async () => {
    const docWithAdmonitions = `---
title: Advanced Deployment Configurations
---

# Deployment Strategies

:::tip{title="Production Recommendation"}
Always configure automated zero-downtime rollouts.
:::

:::warning{title="Memory Constraints"}
Ensure heap allocation exceeds 4GB for large corpus graphs.

:::danger{title="Critical"}
Do not terminate worker threads abruptly during index compilation.
:::
:::
`;

    const ast = await parseDocument(docWithAdmonitions, 'docs/deployment.pdx');
    const html = toHtmlSsr(ast);
    const cleanMd = toCleanMarkdown(ast);

    // SSR HTML checks
    expect(html).toContain('Production Recommendation');
    expect(html).toContain('Memory Constraints');
    expect(html).toContain('Critical');
    expect(html).toContain('Do not terminate worker threads');

    // Clean Markdown checks
    expect(cleanMd).toContain('Deployment Strategies');
    expect(cleanMd).toContain('Production Recommendation');
    expect(cleanMd).toContain('Memory Constraints');
    expect(cleanMd).toContain('Do not terminate worker threads');
  });

  it('supports multi-language code tabs directives in documentation AST', async () => {
    const docWithTabs = `---
title: Installation Across Package Managers
---

# Installation

::::tabs
:::tab{label="pnpm"}
\`\`\`bash
pnpm add @omnitron-dev/lumen
\`\`\`
:::

:::tab{label="npm"}
\`\`\`bash
npm install @omnitron-dev/lumen
\`\`\`
:::
::::
`;

    const ast = await parseDocument(docWithTabs, 'docs/install.pdx');
    const html = toHtmlSsr(ast);
    const cleanMd = toCleanMarkdown(ast);

    expect(html).toContain('@omnitron-dev/lumen');
    expect(cleanMd).toContain('@omnitron-dev/lumen');
  });
});
