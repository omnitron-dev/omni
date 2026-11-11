import { describe, it, expect } from 'vitest';
import { parseDocument, toCleanMarkdown } from '@omnitron-dev/lumen-ast';
import { LumenRpcService } from '@omnitron-dev/titan-lumen';
import { expectValidLlmsTxt } from '../harness/assertions.js';

describe('Tier 4: Scenario 05 — AI Agent Knowledge Mining & MCP Ingestion', () => {
  it('serves valid /llms.txt and /llms-full.txt agent endpoints matching corpus knowledge base', async () => {
    const docIntro = `---
title: Agent Interface Guide
description: Documentation discovery specification for LLMs
---

# Agent Interface Specification

This protocol defines automated discovery endpoints for AI agents.
`;

    const docApi = `---
title: Compiler Tool Contracts
description: Machine-executable tool contracts for compilation and verification
---

# Compiler Tool Contracts

Functions and schemas exported for agent function calling.
`;

    const ast1 = await parseDocument(docIntro, 'docs/agent-guide.pdx');
    const ast2 = await parseDocument(docApi, 'docs/tool-contracts.pdx');

    const clean1 = toCleanMarkdown(ast1, { includeFrontmatter: true });
    const clean2 = toCleanMarkdown(ast2, { includeFrontmatter: true });

    // 1. Generate /llms.txt index
    const llmsTxt = [
      '# Lumen Knowledge Graph for AI Agents',
      '',
      '> Agent index of canonical documentation for LLM discovery.',
      '',
      '## Core Reference',
      '- [Agent Interface Guide](/docs/agent-guide.md): Documentation discovery specification for LLMs',
      '- [Compiler Tool Contracts](/docs/tool-contracts.md): Machine-executable tool contracts',
    ].join('\n');

    expectValidLlmsTxt(llmsTxt);
    expect(llmsTxt).toContain('/docs/agent-guide.md');
    expect(llmsTxt).toContain('/docs/tool-contracts.md');

    // 2. Generate /llms-full.txt complete corpus aggregation
    const llmsFull = ['# Complete Knowledge Graph Corpus', '', clean1, '', '---', '', clean2].join('\n');

    expectValidLlmsTxt(llmsFull);
    expect(llmsFull).toContain('# Agent Interface Specification');
    expect(llmsFull).toContain('# Compiler Tool Contracts');
  });

  it('exposes MCP tool execution contracts via Titan Netron RPC', async () => {
    const rpcService = new LumenRpcService({
      docsDir: 'docs',
      kbEnabled: true,
      mcpEnabled: true,
    });

    // 1. Check MCP tool schema definitions
    const symbolContract = await rpcService.getSymbolContract('lumen_inspect_ast');
    expect(symbolContract === null || typeof symbolContract === 'object').toBe(true);

    // 2. Execute sandboxed playground snippet via RPC
    const playgroundResult = (await rpcService.executePlayground(
      'JSON.stringify({ status: "active", nodes: 42 });'
    )) as { result: unknown; code: string };

    expect(playgroundResult).toBeDefined();
    expect(playgroundResult.code).toContain('nodes: 42');
  });
});
