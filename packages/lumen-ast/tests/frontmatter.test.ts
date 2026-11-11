import { describe, it, expect } from 'vitest';
import { parseDocument, LumenFrontmatterSchema, validateFrontmatter } from '../src/index.js';

describe('Frontmatter Parsing & Schema Validation', () => {
  it('validates standard frontmatter with typed status, tags, and relations', () => {
    const data = {
      id: 'doc-manifold',
      title: 'Differentiable Manifolds',
      status: 'verified',
      version: '2.1.0',
      tags: ['topology', 'geometry'],
      relations: {
        dependsOn: ['def-topological-space'],
        proves: ['thm-whitney-embedding'],
        seeAlso: ['doc-lie-groups'],
      },
      access: 'public',
      sidebar_position: 5,
      authors: ['Alice Researcher', 'Bob Mathematician'],
      paper: true,
      abstract: 'A rigorous exposition of smooth manifolds.',
    };

    const parsed = LumenFrontmatterSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe('doc-manifold');
      expect(parsed.data.status).toBe('verified');
      expect(parsed.data.relations?.dependsOn).toContain('def-topological-space');
      expect(parsed.data.relations?.proves).toContain('thm-whitney-embedding');
      expect(parsed.data.paper).toBe(true);
    }
  });

  it('rejects invalid types and produces helpful diagnostics', () => {
    const invalidData = {
      sidebar_position: 'not-a-number',
      tags: 'not-an-array',
      relations: 12345,
    };

    const { diagnostics } = validateFrontmatter(invalidData, 'docs/test.pdx');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === 'INVALID_FRONTMATTER')).toBe(true);
    expect(diagnostics.some((d) => d.message.includes('tags'))).toBe(true);
  });

  it('recovers gracefully from corrupted YAML syntax', async () => {
    const malformed = `---
title: "unclosed string
tags: [broken array
---

# Document Body
Recovered cleanly.
`;

    const ast = await parseDocument(malformed, 'docs/malformed.pdx');
    expect(ast.diagnostics.length).toBeGreaterThan(0);
    expect(ast.diagnostics.some((d) => d.code === 'FRONTMATTER_PARSE_ERROR')).toBe(true);
    expect(ast.rawContent).toContain('Recovered cleanly.');
    expect(ast.children.length).toBeGreaterThan(0);
  });

  it('preserves passthrough unknown frontmatter fields without dropping data', () => {
    const dataWithCustomFields = {
      id: 'doc-custom',
      customKey: 'customValue',
      metaInfo: { rating: 5, reviewedBy: 'Auditor' },
    };

    const parsed = LumenFrontmatterSchema.safeParse(dataWithCustomFields);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>)['customKey']).toBe('customValue');
      expect((parsed.data as Record<string, unknown>)['metaInfo']).toEqual({ rating: 5, reviewedBy: 'Auditor' });
    }
  });
});
