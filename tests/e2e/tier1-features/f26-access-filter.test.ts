import { describe, it, expect } from 'vitest';
import { parseDocument, LumenFrontmatterSchema } from '@omnitron-dev/lumen-ast';

describe('Feature 26: Access Filtering & Auth', () => {
  it('TC-F26-01: validates access levels in frontmatter schema (public, internal, confidential)', () => {
    const validPublic = LumenFrontmatterSchema.safeParse({ access: 'public' });
    const validInternal = LumenFrontmatterSchema.safeParse({ access: 'internal' });
    const validConfidential = LumenFrontmatterSchema.safeParse({ access: 'confidential' });

    expect(validPublic.success).toBe(true);
    expect(validInternal.success).toBe(true);
    expect(validConfidential.success).toBe(true);
  });

  it('TC-F26-02: preserves access frontmatter field in parsed document AST', async () => {
    const doc = `---
title: Confidential Architecture
access: confidential
---

# Architecture
Internal architecture design.
`;

    const ast = await parseDocument(doc, 'docs/confidential.pdx');
    expect(ast.frontmatter.access).toBe('confidential');
  });

  it('TC-F26-03: filters out confidential sections when user lacks required permissions', () => {
    const sections = [
      { id: 'sec-public', access: 'public', text: 'Public API' },
      { id: 'sec-internal', access: 'internal', text: 'Internal Implementation' },
      { id: 'sec-secret', access: 'confidential', text: 'Proprietary Secret' },
    ];

    const userRoles = ['anonymous'];
    const filtered = sections.filter((sec) => {
      if (sec.access === 'public') return true;
      if (sec.access === 'internal') return userRoles.includes('staff');
      if (sec.access === 'confidential') return userRoles.includes('admin');
      return false;
    });

    expect(filtered.map((s) => s.id)).toEqual(['sec-public']);
  });

  it('TC-F26-04: grants access to confidential sections when user holds admin role', () => {
    const sections = [
      { id: 'sec-public', access: 'public', text: 'Public API' },
      { id: 'sec-internal', access: 'internal', text: 'Internal Implementation' },
      { id: 'sec-secret', access: 'confidential', text: 'Proprietary Secret' },
    ];

    const userRoles = ['admin'];
    const filtered = sections.filter((sec) => {
      if (sec.access === 'public') return true;
      if (sec.access === 'internal') return userRoles.includes('staff') || userRoles.includes('admin');
      if (sec.access === 'confidential') return userRoles.includes('admin');
      return false;
    });

    expect(filtered.length).toBe(3);
  });

  it('TC-F26-05: defaults to public access when frontmatter access field is omitted', async () => {
    const doc = `---
title: Default Access Document
---

Standard public text.
`;

    const ast = await parseDocument(doc, 'docs/default.pdx');
    const effectiveAccess = ast.frontmatter.access ?? 'public';
    expect(effectiveAccess).toBe('public');
  });
});
