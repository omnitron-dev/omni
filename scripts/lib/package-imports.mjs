/** Shared dependency analysis for workspace sources and packed Node/TypeScript modules. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { join, sep } from 'node:path';

/** Internal dependencies are published from this release, never a previous minor. */
export function workspaceReferenceFindings(pkg, workspaceNames) {
  const findings = [];
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const [name, specifier] of Object.entries(pkg[section] ?? {})) {
      if (workspaceNames.has(name) && specifier !== 'workspace:*') {
        findings.push(`${section}.${name}: ${JSON.stringify(specifier)} must be workspace:*`);
      }
    }
  }
  return findings;
}

/** No nested registry copy or workspace link may substitute for a qualified SDK archive. */
export function assertConsumerArchives(directory, archives) {
  const root = realpathSync(directory);
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (name.startsWith('@omnitron-dev/'))
      assert.ok(lock.packages?.['node_modules/' + name], `Missing required SDK archive in consumer: ${name}`);
  }
  let checked = 0;
  for (const [location, installed] of Object.entries(lock.packages ?? {})) {
    const name = location.split('node_modules/').at(-1);
    if (!name.startsWith('@omnitron-dev/')) continue;
    const archive = archives.get(name);
    assert.ok(archive, `Unqualified SDK package in consumer: ${name}`);
    const integrity = 'sha512-' + createHash('sha512').update(readFileSync(archive.filename)).digest('base64');
    assert.equal(installed.integrity, integrity, `Consumer did not install the qualified archive: ${location}`);
    assert.equal(installed.version, archive.manifest.version, `Consumer archive version differs: ${location}`);
    assert.equal(installed.link, undefined, `Consumer SDK package is linked: ${location}`);
    assert.ok(installed.resolved?.startsWith('file:'), `Consumer SDK package came from a registry: ${location}`);
    assert.ok(realpathSync(join(root, location)).startsWith(join(root, 'node_modules') + sep), `Consumer SDK package escaped: ${location}`);
    checked++;
  }
  assert.ok(checked > 0, 'No qualified SDK archives were installed');
  return checked;
}

// TypeScript 6, resolved from tools/lint — the same mechanism eslint.config.cjs
// uses and for the same reason: the root is on TypeScript 7, whose package
// exports only `version` and `versionMajorMinor`. The parser API lives in the
// TS 6 copy that workspace package declares. Resolving the bare specifier from
// there says what is meant: "whatever typescript that package sees".
const lintRequire = createRequire(new URL('../../tools/lint/package.json', import.meta.url));
export const ts = lintRequire('typescript');
if (typeof ts.createSourceFile !== 'function') {
  console.error(
    `typescript resolved from tools/lint has no parser API (version ${ts.version}). ` +
      'Run `pnpm install` — this scan reads imports with the compiler, not with a regex.',
  );
  process.exit(2);
}
const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * Anything with a URI scheme is not an npm package: `https://deno.land/...` in
 * the Deno adapter, `bun:test` in the Bun one, `node:fs`, `npm:`, `jsr:`.
 * The first pass of this scan reported `https:` and `bun:test` as undeclared
 * dependencies of @omnitron-dev/testing.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The package a specifier belongs to, or null if it is not a bare one. */
export function packageOf(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return null;
  if (SCHEME.test(spec)) return null;
  if (BUILTIN.has(spec) || BUILTIN.has(spec.split('/')[0])) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
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
export function specifiersOf(file) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const add = (node, spec, typeOnly) => {
    if (typeof spec !== 'string') return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ spec, typeOnly, line: line + 1 });
  };
  for (const ref of sf.typeReferenceDirectives) {
    found.push({ spec: ref.fileName, typeOnly: true, line: sf.getLineAndCharacterOfPosition(ref.pos).line + 1 });
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const typeOnly = node.importClause?.isTypeOnly === true;
      add(node, node.moduleSpecifier?.text, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, node.moduleSpecifier.text, node.isTypeOnly === true);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression?.text, false);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal.text, true);
    } else if (ts.isArrayLiteralExpression(node)) {
      // Pairwise: a loader flag followed by the package it loads.
      for (let i = 0; i + 1 < node.elements.length; i++) {
        const flag = node.elements[i];
        const value = node.elements[i + 1];
        if (!ts.isStringLiteralLike(flag) || !LOADER_FLAGS.has(flag.text)) continue;
        // A flag followed by another flag names no package: `-r` is also
        // «recursive» to git and pnpm — `['ls-tree', '-r', '--name-only']`,
        // `['branch', '-r', '--contains']`, `['-r', '--filter', …]` were read
        // as three packages called `--name-only`, `--contains` and `--filter`
        // (2026-09-25). Node itself reads a `-`-led argument as a flag too.
        if (ts.isStringLiteralLike(value) && !value.text.startsWith('-')) add(value, value.text, false);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = (ts.isIdentifier(callee) && ['require', '__require'].includes(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'require' && callee.name.text === 'resolve');
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

// This is the bundler's exact package-name setting, never a wildcard exemption.
// The archive check requires every one of these build inputs to disappear.
export function inlinedDevDependencies(pkg) {
  const noExternal = pkg.tsup?.noExternal;
  return new Set((Array.isArray(noExternal) ? noExternal : []).filter(name =>
    typeof name === 'string' && Object.hasOwn(pkg.devDependencies ?? {}, name) &&
    ![pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some(deps => Object.hasOwn(deps ?? {}, name))));
}

/** Find an import which would require an inlined build input on the user's machine. */
export function retainedBuildImports(directory, files, inlined) {
  const findings = [];
  for (const file of files) {
    if (!/\.(?:[cm]?jsx?|d\.[cm]?ts)$/.test(file)) continue;
    for (const { spec, line } of specifiersOf(join(directory, file))) {
      if (inlined.has(packageOf(spec))) findings.push(`${file}:${line} imports ${spec}`);
    }
  }
  return findings;
}
