import { describe, it, expect } from 'vitest';
import { parseDocument } from '@omnitron-dev/lumen-ast';
import { CorpusGraph, defineLumenConfig, generateLlmsTxt, generateLlmsFullTxt } from '@omnitron-dev/lumen';
import { createLumenFixture, mcpFor } from '../../../packages/titan-lumen/tests/netron-fixture.js';
import { expectValidLlmsTxt } from '../harness/assertions.js';

const documents = {
  'agent-guide.pdx': '---\ntitle: Agent Interface Guide\n---\n# Agent Interface Specification\nAutomated discovery endpoints for AI agents.',
  'tool-contracts.pdx': '---\ntitle: Compiler Tool Contracts\n---\n# Compiler Tool Contracts\nMachine-executable compilation contracts.',
};

describe('AI agent discovery through published generators and MCP', () => {
  it('generates actual agent indexes and full text from the corpus', async () => {
    const graph = new CorpusGraph();
    for (const [path, content] of Object.entries(documents)) {
      const ast = await parseDocument(content, path);
      graph.addDocument({ id: path, path, title: ast.frontmatter.title!, hash: path,
        anchors: [], mathObjects: [], backlinks: [], ast, frontmatter: ast.frontmatter });
    }
    const config = defineLumenConfig({ title: 'Agent corpus' });
    const index = generateLlmsTxt(graph, config);
    const full = generateLlmsFullTxt(graph, config);
    expectValidLlmsTxt(index);
    expect(index).toContain('agent-guide.md');
    expect(index).toContain('tool-contracts.md');
    expect(full).toContain('# Agent Interface Specification');
    expect(full).toContain('# Compiler Tool Contracts');
  });

  it('discovers actual tool schemas and inspects the authorized document AST', async () => {
    const mcp = await mcpFor(createLumenFixture(documents));
    const tools = await mcp.call({ method: 'tools/list' });
    expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'search_corpus', 'get_document', 'lumen_inspect_ast',
    ]);
    const inspected = await mcp.call({ method: 'tools/call', params: {
      name: 'lumen_inspect_ast', arguments: { docId: 'agent-guide.pdx' },
    } });
    expect(inspected.result).toMatchObject({ type: 'doc', frontmatter: { title: 'Agent Interface Guide' } });
    expect(JSON.stringify(inspected.result.content)).toContain('Automated discovery endpoints');
  });
});
