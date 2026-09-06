/**
 * The error modules must not import each other in a circle.
 *
 * `errors/netron.ts` ended with `export { ContractError } from './contract.js'`
 * — a re-export "for convenience" of a class that lives elsewhere — and
 * `contract.ts` imports `Errors` from `factories.ts`, which imports the netron
 * error classes. Three files, one loop.
 *
 * It did not fail, and that is the point. ESM tolerates a cycle until one side
 * needs a VALUE while the other is still evaluating: a class extended at load,
 * a decorator applied, a constant read in a top-level initialiser. Every use
 * across this loop happened to sit inside a function body. Adding one subclass
 * or one top-level `const` on either side turns it into `undefined is not a
 * constructor` at import time — and which side breaks depends on which module
 * the process reached first, so the failure moves when unrelated files are
 * touched.
 *
 * This directory is the wrong place to carry that hazard: these classes are
 * used with `instanceof` and extended by every other error family in the
 * stack.
 *
 * Type-only imports are excluded — they are erased and cannot participate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';

/**
 * Directories held acyclic.
 *
 * `netron/transport/http` is deliberately NOT here: `client.ts` and `peer.ts`
 * import each other because a client creates peers and a peer holds its
 * client, and separating them means an interface split, not a moved import.
 * Two cycles live there today; both were checked for load-time value use and
 * neither has any. That is a reason to leave them, not a reason to forget
 * them — naming the exclusion is what keeps the difference between "checked
 * and accepted" and "never looked at".
 */
const ACYCLIC_DIRS = ['errors', 'nexus'] as const;

const IMPORT = /^\s*import\s+(type\s+)?([^'"]*?)from\s*['"](\.[^'"]+)['"]/gm;
const REEXPORT = /^\s*export\s+(type\s+)?(?:\*|\{[^}]*\})\s*from\s*['"](\.[^'"]+)['"]/gm;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.d.ts') ? [full] : [];
  });
}

function resolveSpec(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

function buildGraph(root: string): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const file of tsFiles(root)) {
    const text = readFileSync(file, 'utf-8');
    const targets = new Set<string>();
    for (const [, typeOnly, clause, spec] of text.matchAll(IMPORT)) {
      if (typeOnly || clause!.trim().startsWith('type ')) continue;
      const target = resolveSpec(file, spec!);
      if (target && target !== file) targets.add(target);
    }
    for (const [, typeOnly, spec] of text.matchAll(REEXPORT)) {
      if (typeOnly) continue;
      const target = resolveSpec(file, spec!);
      if (target && target !== file) targets.add(target);
    }
    graph.set(file, targets);
  }
  return graph;
}

function findCycles(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const state = new Map<string, 'grey' | 'black'>();
  const stack: string[] = [];

  const visit = (node: string) => {
    state.set(node, 'grey');
    stack.push(node);
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (state.get(next) === 'grey') {
        const cycle = [...stack.slice(stack.indexOf(next)), next];
        const key = [...new Set(cycle)].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 'black');
  };

  for (const node of [...graph.keys()].sort()) if (!state.has(node)) visit(node);
  return cycles;
}

describe.each(ACYCLIC_DIRS)('%s modules', (dirName) => {
  const dir = resolve(new URL(`../../src/${dirName}`, import.meta.url).pathname);
  const graph = buildGraph(dir);

  it('has files and edges to inspect', () => {
    // Both assertions below pass trivially on an empty graph, which is how a
    // probe that stopped finding files reports "all clear".
    expect(graph.size, `no modules found under src/${dirName}`).toBeGreaterThan(5);
    expect([...graph.values()].reduce((n, s) => n + s.size, 0), 'no edges found').toBeGreaterThan(5);
  });

  it('import each other without a cycle', () => {
    const cycles = findCycles(graph).map((c) => c.map((f) => relative(dir, f)).join(' -> '));

    expect(cycles, `import cycles under src/${dirName}:\n  ${cycles.join('\n  ')}`).toEqual([]);
  });
});
