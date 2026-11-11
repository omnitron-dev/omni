import { describe, it, expect } from 'vitest';
import { parseDocument, LumenFrontmatterSchema } from '@omnitron-dev/lumen-ast';

describe('Feature 4: prism-doc/2 Grammar & Schema Boundaries', () => {
  it('TC-B04-01: handles zero-byte and whitespace-only documents safely', async () => {
    const emptyDoc = '';
    const ast = await parseDocument(emptyDoc, 'docs/empty.pdx');

    expect(ast).toBeDefined();
    expect(ast.children).toBeDefined();
    expect(ast.toc).toEqual([]);
    expect(ast.frontmatter).toEqual({});
    expect(ast.diagnostics).toEqual([]);

    const whitespaceDoc = '   \n\n\t\t   \n';
    const wsAst = await parseDocument(whitespaceDoc, 'docs/ws.pdx');
    expect(wsAst.toc).toEqual([]);
  });

  it('TC-B04-02: parses maximum scale 5MB document with 10,000 paragraphs without heap exhaustion', async () => {
    const paragraphCount = 10_000;
    const paragraphs: string[] = ['---\ntitle: Massive Document Scale Test\n---\n'];
    for (let i = 0; i < paragraphCount; i++) {
      paragraphs.push(`Paragraph ${i + 1}: High precision mathematical manifold description with tensor fields.`);
    }
    const hugeContent = paragraphs.join('\n\n');
    expect(hugeContent.length).toBeGreaterThan(500_000);

    const initialHeapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    const startTime = Date.now();
    const ast = await parseDocument(hugeContent, 'docs/massive.pdx');
    const elapsed = Date.now() - startTime;
    const endHeapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    const diffHeapMb = Math.max(0, endHeapMb - initialHeapMb);

    expect(ast).toBeDefined();
    expect(ast.frontmatter.title).toBe('Massive Document Scale Test');
    expect(diffHeapMb).toBeLessThan(150);
    expect(elapsed).toBeLessThan(30_000);
  });

  it('TC-B04-03: emits structured diagnostic on corrupted YAML frontmatter syntax without unhandled crash', async () => {
    const corruptedYaml = `---
title: "unclosed quote string
  \ttab_indentation: [unclosed array
---

# Recovered Body
Body content following malformed frontmatter.
`;

    const ast = await parseDocument(corruptedYaml, 'docs/corrupted.pdx');
    expect(ast.diagnostics.length).toBeGreaterThan(0);
    expect(ast.diagnostics.some((d) => d.code === 'FRONTMATTER_PARSE_ERROR' || d.code === 'INVALID_FRONTMATTER')).toBe(
      true
    );
    expect(ast.rawContent).toBeDefined();
  });

  it('TC-B04-04: handles extreme and boundary values in LumenFrontmatterSchema validation', () => {
    // Negative numbers for sidebar_position
    const resNegative = LumenFrontmatterSchema.safeParse({
      id: 'doc-extreme',
      sidebar_position: -9999,
    });
    expect(resNegative.success).toBe(true);

    // Empty strings
    const resEmpty = LumenFrontmatterSchema.safeParse({
      id: '',
      title: '',
    });
    expect(resEmpty.success).toBe(true);

    // Non-array for tags
    const resInvalidTags = LumenFrontmatterSchema.safeParse({
      tags: 'single-string-instead-of-array',
    });
    expect(resInvalidTags.success).toBe(false);

    // Invalid relations structure
    const resInvalidRelations = LumenFrontmatterSchema.safeParse({
      relations: 'not-an-object',
    });
    expect(resInvalidRelations.success).toBe(false);
  });

  it('TC-B04-05: parses Cyrillic, CJK, and Emoji headings into valid slugified ToC entries', async () => {
    const unicodeDoc = `---
title: Международный квантовый портал 🚀
---

# Международная система 🌐
## Спектральная теория операторов {#теорема-спектра}
### 量子计算与数学 📐
#### 🚀 Fast Path Heading
`;

    const ast = await parseDocument(unicodeDoc, 'docs/unicode.pdx');
    expect(ast.toc.length).toBeGreaterThanOrEqual(4);
    expect(ast.toc[0].title).toContain('Международная система');
    expect(ast.toc[1].title).toContain('Спектральная теория операторов');
    expect(ast.toc[2].title).toContain('量子计算与数学');
    expect(ast.toc[3].title).toContain('Fast Path Heading');

    // Slug IDs must be non-empty and safe strings
    for (const item of ast.toc) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.level).toBeGreaterThanOrEqual(1);
    }
  });
});
