/**
 * `loadRuntimeAdapter()` promises one surface across three runtimes. It did not
 * deliver one: bun-adapter exported NOTHING (it only assigned globals) and
 * deno-adapter had no `test`. So the documented `adapter.test(...)` worked on
 * Node and was `undefined is not a function` on Bun — a failure that appears
 * only when someone runs the suite under that runtime, which is exactly the
 * moment the package exists to make cheap.
 *
 * bun-adapter imports `bun:test` and deno-adapter needs Deno globals, so
 * neither can be imported here. The surface is therefore checked statically —
 * with a control below, because a source parser that silently matches nothing
 * would report perfect agreement.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The names every adapter must expose. Mocking is deliberately absent: it is
 *  `vi` on node/bun and `mockFn` on deno, and unifying it is a design call. */
const SURFACE = [
  'describe',
  'it',
  'test',
  'expect',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'fakeTimers',
] as const;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Exported names of a module, from its source. */
function exportedNames(file: string): Set<string> {
  const src = stripComments(readFileSync(join(HERE, file), 'utf8'));
  const names = new Set<string>();

  // export const x / export function x / export class x
  for (const m of src.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]!);
  }
  // export { a, b as c }  — the alias is the exported name
  for (const block of src.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of block[1]!.split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      names.add(as ? as[1]! : t);
    }
  }
  return names;
}

describe('runtime adapter surface', () => {
  it('the parser can tell present from absent', () => {
    // Without this the checks below pass by finding nothing anywhere.
    const node = exportedNames('node-adapter.ts');
    expect(node.has('expect'), 'parser found no exports at all in node-adapter').toBe(true);
    expect(node.has('definitelyNotExported')).toBe(false);
  });

  for (const file of ['node-adapter.ts', 'bun-adapter.ts', 'deno-adapter.ts']) {
    it(`${file} exports the whole surface`, () => {
      const names = exportedNames(file);
      const missing = SURFACE.filter((n) => !names.has(n));
      expect(missing, `${file} is missing exports that loadRuntimeAdapter() callers use`).toEqual([]);
    });
  }
});
