/**
 * Every `useFactory` gets as many tokens as it takes parameters.
 *
 * A short `inject:` array is silent: the container passes what it was given,
 * the missing parameter is `undefined`, and the failure surfaces later as a
 * TypeError on a path nobody runs at boot — or worse, inside a `try/catch`
 * that reports it as something else entirely.
 *
 * Not hypothetical, and not someone else's: a maintenance-mode guard added to
 * the downstream auth service this same session never ran, because its module's
 * array was one token short. Every successful sign-in threw. Five unit tests
 * covered the guard and all passed — they constructed the service by hand and
 * supplied the dependency themselves, so they could not see that nothing else
 * did. In the same file sat a comment naming the exact failure mode.
 *
 * This reads the source rather than constructing anything, which is the whole
 * point: a test that builds the wiring it is checking proves only that the
 * constructor assigns its arguments.
 *
 * It reads it with TypeScript's own parser. The first version matched
 * `useFactory:\s*\(([^)]*)\)` — the parameter list up to the first `)` — and
 * a parameter typed `import('…').T` closes early there. Measured 2026-09-22 on
 * `MASTER_PROJECT_SERVICE_PROVIDER`: «3 params, 5 tokens» for a factory taking
 * five. The same cut, the other way, passes a factory that IS short —
 * `(a: import('x').A, b: B, c: C)` with one token read as one and one — and
 * the regex had also been matching that provider's TYPE annotation rather than
 * its value, and could not see a factory given by name at all. The last
 * describe below holds the parser to each of those.
 *
 * TypeScript 7, which the monorepo builds with, ships no parser API to
 * JavaScript. `tools/lint` holds TypeScript 6 for typescript-eslint, for the
 * same reason, and this borrows it through that package's own resolution.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const REPO = path.resolve(ROOT, '../..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeScript 6's API, typed by nothing TS 7 ships
const ts: any = createRequire(path.join(REPO, 'tools/lint/package.json'))('typescript');

interface FactoryProvider {
  file: string;
  line: number;
  params: number;
  /** A rest parameter takes any number of tokens past the fixed ones. */
  rest: boolean;
  tokens: number;
}

/** A provider this could not count — said, rather than skipped. */
interface Unchecked {
  file: string;
  line: number;
  why: string;
}

/**
 * Every object literal in `text` that declares both `useFactory` and
 * `inject`, with the factory's parameters and the array's tokens counted by
 * the AST.
 *
 * Factories WITHOUT `inject:` are deliberately not reported: the container
 * then reads parameter decorators, which is a different and working
 * mechanism. Only a declared array can be short.
 */
