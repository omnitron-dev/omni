#!/usr/bin/env node
/**
 * A symbol the documentation tells you to import, that the package does not
 * export.
 *
 * These are the first lines a newcomer copies. An import that does not resolve
 * is not a typo they work around — it is the framework failing at the first
 * step, before they have any way to tell a mistake of theirs from a mistake of
 * ours.
 *
 * Found 2026-09-12 across `internal/website/docs`, 750 imported symbols:
 *
 *   getting-started/quickstart.md   `Service` and `Public` from
 *                                   '@omnitron-dev/titan'. Both live in
 *                                   '@omnitron-dev/titan/decorators', which is
 *                                   what every downstream backend imports.
 *   tutorial/02-service.md          a TROUBLESHOOTING row: the fix offered for
 *                                   "Errors.notFound is not a function" was
 *                                   `import { Errors } from
 *                                   '@omnitron-dev/titan'` — the remedy
 *                                   reproduced the error. It is
 *                                   '@omnitron-dev/titan/errors'.
 *   frontend/prism/layouts.md       `UserMenu` from '@omnitron-dev/prism/layouts'.
 *                                   Not a doc bug: the component existed in
 *                                   `layouts/core` and was reachable from
 *                                   nowhere, because the layouts barrel names
 *                                   its re-exports one by one and never listed
 *                                   it, and './layouts/core' is not a published
 *                                   subpath. Fixed by exporting it.
 *
 * FOUR TIMES THE PARSER WAS THE PROBLEM, and each correction cut the list:
 * 29 hits on the first run, 13, then 3, then 0.
 *   - `export { … }` blocks carry line comments between the names; splitting
 *     on ',' without stripping them yields '//' and loses the real name.
 *   - `export type { … }` and `export type * from` were not matched at all,
 *     which hid every type-only re-export (OnInit, OnDestroy, DynamicModule,
 *     every I*-interface).
 *   - a barrel re-exporting a barrel needs following, to a depth.
 *   - a subpath import maps to `src/<sub>/index.ts`, `src/<sub>.ts` OR
 *     `src/exports/<sub>.ts` depending on the package.
 * Report a finding from this scan only after checking the symbol by hand.
 *
 * Usage: node scripts/doc-imports-resolve.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function mdFiles(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) mdFiles(full, acc);
    else if (/\.mdx?$/.test(name)) acc.push(full);
  }
  return acc;
}

function resolveSpecifier(spec) {
  const m = /^@omnitron-dev\/([a-z0-9-]+)(?:\/(.+))?$/.exec(spec);
  if (!m) return null;
  const [, pkg, sub] = m;
  for (const r of [join(ROOT, 'packages', pkg, 'src'), join(ROOT, 'apps', pkg, 'src')]) {
    if (!existsSync(r)) continue;
    const candidates = sub
      ? [`${r}/${sub}/index.ts`, `${r}/${sub}.ts`, `${r}/exports/${sub}.ts`, `${r}/${sub}/index.tsx`]
      : [`${r}/index.ts`, `${r}/index.tsx`];
    for (const c of candidates) if (existsSync(c)) return c;
  }
  return null;
}

const cache = new Map();
function exportsOf(file, depth = 0) {
  if (cache.has(file)) return cache.get(file);
  const names = new Set();
  cache.set(file, names);
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { return names; }

  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) names.add(m[1]);

  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    const block = m[1].replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const part of block.split(',')) {
      const t = part.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const as = /\s+as\s+([A-Za-z_$][\w$]*)/.exec(t);
      names.add(as ? as[1] : t.split(/\s/)[0]);
    }
  }

  if (depth < 4) {
    const dir = file.replace(/\/[^/]+$/, '');
    for (const m of src.matchAll(/export\s+(?:type\s+)?\*\s+(?:as\s+[A-Za-z_$][\w$]*\s+)?from\s+'([^']+)'/g)) {
      let p = m[1];
      if (p.startsWith('.')) {
        p = join(dir, p).replace(/\.js$/, '');
        for (const c of [`${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`]) {
          if (existsSync(c)) { for (const n of exportsOf(c, depth + 1)) names.add(n); break; }
        }
      } else {
        const r = resolveSpecifier(p);
        if (r) for (const n of exportsOf(r, depth + 1)) names.add(n);
      }
    }
  }
  names.delete('');
  return names;
}

const missing = new Map();
let checked = 0;
for (const file of mdFiles(join(ROOT, 'internal/website/docs'))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'(@omnitron-dev\/[^']+)'/.exec(line);
    if (!m) return;
    const target = resolveSpecifier(m[2]);
    if (!target) return;
    const exported = exportsOf(target);
    if (exported.size === 0) return;
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (!name || !/^[A-Za-z_$]/.test(name)) continue;
      checked++;
      if (exported.has(name)) continue;
      const key = `${m[2]} :: ${name}`;
      if (!missing.has(key)) missing.set(key, []);
      missing.get(key).push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
    }
  });
}

// --- self-check -----------------------------------------------------------
{
  const fail = [];
  const titan = resolveSpecifier('@omnitron-dev/titan');
  if (!titan) fail.push('the titan package did not resolve');
  else {
    const e = exportsOf(titan);
    if (!e.has('Application')) fail.push('a plain re-export was not seen');
    if (!e.has('OnInit')) fail.push("an `export type { … }` name was not seen");
    if (e.has('Public')) fail.push('Public was found on the titan root — it lives under /netron');
  }
  const dec = resolveSpecifier('@omnitron-dev/titan/decorators');
  if (!dec || !exportsOf(dec).has('Public')) fail.push('a subpath barrel did not resolve');
  const lay = resolveSpecifier('@omnitron-dev/prism/layouts');
  if (!lay || !exportsOf(lay).has('UserMenu')) fail.push('the prism layouts barrel lost UserMenu again');
  if (checked < 400) fail.push(`only ${checked} symbols checked — the docs or the parser moved`);
  if (fail.length) { console.error('SELF-CHECK FAILED: ' + fail.join('; ')); process.exit(1); }
}

console.log(`${checked} imported symbols checked`);
console.log(`${missing.size} not found in the package's exports\n`);
for (const [k, where] of [...missing].sort()) console.log(`  ${k}\n      ${where.slice(0, 3).join(', ')}`);
if (missing.size === 0) console.log('  (none)');
