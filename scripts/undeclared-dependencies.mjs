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
 * THE OTHER DIRECTION (--unused)
 * A declared dependency that nothing imports is not merely clutter. It is
 * installed on every consumer's machine, its install scripts run, and its
 * maintainers are trusted — an unused dependency is supply-chain surface
 * bought for nothing. Reported separately because the two findings have
 * opposite urgency: an undeclared import is a bug, an unused declaration is a
 * cost.
 *
 * `--unused` is advisory and never sets the exit code, because a package can
 * legitimately depend on something its `src` does not name: a CLI invoked
 * through package.json scripts, a type-only `@types/*` package, a plugin
 * loaded by a config file, a peer a consumer needs in scope. Those are called
 * out by name where recognisable; the rest need a human to look.
 *
 * Usage:
 *   node scripts/undeclared-dependencies.mjs            # packages/* and apps/*
 *   node scripts/undeclared-dependencies.mjs packages/titan
 *   node scripts/undeclared-dependencies.mjs --unused   # the reverse question
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
 * Node flags that name a package to load, as a separate string argument:
 *
 *     execArgv: ['--import', 'tsx/esm']
 *     [process.execPath, '--import', 'tsx/esm', entry]
 *
 * No parser can see these as imports, because they are not imports — the
 * package name is data, resolved by Node in a CHILD process from that child's
 * working directory. omni-2b found the case: `apps/omnitron` builds its
 * systemd/launchd ExecStart this way, and `tsx` was declared only as a
 * devDependency, so a node installed from the registry got a service that
 * could not start. A scan that reads only import specifiers is blind here by
 * construction, which is exactly why the class is worth naming.
 *
 * A flag assembled from a variable is still missed; nothing in this tree does
 * that, and the check says so rather than implying it covers the flag form
 * completely.
 */
const LOADER_FLAGS = new Set(['--import', '--loader', '--experimental-loader', '--require', '-r']);

/**
 * Specifiers imported by one file, each marked type-only or not.
 * Covers: import/export … from, bare `import 'x'`, dynamic `import('x')`,
 * `require('x')`, and a package named after a loader flag.
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
    } else if (ts.isArrayLiteralExpression(node)) {
      // Pairwise: a loader flag followed by the package it loads.
      for (let i = 0; i + 1 < node.elements.length; i++) {
        const flag = node.elements[i];
        const value = node.elements[i + 1];
        if (!ts.isStringLiteralLike(flag) || !LOADER_FLAGS.has(flag.text)) continue;
        if (ts.isStringLiteralLike(value)) add(value, value.text, false);
      }
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
  const dirsArg = argv.filter((a) => !a.startsWith('--'));
  if (dirsArg.length) return dirsArg.map((a) => resolve(ROOT, a));
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

const argv = process.argv.slice(2);
const WANT_UNUSED = argv.includes('--unused');

/**
 * Peers demanded by a package's own declared dependencies.
 *
 * A dependency nothing imports is very often one that something else in the
 * tree REQUIRES you to install: `@mui/material` peer-depends on
 * `@emotion/styled`, `zustand` on `immer`, `@tiptap/react` on `@tiptap/pm`.
 * Dropping those breaks the install, so a report that lists them is worse than
 * no report — it argues for a change that cannot be made.
 *
 * Read from the installed tree, resolved from the package itself, so this
 * answers what the versions actually in use demand rather than what a registry
 * says today.
 */
/**
 * A dependency's package.json, however it has to be found.
 *
 * `require.resolve('<dep>/package.json')` is the direct route and fails for any
 * package whose `exports` map does not list `./package.json` — modern tiptap,
 * among others. That failure was silent here and cost a false finding:
 * `@tiptap/pm` was reported unused when it is a required peer of
 * `@tiptap/react`, which prism declares. So fall back to resolving the entry
 * point and walking up to the directory that owns it.
 */
function manifestOf(req, dep) {
  try {
    return JSON.parse(readFileSync(req.resolve(`${dep}/package.json`), 'utf8'));
  } catch {
    /* fall through */
  }
  let cur;
  try {
    cur = dirname(req.resolve(dep));
  } catch {
    return null; // genuinely not installed
  }
  for (let depth = 0; depth < 12; depth++) {
    const candidate = join(cur, 'package.json');
    if (existsSync(candidate)) {
      try {
        const j = JSON.parse(readFileSync(candidate, 'utf8'));
        if (j.name === dep) return j;
      } catch {
        /* keep walking */
      }
    }
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

function peersDemandedBy(dir, pkg) {
  const demanded = new Map();
  let req;
  try {
    req = createRequire(join(dir, 'package.json'));
  } catch {
    return demanded;
  }
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    const manifest = manifestOf(req, dep);
    if (!manifest) continue;
    // Optional peers count too, and are labelled as such. `@mui/material`
    // marks `@emotion/styled` optional because styled-components is the
    // alternative, and `zustand` marks `immer` optional because the middleware
    // is opt-in — but a package that DECLARED one has chosen to satisfy it,
    // and dropping it changes behaviour rather than trimming waste. Skipping
    // optional peers hid exactly those three.
    const optional = manifest.peerDependenciesMeta ?? {};
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      const entry = demanded.get(peer) ?? { by: [], optional: true };
      entry.by.push(dep);
      if (!optional[peer]?.optional) entry.optional = false;
      demanded.set(peer, entry);
    }
  }
  return demanded;
}

