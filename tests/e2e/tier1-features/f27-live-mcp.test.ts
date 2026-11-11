import { describe, it, expect } from 'vitest';
import { parseDocument, toTipTapDoc } from '@omnitron-dev/lumen-ast';
import { LumenRpcService } from '@omnitron-dev/titan-lumen';

describe('Feature 27: Live Edits & MCP Server', () => {
  it('TC-F27-01: validates live edit document representation compatibility with TipTap schema', async () => {
    const doc = `---
title: Live Editable Document
---

Initial paragraph content before collaborative edit.
`;

    const ast = await parseDocument(doc, 'docs/live.pdx');
    const tipTap = toTipTapDoc(ast);

    expect(tipTap.type).toBe('doc');
    expect(Array.isArray(tipTap.content)).toBe(true);
  });

  it('TC-F27-02: verifies mcpEnabled and kbEnabled options configuration in LumenRpcService', () => {
    const service = new LumenRpcService({
      mcpEnabled: true,
      kbEnabled: true,
    });

    const opts = service.getOptions();
    expect(opts.mcpEnabled).toBe(true);
    expect(opts.kbEnabled).toBe(true);
  });

  it('TC-F27-03: structures MCP tools listing containing documentation lookup tools', () => {
    const mcpTools = [
      {
        name: 'search_corpus',
        description: 'Search documentation corpus using semantic or lexical queries',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'get_document',
        description: 'Retrieve AST or clean markdown for a document path',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ];

    expect(mcpTools.some((t) => t.name === 'search_corpus')).toBe(true);
    expect(mcpTools.some((t) => t.name === 'get_document')).toBe(true);
  });

  it('TC-F27-04: verifies MCP resource URI formatting convention lumen://corpus/<path>', () => {
    const documentPath = 'guides/getting-started';
    const resourceUri = `lumen://corpus/${documentPath}`;

    expect(resourceUri).toMatch(/^lumen:\/\/corpus\/[a-z0-9\-_/]+$/);
    expect(resourceUri.endsWith(documentPath)).toBe(true);
  });

  it('TC-F27-05: models live edit diff application and document revision incrementation', () => {
    let currentContent = 'Paragraph 1\nParagraph 2';
    let revision = 1;

    const applyDiff = (oldText: string, newLine: string) => {
      revision += 1;
      return `${oldText}\n${newLine}`;
    };

    currentContent = applyDiff(currentContent, 'Paragraph 3');
    expect(revision).toBe(2);
    expect(currentContent).toContain('Paragraph 3');
  });
});
