import { describe, expect, it } from 'vitest';
import {
  compileTypst,
  LumenFrontmatterSchema,
  LumenMacroRegistry,
  parseDocument,
  toCleanMarkdown,
  toHtmlSsr,
  toTipTapDoc,
} from './index.js';

describe('@omnitron-dev/lumen-ast', () => {
  it('registers, manages and retrieves KaTeX macros correctly', () => {
    const registry = new LumenMacroRegistry({ '\\R': '\\mathbb{R}' });
    expect(registry.getMacros()).toEqual({ '\\R': '\\mathbb{R}' });
    expect(registry.has('\\R')).toBe(true);
    expect(registry.size()).toBe(1);

    registry.register({ '\\N': '\\mathbb{N}', '\\Z': '\\mathbb{Z}' });
    expect(registry.getMacros()).toEqual({
      '\\N': '\\mathbb{N}',
      '\\R': '\\mathbb{R}',
      '\\Z': '\\mathbb{Z}',
    });
    expect(registry.size()).toBe(3);

    registry.clear();
    expect(registry.size()).toBe(0);
    expect(registry.getMacros()).toEqual({});
  });

  it('validates frontmatter schema with typed status and relations', () => {
    const validData = {
      id: 'thm-pythagoras',
      title: 'Pythagorean Theorem',
      status: 'verified',
      version: '1.0.0',
      tags: ['geometry', 'triangles'],
      relations: {
        dependsOn: ['def-right-triangle'],
        proves: ['cor-distance-formula'],
      },
      access: 'public',
    };

    const parsed = LumenFrontmatterSchema.safeParse(validData);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe('thm-pythagoras');
      expect(parsed.data.relations?.dependsOn).toContain('def-right-triangle');
    }
  });

  it('parses documents with frontmatter and extracts headings into table of contents', async () => {
    const content = `---
id: intro-doc
title: Introduction
status: canonical
---

# Introduction to SSG

Welcome to the documentation.

## Getting Started

Follow these steps.

### Prerequisites

Node.js is required.
`;

    const ast = await parseDocument(content, 'docs/intro.md');
    expect(ast.frontmatter.id).toBe('intro-doc');
    expect(ast.frontmatter.title).toBe('Introduction');
    expect(ast.frontmatter.status).toBe('canonical');
    expect(ast.toc).toHaveLength(3);
    expect(ast.toc[0]).toEqual({ id: 'introduction-to-ssg', title: 'Introduction to SSG', level: 1 });
    expect(ast.toc[1]).toEqual({ id: 'getting-started', title: 'Getting Started', level: 2 });
    expect(ast.toc[2]).toEqual({ id: 'prerequisites', title: 'Prerequisites', level: 3 });
    expect(ast.diagnostics).toEqual([]);

    const html = toHtmlSsr(ast);
    expect(html).toContain('Introduction');
    expect(html).toContain('lumen-doc');
    expect(html).toContain('data-status="canonical"');

    const cleanMd = toCleanMarkdown(ast);
    expect(cleanMd).toContain('# Introduction to SSG');

    const tipTap = toTipTapDoc(ast);
    expect(tipTap['type']).toBe('doc');

    const typst = await compileTypst(ast);
    expect(typst).toBeInstanceOf(Uint8Array);
    expect(typst.length).toBeGreaterThan(0);
  });

  it('gracefully handles missing frontmatter and reports no diagnostics for clean markdown', async () => {
    const raw = '# Plain Markdown\n\nJust text without metadata.';
    const ast = await parseDocument(raw);
    expect(ast.frontmatter).toEqual({});
    expect(ast.diagnostics).toEqual([]);
    expect(ast.toc).toHaveLength(1);
    expect(ast.toc[0]?.title).toBe('Plain Markdown');
  });
});
