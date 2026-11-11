import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSafeFrontmatter } from '../src/ast/frontmatter.js';

describe('frontmatter authorization boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    'title: [unfinished',
    'access: public\ntitle: [unfinished',
    '#'.repeat(5000) + '\naccess: confidential\ntitle: [unfinished',
    '- confidential',
    'metadata: &entry { child: *entry }',
  ])('never recovers malformed metadata as public (case %#)', (metadata) => {
    const parsed = parseSafeFrontmatter(`---\n${metadata}\n---\n# Body\nPrivate document.`);
    expect(parsed.frontmatter.access).toBe('restricted');
    expect(parsed.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('supports JSON and BOM/CRLF metadata without Node globals', () => {
    vi.stubGlobal('Buffer', undefined);
    const parsed = parseSafeFrontmatter('\uFEFF---json\r\n{"title":"Документ","access":"internal"}\r\n---\r\nBody');
    expect(parsed.frontmatter).toMatchObject({ title: 'Документ', access: 'internal' });
    expect(parsed.content).toBe('Body');
  });
});
