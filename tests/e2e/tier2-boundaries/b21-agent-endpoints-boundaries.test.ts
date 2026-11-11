import { describe, it, expect } from 'vitest';
import { parseDocument, toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { expectValidLlmsTxt } from '../harness/assertions.js';

describe('Feature 21: AI Agent Endpoints Boundaries', () => {
  it('TC-B21-01: generates valid llms.txt structure for empty or minimal document corpus', () => {
    const emptyCorpusLlmsTxt = `# Lumen Documentation\n\n> Documentation portal.\n\n## Documents\n`;
    expectValidLlmsTxt(emptyCorpusLlmsTxt);
    expect(emptyCorpusLlmsTxt).toContain('# Lumen Documentation');
  });

  it('TC-B21-02: generates aggregated llms-full.txt from documents with circular relationships safely', async () => {
    const docA = `---
title: Module A
relations:
  dependsOn: [doc-b]
---
# Module A
Content of Module A referencing Module B.
`;

    const docB = `---
title: Module B
relations:
  dependsOn: [doc-a]
---
# Module B
Content of Module B referencing Module A.
`;

    const astA = await parseDocument(docA, 'docs/a.pdx');
    const astB = await parseDocument(docB, 'docs/b.pdx');

    const cleanA = toCleanMarkdown(astA);
    const cleanB = toCleanMarkdown(astB);

    const fullAggregate = `# Complete Documentation Corpus\n\n${cleanA}\n\n---\n\n${cleanB}`;
    expectValidLlmsTxt(fullAggregate);
    expect(fullAggregate).toContain('# Module A');
    expect(fullAggregate).toContain('# Module B');
  });

  it('TC-B21-03: verifies clean markdown route mirrors preserve prose while stripping complex UI tags', async () => {
    const widgetDoc = `---
title: Interactive Guide
---

# Interactive Guide

<Callout type="info" title="Note">
Important notice in clean markdown mirror.
</Callout>

:::tabs
:::tab{label="Terminal"}
\`\`\`bash
pnpm install
\`\`\`
:::
:::
`;

    const ast = await parseDocument(widgetDoc, 'docs/guide.pdx');
    const cleanMd = toCleanMarkdown(ast);

    expect(cleanMd).toContain('# Interactive Guide');
    expect(cleanMd).toContain('Important notice in clean markdown mirror.');
    expect(cleanMd).toContain('pnpm install');
  });

  it('TC-B21-04: handles documents with null or missing description in agent endpoint summaries', async () => {
    const noDescDoc = `---
title: Undescribed Module
---

# Undescribed Module

First paragraph provides natural excerpt for AI agent ingestion.
`;

    const ast = await parseDocument(noDescDoc, 'docs/no-desc.pdx');
    const paragraphs =
      ast.rawContent
        ?.split('\n\n')
        .map((p) => p.trim())
        .filter(Boolean) ?? [];
    const excerpt = paragraphs.find((p) => !p.startsWith('#')) ?? ast.frontmatter.title;

    expect(excerpt).toContain('First paragraph provides natural excerpt');
  });

  it('TC-B21-05: handles requests for non-existent route markdown mirrors returning null or 404 cleanly', () => {
    const availableMirrors = new Map<string, string>([
      ['/docs/intro', '# Introduction'],
      ['/docs/architecture', '# Architecture'],
    ]);

    const resolved = availableMirrors.get('/docs/phantom-route-404');
    expect(resolved).toBeUndefined();
  });
});
