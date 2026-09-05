/**
 * `table()` is called with an options object, never a bare array.
 *
 * `@xec-sh/kit` exports `table({ data, columns })` and throws
 * `TypeError: Table data must be an array` on anything else. Two calls in
 * `commands/node.ts` passed the rows directly, so `omnitron node list` and
 * `omnitron node ssh-keys` failed every time they had something to show —
 * the empty-list branch returns earlier, which is the only path that ever
 * worked, and the only one anyone would have tried on a fresh install.
 *
 * The compiler is no help here and that is the point: every field of the
 * options type is optional, and an array is structurally assignable to a
 * type with no required members. `tsc` was clean for as long as the command
 * was broken.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS = path.resolve(here, '../../src/commands');

function commandSources(): Array<{ file: string; source: string }> {
  return fs
    .readdirSync(COMMANDS)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, source: fs.readFileSync(path.join(COMMANDS, f), 'utf8') }));
}

/** Call sites of the bare `table(` helper, with what follows the paren. */
function tableCalls(source: string): string[] {
  // `\btable\(` and not `interactiveTable(`; the capture is enough context
  // to tell an object literal from anything else.
  return Array.from(source.matchAll(/(?<![A-Za-z])table\(\s*([\s\S]{0,40})/g), (m) => m[1]!);
}

describe('table() call sites', () => {
  const sources = commandSources();

  it('found the command modules and some calls in them', () => {
    // Before asserting a property of a list that could be empty.
    expect(sources.length).toBeGreaterThan(10);
    const total = sources.reduce((n, s) => n + tableCalls(s.source).length, 0);
    expect(total, 'table() call sites').toBeGreaterThan(5);
  });

  it('always passes an options object', () => {
    const offenders: string[] = [];

    for (const { file, source } of sources) {
      for (const tail of tableCalls(source)) {
        if (!tail.trimStart().startsWith('{')) {
          offenders.push(`${file}: table(${tail.split('\n')[0]!.trim()}…`);
        }
      }
    }

    expect(offenders, 'table() needs { data, columns } — a bare array throws at runtime').toEqual([]);
  });

  it('names both data and columns at every call site', () => {
    // `{ data }` without `columns` throws too — "Table must have at least
    // one column" — and is just as invisible to the compiler.
    const incomplete: string[] = [];

    for (const { file, source } of sources) {
      for (const m of source.matchAll(/(?<![A-Za-z])table\(\s*\{([\s\S]{0,4000}?)\n\s*\}\);/g)) {
        const body = m[1]!;
        // Shorthand counts: `{ data, columns }` is the same object as
        // `{ data: data, columns: columns }`. The first version of this
        // check looked for `data:` and reported four call sites that were
        // perfectly correct — it answered "where does this text appear",
        // not "does this object have that property".
        const has = (name: string) =>
          new RegExp(`(^|[{,\\s])${name}\\s*(:|,|$)`, 'm').test(body);
        if (!has('data') || !has('columns')) {
          incomplete.push(`${file}: ${body.slice(0, 60).replace(/\s+/g, ' ')}…`);
        }
      }
    }

    expect(incomplete, 'every table() needs both data and columns').toEqual([]);
  });
});