function providersIn(file: string, text: string): { providers: FactoryProvider[]; unchecked: Unchecked[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const providers: FactoryProvider[] = [];
  const unchecked: Unchecked[] = [];

  // A factory may be given by name: a function declared in the same file, or
  // a const holding an arrow or a function expression.
  const functions = new Map<string, unknown>();
  const collect = (node: any): void => {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      functions.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const property = (literal: any, name: string): any =>
    literal.properties.find(
      (p: any) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name,
    );

  const visit = (node: any): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const factory = property(node, 'useFactory');
      const inject = property(node, 'inject');
      if (factory && inject) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        let fn = factory.initializer;
        if (ts.isIdentifier(fn)) fn = functions.get(fn.text) ?? fn;
        const array = inject.initializer;

        if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn))) {
          unchecked.push({ file, line, why: `useFactory is \`${factory.initializer.getText(source)}\`, which is not a function in this file` });
        } else if (!ts.isArrayLiteralExpression(array) || array.elements.some((e: any) => ts.isSpreadElement(e))) {
          unchecked.push({ file, line, why: `inject is \`${array.getText(source)}\`, which cannot be counted from the source` });
        } else {
          providers.push({
            file,
            line,
            params: fn.parameters.filter((p: any) => !p.dotDotDotToken).length,
            rest: fn.parameters.some((p: any) => Boolean(p.dotDotDotToken)),
            tokens: array.elements.length,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { providers, unchecked };
}

function findFactoryProviders(): { providers: FactoryProvider[]; unchecked: Unchecked[] } {
  const providers: FactoryProvider[] = [];
  const unchecked: Unchecked[] = [];
  for (const rel of globSync('src/**/*.ts', { cwd: ROOT })) {
    const found = providersIn(rel, readFileSync(path.join(ROOT, rel), 'utf8'));
    providers.push(...found.providers);
    unchecked.push(...found.unchecked);
  }
  return { providers, unchecked };
}

const short = (ps: FactoryProvider[]) => ps.filter((p) => p.tokens < p.params);
const surplus = (ps: FactoryProvider[]) => ps.filter((p) => p.tokens > p.params && !p.rest);
const said = (ps: FactoryProvider[]) => ps.map((p) => `${p.file}:${p.line} — ${p.params} params, ${p.tokens} tokens`);

describe('provider arity', () => {
  const { providers, unchecked } = findFactoryProviders();

  it('finds the factory providers it is meant to check', () => {
    // A lower bound, so a change to how providers are written cannot turn
    // this suite into one that passes by examining nothing. That failure mode
    // is the reason this file exists.
    expect(providers.length).toBeGreaterThanOrEqual(10);
  });

  it('counts every provider it finds', () => {
    // One it could not count is one it did not check.
    expect(unchecked.map((u) => `${u.file}:${u.line} — ${u.why}`)).toEqual([]);
  });

  it('gives every factory as many tokens as it has parameters', () => {
    expect(said(short(providers))).toEqual([]);
  });

  it('does not silently pass a factory with more tokens than parameters', () => {
    // The arity guard in Nexus reports a shortfall; a surplus is discarded
    // without a word, so a token added to the array and never to the
    // signature just disappears.
    expect(said(surplus(providers))).toEqual([]);
  });
});

describe('the parser itself', () => {
  it('counts a parameter typed through an inline import — and finds the factory short', () => {
    // The case the regex passed: it read `(a: import('x'` as the whole list —
    // one parameter against one token.
    const { providers } = providersIn(
      'planted.ts',
      "const P = { useFactory: (a: import('x').A, b: B, c: C) => new S(a, b, c), inject: [TA] };",
    );
    expect(said(short(providers))).toEqual(['planted.ts:1 — 3 params, 1 tokens']);
  });

  it('reads a provider declared with a type annotation once, from its value', () => {
    const { providers } = providersIn(
      'planted.ts',
      [
        'export const P: {',
        '  readonly inject: readonly unknown[];',
        '  readonly useFactory: (a: A, b: import("./b.js").B, c: C) => S;',
        '} = {',
        '  inject: [TA, TB, TC],',
        '  useFactory: (a: A, b: import("./b.js").B, c: C): S => new S(a, b, c),',
        '};',
      ].join('\n'),
    );
    expect(providers).toEqual([{ file: 'planted.ts', line: 4, params: 3, rest: false, tokens: 3 }]);
  });

  it('follows a factory given by name', () => {
    const { providers, unchecked } = providersIn(
      'planted.ts',
      ['function make(a: A, b: B, c: C) { return new S(a, b, c); }', 'const P = { useFactory: make, inject: [TA, TB] };'].join('\n'),
    );
    expect(unchecked).toEqual([]);
    expect(said(short(providers))).toEqual(['planted.ts:2 — 3 params, 2 tokens']);
  });

  it('is not fooled by generics, defaults or async', () => {
    const { providers } = providersIn(
      'planted.ts',
      'const P = { useFactory: async (a: Map<string, Array<[number, string]>>, b = f(1, [2, 3], { c: 4 })) => g(a, b), inject: [TA, TB] };',
    );
    expect(providers.map((p) => [p.params, p.tokens])).toEqual([[2, 2]]);
  });

  it('says what it could not count instead of passing it', () => {
    const { providers, unchecked } = providersIn('planted.ts', 'const P = { useFactory: imported, inject: [...TOKENS] };');
    expect(providers).toEqual([]);
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]!.why).toMatch(/not a function in this file/);
  });
});
