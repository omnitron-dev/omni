/**
 * Seven scanners each carried a comment-stripper that deletes code.
 *
 * Each had its own copy of the same pair of regexes: one from a block
 * opener to the next closer, one from `//` to a newline. A regex cannot tell
 * a comment from the same characters inside a string, so it deletes
 * everything between them wherever they happen to appear — and a template
 * literal holding a shell script, a glob or a URL contains both.
 *
 * Measured across `apps/omnitron/src`: 6 502 bytes of real code deleted in 6
 * of 234 files, 5 238 of them in one whose template literals hold build
 * commands.
 *
 * The cost is not the bytes. A scanner reading that output sees source with
 * holes in it and reports what it cannot see as ABSENT — a call site that
 * was deleted looks like a call site that does not exist. Nothing goes red
 * when it happens, because a clean scan is exactly what everyone hopes for.
 * This repository has been here before: seven scans sharing a stripper that
 * deleted code reported 26 live keys as dead.
 */

import { describe, it, expect } from 'vitest';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

/** The form every scanner used to carry, for comparison. */
const regexStrip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, (_m, p) => p);

describe('what a regex stripper destroys', () => {
  it('keeps a glob inside a template literal', () => {
    // A lone opener in a glob is harmless. The damage is that it pairs with
    // the closer of the NEXT real comment, and everything between the two —
    // in a real file, hundreds of lines — goes with it.
    const src = [
      'const cmd = `find . -name **/*.ts`;',
      'const after = 1;',
      '/** a docblock further down the file */',
      'const tail = 2;',
    ].join('\n');

    expect(regexStrip(src)).not.toContain('after');
    expect(stripComments(src)).toContain('after');
    expect(stripComments(src)).toContain('**/*.ts');
    expect(stripComments(src)).not.toContain('docblock');
  });

  it('keeps a URL inside a string', () => {
    const src = 'const u = "https://example.com/x"; const after = 2;';

    expect(stripComments(src)).toContain('https://example.com/x');
    expect(stripComments(src)).toContain('after');
  });

  it('keeps a regex literal that looks like a comment', () => {
    const src = 'const re = /\\/\\*/g; const after = 3;';

    expect(stripComments(src)).toContain('after');
  });

  it('still removes the comments it is for', () => {
    const stripped = stripComments('a // one\nb /* two */ c');

    expect(stripped).not.toContain('one');
    expect(stripped).not.toContain('two');
    expect(stripped.replace(/\s+/g, ' ').trim()).toBe('a b c');
  });
});

describe('what a scanner needs from it', () => {
  it('keeps every line on its own line number', () => {
    const src = 'const a = 1;\n/* two\n   lines */\nconst b = 2;';

    // A scanner reporting `file:line` must report the line the reader will
    // open. Collapsing a block comment shifts everything below it.
    expect(stripComments(src).split('\n')).toHaveLength(src.split('\n').length);
    expect(stripComments(src).split('\n')[3]).toContain('const b');
  });

  it('survives an unterminated comment without eating the file', () => {
    const src = 'const a = 1;\n/* never closed';

    expect(stripComments(src)).toContain('const a = 1;');
  });

  it('handles an escaped quote inside a string', () => {
    const src = 'const s = "a \\" // not a comment"; const after = 4;';

    expect(stripComments(src)).toContain('after');
    expect(stripComments(src)).toContain('not a comment');
  });

  it('errs towards keeping code when it cannot tell', () => {
    // A slash after a value is division, not a regex. Reading it as a regex
    // would swallow to the next slash; reading it as division keeps
    // everything. Whichever way the heuristic is wrong, it must be wrong in
    // the direction that preserves code.
    const src = 'const x = a / b; const after = 5;';

    expect(stripComments(src)).toContain('after');
  });
});
