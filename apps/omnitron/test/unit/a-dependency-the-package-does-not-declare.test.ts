/**
 * The published omnitron could not start: a dependency it imports was never
 * declared.
 *
 * `src/services/system-info.service.ts` imports `systeminformation`, and
 * `apps/omnitron/package.json` did not list it. Inside this workspace that is
 * invisible — the package resolves from the repository root's `node_modules`,
 * which declares it — so every local run, every test and every build works.
 *
 * Anywhere else it does not exist. Measured by installing the published
 * package on a remote host and starting it:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'systeminformation'
 *   imported from /opt/omnitron/runtime/lib/node_modules/@omnitron-dev/
 *   omnitron/dist/services/system-info.service.js
 *
 * That is the whole npm install channel: a node prepared from the registry
 * gets an omnitron that cannot boot. The version on npm has been in that
 * state since it was published.
 *
 * This checks the property rather than the one package: every bare import in
 * `src` resolves to something the package claims to depend on.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * What a consumer of this package will actually have.
 *
 * `devDependencies` are deliberately excluded, and that is the whole
 * distinction this file turns on: npm does not install them for a published
 * package. Everything under `src/` is shipped code, so a runtime import that
 * resolves only because of a devDependency resolves only here.
 *
 * Counting them was this test's own first weakness. With devDependencies in
 * the set, moving `tsx` back out of `dependencies` — the exact regression —
 * left it green, because the name was still somewhere in the file. A check
 * that accepts the defect it was written for is worth less than no check, so
 * it is measured the way the consumer experiences it.
 */
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  // A package may name itself: `init.ts` puts the package name inside the
  // config template it writes for a new project.
  pkg.name,
]);

const builtin = new Set(builtinModules);

/** Every .ts file under src. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * The package a line imports, or null.
 *
 * Line-based on purpose. A previous scanner in this repository shared a
 * comment-stripping helper that deleted code and reported 26 live keys as
 * dead; the lesson taken from it was to prefer a rule with visible limits
 * over a parser with invisible ones.
 *
 * The rule: a real import statement starts its line, and names its module
 * after `from` — or, for a side-effect import, as the whole statement. A line
 * inside a block comment starts with `*`, a line comment with `//`, and a
 * template literal's contents are indented under an assignment, so none of
 * them match; the prose mentions of `zod` and the config template that names
 * the package itself are excluded by construction rather than by stripping.
 *
 * The `from` is load-bearing, and leaving it out is how this check first
 * reported fifty-five findings: without it,
 * `export type ElectionState = 'follower' | …` reads as an import of a
 * package called `follower`. A scan's findings are usually the scan.
 *
 * What it misses: a dynamic `await import()` that is not at the start of its
 * line. Those are checked separately below.
 */
function importedPackage(line: string): string | null {
  const trimmed = line.trimStart();
  const viaFrom = /^(?:import|export)\b[^'"]*\bfrom\s*['"]([^'"]+)['"]/.exec(trimmed);
  const sideEffect = /^import\s*['"]([^'"]+)['"]/.exec(trimmed);
  const specifier = viaFrom?.[1] ?? sideEffect?.[1];
  return specifier ? packageOf(specifier) : null;
}

function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('node:') || specifier.startsWith('/')) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  return builtin.has(name) ? null : name;
}

