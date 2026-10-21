/**
 * The control-character guard in `isSafeHref` used to be written with the
 * literal bytes, so it read as `/[ -]/` — "a space or a dash" — in every
 * editor, diff and review. It actually rejects C0 plus DEL, which is what
 * stops `java\tscript:` from reaching a parser that strips the tab and sees
 * `javascript:`.
 *
 * Pinned here because the next person to "simplify" that character class has
 * no way to tell from the source what it was for.
 */

import { describe, it, expect } from 'vitest';

import { sanitizeHref } from './tiptap-renderer.js';

describe('sanitizeHref', () => {
  it('accepts ordinary absolute and root-relative URLs', () => {
    expect(sanitizeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(sanitizeHref('http://example.com')).toBe('http://example.com');
    expect(sanitizeHref('/local/path')).toBe('/local/path');
  });

  it('rejects a scheme smuggled past a parser with a control character', () => {
    expect(sanitizeHref('java\tscript:alert(1)')).toBeUndefined();
    expect(sanitizeHref('java\nscript:alert(1)')).toBeUndefined();
    expect(sanitizeHref('java\x00script:alert(1)')).toBeUndefined();
    expect(sanitizeHref('https://example.com/\x7f')).toBeUndefined();
  });

  it('rejects the schemes themselves', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeHref('data:text/html,<script>')).toBeUndefined();
  });

  it('rejects protocol-relative and backslash tricks', () => {
    expect(sanitizeHref('//evil.example/x')).toBeUndefined();
    expect(sanitizeHref('/\\evil.example/x')).toBeUndefined();
  });

  it('rejects non-strings and empties', () => {
    expect(sanitizeHref('')).toBeUndefined();
    expect(sanitizeHref(null)).toBeUndefined();
    expect(sanitizeHref(42)).toBeUndefined();
  });
});

it('preserves relative corpus paths without admitting alternate schemes or authorities', () => {
  for (const path of ['./chapter', '../lemma.md#proof', 'lemma.md', '?page=2']) {
    expect(sanitizeHref(path)).toBe(path);
    expect(new URL(sanitizeHref(path)!, 'https://corpus.example/docs/').origin).toBe('https://corpus.example');
  }
  for (const url of [
    ' //evil.example',
    '\\\\evil.example',
    './\\evil.example',
    'file:secrets',
    'vbscript:alert(1)',
    'unknown:payload',
    ' javascript:alert(1)',
  ])
    expect(sanitizeHref(url)).toBeUndefined();
});
