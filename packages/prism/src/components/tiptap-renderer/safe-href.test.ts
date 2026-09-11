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
