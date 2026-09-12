/**
 * `kysera.plugins` and `plugins.builtIn` are merged, not alternatives.
 *
 * `applyGlobalPlugins` used to return as soon as `kysera.plugins` was
 * non-empty, so configuring one explicit plugin silently dropped `timestamps`,
 * `softDelete` and `audit`. An option that turns another option off without
 * saying so is the kind of thing nobody discovers until rows stop getting a
 * `createdAt`.
 *
 * This matters beyond tidiness: the global plugin list is the ONLY delivery
 * path in this package that runs a plugin's async `onInit`, which
 * `@kysera/rls` requires before it will intercept anything. Anything that
 * wants RLS has to go through here — and would have taken timestamps out with
 * it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../src/database.manager.ts', import.meta.url)),
  'utf8',
);

/** Comments stripped: the prose explains the fix in the words being searched. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p: string) => p);

describe('applyGlobalPlugins', () => {
  const body = (() => {
    const at = code.indexOf('private async applyGlobalPlugins');
    expect(at, 'applyGlobalPlugins is gone — re-point this test').toBeGreaterThan(0);
    return code.slice(at, code.indexOf('\n  }', at));
  })();

  it('reads both sources', () => {
    expect(body).toContain('this.options.plugins?.builtIn');
    expect(body).toContain('this.options.kysera?.plugins');
  });

  it('does not return between them', () => {
    // The bug was an early `return` after the builtIn branch. Only one return
    // may remain: the "nothing configured at all" guard.
    const returns = [...body.matchAll(/\breturn\b/g)];
    expect(returns.length, 'a second return is how the two became alternatives').toBe(1);

    const guard = body.indexOf('if (plugins.length === 0) return;');
    expect(guard, 'the only return must be the empty guard').toBeGreaterThan(0);
  });

  it('applies one merged list', () => {
    const setAt = body.indexOf('setConnectionPlugins');
    expect(setAt).toBeGreaterThan(0);
    // A single application site, fed by the merged array.
    expect([...body.matchAll(/setConnectionPlugins/g)].length).toBe(1);
    expect(body).toMatch(/plugins\.push\(\.\.\.legacyPlugins\)/);
    expect(body).toMatch(/plugins\.push\(\.\.\.\(await this\.resolvePlugins\(pluginSpecs\)\)\)/);
  });
});
