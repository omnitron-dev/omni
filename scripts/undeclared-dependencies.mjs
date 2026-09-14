#!/usr/bin/env node
/**
 * Every bare import in a package's `src` must be a dependency that package
 * declares.
 *
 * Inside a pnpm workspace an undeclared import still resolves: the root
 * `node_modules` is on the lookup path, so builds pass, tests pass, and the
 * app runs. The declaration only starts mattering once the package is
 * installed on its own — at which point the import fails at module load and
 * the process never starts. That gap is invisible from inside the repo, which
 * is why it survives.
 *
 * Found by omni-2b in `@omnitron-dev/omnitron`: `system-info.service.ts`
 * imported `systeminformation`, which only the ROOT package.json declared. A
 * node installed from the registry could not boot the daemon, and had not been
 * able to since May.
 *
 * WHAT COUNTS
 *   - runtime import → must be in dependencies / peerDependencies /
 *     optionalDependencies. A devDependency is reported: it is not installed
 *     for consumers.
 *   - `import type` / `export type` → erased at runtime, but a published
 *     .d.ts that names the type still needs it at the consumer's typecheck.
 *     Reported separately, as a weaker finding.
 *   - node: builtins, relative paths, `#imports`, and self-references are
 *     skipped.
 *
 * PARSING
 * The specifiers are read with the TypeScript parser, not with a regex. A
 * hand-rolled scanner over this same question produced 55 "packages" including
 * `follower`, from `type ElectionState = 'follower' | …`. A scan's findings are
 * usually the scan.
 *
 * Usage:
 *   node scripts/undeclared-dependencies.mjs            # packages/* and apps/*
 *   node scripts/undeclared-dependencies.mjs packages/titan
 *
 * Exit code 1 if any runtime import is undeclared.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

// TypeScript 6, resolved from tools/lint — the same mechanism eslint.config.cjs
// uses and for the same reason: the root is on TypeScript 7, whose package
// exports only `version` and `versionMajorMinor`. The parser API lives in the
// TS 6 copy that workspace package declares. Resolving the bare specifier from
// there says what is meant: "whatever typescript that package sees".
const lintRequire = createRequire(join(ROOT, 'tools/lint/package.json'));
const ts = lintRequire('typescript');
if (typeof ts.createSourceFile !== 'function') {
  console.error(
    `typescript resolved from tools/lint has no parser API (version ${ts.version}). ` +
      'Run `pnpm install` — this scan reads imports with the compiler, not with a regex.',
  );
  process.exit(2);
}
const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);
/** Not shipped: these never run on a consumer's machine. */
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.turbo', '.omnitron-build', 'coverage', '__tests__', 'test', 'tests', 'fixtures', '__mocks__']);
const SKIP_FILE = /\.(test|spec|bench|d)\.[cm]?tsx?$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(join(dir, e.name), out);
    } else if (e.isFile()) {
      const dot = e.name.lastIndexOf('.');
      if (dot < 0) continue;
      if (!SOURCE_EXT.has(e.name.slice(dot))) continue;
      if (SKIP_FILE.test(e.name)) continue;
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/**
 * Anything with a URI scheme is not an npm package: `https://deno.land/...` in
 * the Deno adapter, `bun:test` in the Bun one, `node:fs`, `npm:`, `jsr:`.
 * The first pass of this scan reported `https:` and `bun:test` as undeclared
 * dependencies of @omnitron-dev/testing.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The package a specifier belongs to, or null if it is not a bare one. */
function packageOf(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return null;
  if (SCHEME.test(spec)) return null;
  if (BUILTIN.has(spec) || BUILTIN.has(spec.split('/')[0])) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * tsconfig `paths` aliases, which look exactly like package names and are not.
 * `packages/titan` maps `@nexus/*` onto `./src/nexus/*`, so `@nexus/container.js`
 * is an internal file — the first pass of this scan called it an undeclared
 * dependency. Follows `extends` because the alias may be declared in a base.
 */
function pathAliases(dir, seen = new Set()) {
  const patterns = [];
  const file = join(dir, 'tsconfig.json');
  if (!existsSync(file) || seen.has(file)) return patterns;
  seen.add(file);
  let cfg;
  try {
    // tsconfig allows comments and trailing commas; parse with the compiler.
    const parsed = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
    cfg = parsed.config;
  } catch {
    return patterns;
  }
  if (!cfg) return patterns;
  for (const key of Object.keys(cfg.compilerOptions?.paths ?? {})) patterns.push(key);
  const ext = cfg.extends;
  for (const e of Array.isArray(ext) ? ext : ext ? [ext] : []) {
    if (typeof e !== 'string' || !e.startsWith('.')) continue;
    patterns.push(...pathAliases(dirname(resolve(dir, e)), seen));
  }
  return patterns;
}

function matchesAlias(spec, patterns) {
  for (const p of patterns) {
    if (p.endsWith('/*')) {
      if (spec.startsWith(p.slice(0, -1))) return true;
    } else if (p === '*' || spec === p) return true;
  }
  return false;
}

/**
 * Specifiers imported by one file, each marked type-only or not.
 * Covers: import/export … from, bare `import 'x'`, dynamic `import('x')`,
 * and `require('x')`.
 */
function specifiersOf(file) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const add = (node, spec, typeOnly) => {
    if (typeof spec !== 'string') return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ spec, typeOnly, line: line + 1 });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const typeOnly = node.importClause?.isTypeOnly === true;
      add(node, node.moduleSpecifier?.text, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, node.moduleSpecifier.text, node.isTypeOnly === true);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression?.text, false);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if ((isImport || isRequire) && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (ts.isStringLiteralLike(arg)) add(node, arg.text, false);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function packageDirs(argv) {
  if (argv.length) return argv.map((a) => resolve(ROOT, a));
  const dirs = [];
  for (const group of ['packages', 'apps']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

let runtimeFindings = 0;
let typeFindings = 0;
let scanned = 0;
let filesScanned = 0;

for (const dir of packageDirs(process.argv.slice(2))) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
  const srcDir = existsSync(join(dir, 'src')) ? join(dir, 'src') : dir;
  const aliases = pathAliases(dir);

  /** name → { runtime: Set<site>, type: Set<site>, onlyDev: boolean } */
  const missing = new Map();
  const files = walk(srcDir);
  filesScanned += files.length;
  for (const file of files) {
    for (const { spec, typeOnly, line } of specifiersOf(file)) {
      const name = packageOf(spec);
      if (!name || name === pkg.name) continue;
      if (declared.has(name)) continue;
      if (matchesAlias(spec, aliases)) continue;
      const entry = missing.get(name) ?? { runtime: new Set(), type: new Set(), onlyDev: dev.has(name) };
      const site = `${relative(ROOT, file)}:${line}`;
      (typeOnly ? entry.type : entry.runtime).add(site);
      missing.set(name, entry);
    }
  }
  scanned++;
  if (missing.size === 0) continue;

  const rows = [...missing.entries()].sort((a, b) => b[1].runtime.size - a[1].runtime.size);
  const runtimeRows = rows.filter(([, e]) => e.runtime.size > 0);
  const typeRows = rows.filter(([, e]) => e.runtime.size === 0);
  console.log(`\n${pkg.name}  (${relative(ROOT, dir)})`);
  for (const [name, e] of runtimeRows) {
    runtimeFindings++;
    const where = e.onlyDev ? 'devDependencies only' : 'not declared anywhere';
    const sites = [...e.runtime].slice(0, 3).join(', ');
    const more = e.runtime.size > 3 ? ` (+${e.runtime.size - 3} more)` : '';
    console.log(`  RUNTIME  ${name.padEnd(34)} ${where}`);
    console.log(`           ${sites}${more}`);
  }
  for (const [name, e] of typeRows) {
    typeFindings++;
    const where = e.onlyDev ? 'devDependencies only' : 'not declared anywhere';
    const sites = [...e.type].slice(0, 2).join(', ');
    console.log(`  type     ${name.padEnd(34)} ${where}`);
    console.log(`           ${sites}`);
  }
}

console.log(
  `\nscanned ${scanned} packages, ${filesScanned} source files — ` +
    `${runtimeFindings} runtime, ${typeFindings} type-only`,
);
process.exit(runtimeFindings > 0 ? 1 : 0);
