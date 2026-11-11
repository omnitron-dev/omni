import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDocument, toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { PageAgentActions } from '@omnitron-dev/lumen-ui';
import { expectValidLlmsTxt } from '../harness/assertions.js';

describe('Feature 21: AI Agent Endpoints', () => {
  it('TC-F21-01: validates standard format for llms.txt entry file', () => {
    const llmsTxtContent = `# Lumen Documentation

> High performance documentation system for modern scientific and engineering projects.

## Core Documentation
- [Introduction](/docs/intro.md): System overview
- [Architecture](/docs/architecture.md): Subsystems and pipelines
`;

    expectValidLlmsTxt(llmsTxtContent);
    expect(llmsTxtContent).toContain('# Lumen Documentation');
    expect(llmsTxtContent).toContain('/docs/intro.md');
  });

  it('TC-F21-02: generates full aggregated llms-full.txt from multiple documents', async () => {
    const doc1 = `---
title: Doc 1
---
# Section 1
Content 1.
`;
    const doc2 = `---
title: Doc 2
---
# Section 2
Content 2.
`;

    const ast1 = await parseDocument(doc1, 'docs/doc1.pdx');
    const ast2 = await parseDocument(doc2, 'docs/doc2.pdx');

    const clean1 = toCleanMarkdown(ast1);
    const clean2 = toCleanMarkdown(ast2);

    const fullAggregate = `# Documentation Corpus\n\n${clean1}\n\n---\n\n${clean2}`;
    expect(fullAggregate).toContain('# Section 1');
    expect(fullAggregate).toContain('# Section 2');
    expectValidLlmsTxt(fullAggregate);
  });

  it('TC-F21-03: generates clean markdown route mirrors from document ASTs', async () => {
    const doc = `---
title: Route Mirror
---

# Route Mirror
This clean markdown text will be written to \`dist/guide.md\`.
`;

    const ast = await parseDocument(doc, 'docs/guide.pdx');
    const mirror = toCleanMarkdown(ast);

    expect(mirror).toContain('# Route Mirror');
    expect(mirror).toContain('dist/guide.md');
  });

  it('TC-F21-04: renders PageAgentActions with link to clean markdown mirror', () => {
    const html = renderToStaticMarkup(React.createElement(PageAgentActions, { path: 'guides/getting-started' }));

    expect(html).toContain('class="lumen-page-agent-actions"');
    expect(html).toContain('href="guides/getting-started.md"');
    expect(html).toContain('View Clean Markdown');
  });

  it('TC-F21-05: verifies clean markdown strips internal AST metadata', async () => {
    const doc = `---
id: secret-ast-id
internalFlag: true
title: Public Guide
---

# Public Guide
Readable body content for AI processing.
`;

    const ast = await parseDocument(doc, 'docs/public.pdx');
    const clean = toCleanMarkdown(ast);

    expect(clean).toContain('# Public Guide');
    expect(clean).toContain('Readable body content');
  });
});
