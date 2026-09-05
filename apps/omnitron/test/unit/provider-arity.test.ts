/**
 * Every `useFactory` gets as many tokens as it takes parameters.
 *
 * A short `inject:` array is silent: the container passes what it was given,
 * the missing parameter is `undefined`, and the failure surfaces later as a
 * TypeError on a path nobody runs at boot — or worse, inside a `try/catch`
 * that reports it as something else entirely.
 *
 * Not hypothetical, and not someone else's: a maintenance-mode guard added to
 * the DAOS auth service this same session never ran, because its module's
 * array was one token short. Every successful sign-in threw. Five unit tests
 * covered the guard and all passed — they constructed the service by hand and
 * supplied the dependency themselves, so they could not see that nothing else
 * did. In the same file sat a comment naming the exact failure mode.
 *
 * This reads the source rather than constructing anything, which is the whole
 * point: a test that builds the wiring it is checking proves only that the
 * constructor assigns its arguments.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

interface FactoryProvider {
  file: string;
  line: number;
  params: number;
  tokens: number;
}

/**
 * Find every `useFactory` that also declares `inject:`.
 *
 * Factories WITHOUT `inject:` are deliberately not reported: the container
 * then reads parameter decorators, which is a different and working
 * mechanism. Only a declared-but-short array is a defect.
 */
function findFactoryProviders(): FactoryProvider[] {
  const files = globSync('src/**/*.ts', { cwd: ROOT });
  const found: FactoryProvider[] = [];

  for (const rel of files) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');

    // Each factory is examined only up to where the NEXT one begins. A single
    // regex spanning `useFactory … inject:` runs past the end of its own
    // provider and pairs a factory with a later provider's array — which is
    // how the first version of this reported two factories taking no
    // parameters as having surplus tokens.
    const starts = [...src.matchAll(/useFactory:\s*(?:async\s*)?\(([^)]*)\)/g)];

    for (const [index, start] of starts.entries()) {
      const from = start.index! + start[0].length;
      const to = starts[index + 1]?.index ?? src.length;
      const window = src.slice(from, to);

      const injectMatch = /inject:\s*\[([^\]]*)\]/.exec(window);
      // No `inject:` of its own means the container reads parameter
      // decorators instead — a different, working mechanism.
      if (!injectMatch) continue;

      found.push({
        file: rel,
        line: src.slice(0, start.index!).split('\n').length,
        params: start[1]!.split(',').map((s) => s.trim()).filter(Boolean).length,
        tokens: injectMatch[1]!.split(',').map((s) => s.trim()).filter(Boolean).length,
      });
    }
  }

  return found;
}

describe('provider arity', () => {
  const providers = findFactoryProviders();

  it('finds the factory providers it is meant to check', () => {
    // A lower bound, so a change to how providers are written cannot turn
    // this suite into one that passes by examining nothing. That failure mode
    // is the reason this file exists.
    expect(providers.length).toBeGreaterThanOrEqual(10);
  });

  it('gives every factory as many tokens as it has parameters', () => {
    const short = providers.filter((p) => p.tokens < p.params);

    expect(
      short.map((p) => `${p.file}:${p.line} — ${p.params} params, ${p.tokens} tokens`)
    ).toEqual([]);
  });

  it('does not silently pass a factory with more tokens than parameters', () => {
    // The arity guard in Nexus reports a shortfall; a surplus is discarded
    // without a word, so a token added to the array and never to the
    // signature just disappears.
    const surplus = providers.filter((p) => p.tokens > p.params);

    expect(
      surplus.map((p) => `${p.file}:${p.line} — ${p.params} params, ${p.tokens} tokens`)
    ).toEqual([]);
  });
});