/**
 * Declared-but-unimported names that are expected and need no explanation.
 * Everything else is printed for a human, which is the point: this list is
 * short on purpose, so the report stays a question rather than a verdict.
 */
/**
 * Packages that exist to supply a GLOBAL, which source code then uses without
 * naming the package. `buffer` is the browser polyfill a bundler aliases in
 * wherever code touches `Buffer`; `process` likewise. Declaring one without
 * importing it is the correct way to use it, so the question is whether the
 * global appears at all.
 */
const GLOBAL_SHIMS = { buffer: /\bBuffer\b/, process: /\bprocess\./ };

function explainUnused(name, pkg, peers, sourceText) {
  if (name.startsWith('@types/')) return 'types, consumed by tsc not by an import';
  const shim = GLOBAL_SHIMS[name];
  if (shim && shim.test(sourceText)) return `polyfills a global the source uses (${name === 'buffer' ? 'Buffer' : name})`;
  // Not reached for a loader-flag package: those now count as imported.

  const peer = peers.get(name);
  if (peer) {
    const how = peer.optional ? 'an optional peer of' : 'required as a peer by';
    return `${how} ${peer.by.slice(0, 3).join(', ')}`;
  }
  const scripts = Object.values(pkg.scripts ?? {}).join(' ');
  // A word-boundary match, so `vite` does not claim `vitest`.
  if (new RegExp(`(^|[\\s"'/])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s"']|$)`).test(scripts)) {
    return 'invoked from a package.json script';
  }
  return null;
}

let runtimeFindings = 0;
let typeFindings = 0;
let unusedFindings = 0;
let scanned = 0;
let filesScanned = 0;
const unusedByPackage = [];

for (const dir of packageDirs(argv)) {
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
  /** Every package name this package's source actually names. */
  const imported = new Set();
  /** All source, concatenated — for questions about globals rather than imports. */
  const sourceChunks = [];
  const files = walk(srcDir);
  filesScanned += files.length;
  for (const file of files) {
    if (WANT_UNUSED) sourceChunks.push(readFileSync(file, 'utf8'));
    for (const { spec, typeOnly, line } of specifiersOf(file)) {
      const name = packageOf(spec);
      if (!name || name === pkg.name) continue;
      if (matchesAlias(spec, aliases)) continue;
      imported.add(name);
      if (declared.has(name)) continue;
      const entry = missing.get(name) ?? { runtime: new Set(), type: new Set(), onlyDev: dev.has(name) };
      const site = `${relative(ROOT, file)}:${line}`;
      (typeOnly ? entry.type : entry.runtime).add(site);
      missing.set(name, entry);
    }
  }
  scanned++;

  if (WANT_UNUSED) {
    // Runtime dependencies only. A peer is a request the CONSUMER must satisfy
    // and is frequently not imported here at all, and a devDependency is not
    // shipped, so neither is supply-chain surface for anyone downstream.
    const peers = peersDemandedBy(dir, pkg);
    const sourceText = sourceChunks.join('\n');
    const unused = Object.keys(pkg.dependencies ?? {})
      .filter((name) => !imported.has(name))
      .map((name) => ({ name, why: explainUnused(name, pkg, peers, sourceText) }));
    if (unused.length) unusedByPackage.push({ pkg: pkg.name, dir: relative(ROOT, dir), unused });
  }

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

if (WANT_UNUSED && unusedByPackage.length) {
  console.log('\n─── declared and never imported (advisory) ───');
  for (const { pkg, dir, unused } of unusedByPackage) {
    const open = unused.filter((u) => !u.why);
    const explained = unused.filter((u) => u.why);
    unusedFindings += open.length;
    console.log(`\n${pkg}  (${dir})`);
    for (const u of open) console.log(`  ?        ${u.name}`);
    for (const u of explained) console.log(`  ok       ${u.name.padEnd(34)} ${u.why}`);
  }
}

console.log(
  `\nscanned ${scanned} packages, ${filesScanned} source files — ` +
    `${runtimeFindings} runtime, ${typeFindings} type-only` +
    (WANT_UNUSED ? `, ${unusedFindings} declared-unused needing a look` : ''),
);
process.exit(runtimeFindings > 0 ? 1 : 0);