describe('every package src imports is declared', () => {
  const files = sources(path.join(root, 'src'));

  it('finds the sources at all', () => {
    // A scan over nothing passes. Pinned so a moved directory reads as a
    // broken test rather than a clean bill of health.
    expect(files.length).toBeGreaterThan(50);
  });

  it('declares every statically imported package', () => {
    const undeclared = new Map<string, string>();
    for (const file of files) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const name = importedPackage(line);
        if (name && !declared.has(name)) {
          undeclared.set(name, path.relative(root, file));
        }
      }
    }

    expect(
      [...undeclared].map(([name, where]) => `${name} (${where})`),
      'imported but not in package.json — works in the workspace, fails everywhere else',
    ).toEqual([]);
  });

  it('declares every dynamically imported package too', () => {
    // `await import('systeminformation')` is the same dependency by another
    // spelling, and the daemon uses dynamic imports throughout to keep its
    // startup cheap.
    //
    // Line by line, skipping comment lines, for the same reason the static
    // check is line-anchored: scanning the whole file text found
    // `await import('@my-org/foo')` inside a docblock explaining why
    // workspace packages get bundled. The limit of this rule, stated rather
    // than hidden: a dynamic import written inside a template literal is not
    // seen. Nothing in this tree does that.
    const undeclared = new Map<string, string>();
    for (const file of files) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const code = line.trimStart();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) continue;
        for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
          const name = packageOf(m[1]!);
          if (name && !declared.has(name)) undeclared.set(name, path.relative(root, file));
        }
      }
    }

    expect([...undeclared].map(([name, where]) => `${name} (${where})`)).toEqual([]);
  });

  it('declares systeminformation, the one this file was written for', () => {
    expect(pkg.dependencies?.systeminformation, 'the published package could not boot without it').toBeTruthy();
  });
});

// =============================================================================
// A package can be a dependency without ever being imported
// =============================================================================

describe('packages handed to a child process are dependencies too', () => {
  /**
   * `--import tsx/esm` names a package, and no import scanner can see it.
   *
   * Two scanners looked at this tree today — a regexp over import lines and a
   * colleague's, which reads specifiers with the TypeScript parser. Both found
   * `esbuild`, correctly. Neither found `tsx`, correctly: it is never
   * imported. It appears as a string inside `execArgv`, resolved by Node in a
   * CHILD process, from that child's working directory.
   *
   * Which makes it the more dangerous of the two, because the thing that
   * would notice cannot look there. `service.ts` builds the launchd and
   * systemd units' ExecStart as
   * `[execPath, '--import', 'tsx/esm', daemonEntryPath()]`, and the docblock
   * beside it states the requirement and asserts it is met: "`--import
   * tsx/esm` resolves from here upward through node_modules, which the
   * package's install tree provides".
   *
   * It did not provide it. `tsx` was in devDependencies, which npm does not
   * install for a published package. Measured on a host with omnitron
   * installed from the registry:
   *
   *     esbuild              NOT FOUND ERR_MODULE_NOT_FOUND
   *     tsx                  NOT FOUND ERR_MODULE_NOT_FOUND
   *     systeminformation    NOT FOUND ERR_MODULE_NOT_FOUND
   *
   * So a node prepared from npm, registered with its OS supervisor, would
   * have had a service that cannot start — at install, and again at every
   * boot.
   */
  const RUNTIME_FLAG_PACKAGES = /--import['"\s,\]]+['"]([^'"]+)['"]/g;

  it('declares every package named in an --import flag', () => {
    const undeclared = new Map<string, string>();
    for (const file of sources(path.join(root, 'src'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(RUNTIME_FLAG_PACKAGES)) {
        const name = packageOf(m[1]!);
        if (name && !declared.has(name)) undeclared.set(name, path.relative(root, file));
      }
    }

    expect(
      [...undeclared].map(([name, where]) => `${name} (${where})`),
      'handed to a child process by name, and not a declared dependency',
    ).toEqual([]);
  });

  it('finds the flags it is looking for', () => {
    // The check above passes trivially against a tree with no such flags, and
    // this tree has several — so a refactor that changes the spelling makes
    // this fail rather than making the check silently vacuous.
    const found = sources(path.join(root, 'src'))
      .flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(RUNTIME_FLAG_PACKAGES)])
      .map((m) => m[1]!);

    expect(found.length).toBeGreaterThan(3);
    expect(found).toContain('tsx/esm');
  });

  it('ships the runtime halves of the TypeScript path, both of them', () => {
    // A `.ts` app goes: compile with esbuild, and on failure fall back to a
    // child spawned with `--import tsx/esm`. Both halves were devDependencies,
    // so on a published install the fallback had nothing to fall back to.
    expect(pkg.dependencies?.esbuild, 'the build path needs it at runtime').toBeTruthy();
    expect(pkg.dependencies?.tsx, 'the fallback path needs it at runtime').toBeTruthy();
  });
});
