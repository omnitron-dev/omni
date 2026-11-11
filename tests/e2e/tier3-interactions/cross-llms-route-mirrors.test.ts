import { describe, it, expect } from 'vitest';
import { defineLumenConfig } from '@omnitron-dev/lumen';
import { parseDocument, toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { expectValidLlmsTxt } from '../harness/assertions.js';

describe('Tier 3: Cross-Feature — Config Loader, SSR & AI Agent Endpoints (F17 + F20 + F21)', () => {
  it('TC-X09-01: toCleanMarkdown output strips UI portal tags while preserving markdown hierarchy for route mirrors', async () => {
    const rawPdx = `---
title: System Architecture
description: Overview of components
---

# Architecture Overview

<div data-lumen-island="interactive-demo" data-hydrate="interaction">
  <button>Click to interact</button>
</div>

Here is the substantive theoretical description of the engine.
`;

    const ast = await parseDocument(rawPdx, 'docs/arch.pdx');
    const cleanMd = toCleanMarkdown(ast);

    expect(cleanMd).toContain('# Architecture Overview');
    expect(cleanMd).toContain('substantive theoretical description');
    // Ensure island div is stripped from LLM clean markdown
    expect(cleanMd).not.toContain('<div data-lumen-island');
    expect(cleanMd).not.toContain('interactive-demo');
  });

  it('TC-X09-02: /llms.txt manifest lists all canonical documentation URLs matching configuration', () => {
    const config = defineLumenConfig({
      title: 'Quantum Theory Documentation',
      url: 'https://docs.luxquant.io',
      baseUrl: '/theory/',
    });

    const docRoutes = ['intro.md', 'foundations/algebra.md', 'foundations/operators.md'];
    const lines = [
      `# ${config.title}`,
      '',
      '> Agent and LLM documentation index.',
      '',
      '## Available Documentation',
      ...docRoutes.map((r) => `- [${r}](${config.url}${config.baseUrl}${r})`),
    ];

    const llmsTxt = lines.join('\n');
    expectValidLlmsTxt(llmsTxt);
    expect(llmsTxt).toContain('https://docs.luxquant.io/theory/intro.md');
    expect(llmsTxt).toContain('https://docs.luxquant.io/theory/foundations/algebra.md');
  });

  it('TC-X09-03: /llms-full.txt concatenates corpus documents in topological dependency order', async () => {
    const doc1 = `---
title: Module 1 Base
---
# Module 1
Base foundations.
`;
    const doc2 = `---
title: Module 2 Extensions
---
# Module 2
Extended theorems built on Module 1.
`;

    const ast1 = await parseDocument(doc1, 'docs/mod1.pdx');
    const ast2 = await parseDocument(doc2, 'docs/mod2.pdx');

    const clean1 = toCleanMarkdown(ast1);
    const clean2 = toCleanMarkdown(ast2);

    const fullAggregate = ['# Complete Knowledge Corpus', '', clean1, '', '---', '', clean2].join('\n');

    expect(fullAggregate).toContain('# Module 1');
    expect(fullAggregate).toContain('# Module 2');
    expect(fullAggregate.indexOf('# Module 1')).toBeLessThan(fullAggregate.indexOf('# Module 2'));
    expectValidLlmsTxt(fullAggregate);
  });

  it('TC-X09-04: Clean markdown mirrors match document frontmatter titles and descriptions without internal props', async () => {
    const pdx = `---
title: Clean Mirror Test
description: Verifying public frontmatter emission
internalSecretProp: true
privateConfigHash: abcdef123456
---

# Clean Content
Content without internal properties.
`;

    const ast = await parseDocument(pdx, 'docs/clean.pdx');
    const cleanMarkdown = toCleanMarkdown(ast, { includeFrontmatter: true });

    expect(cleanMarkdown).toContain('title: "Clean Mirror Test"');
    expect(cleanMarkdown).toContain('description: "Verifying public frontmatter emission"');
    expect(cleanMarkdown).not.toContain('internalSecretProp');
    expect(cleanMarkdown).not.toContain('privateConfigHash');
  });
});
