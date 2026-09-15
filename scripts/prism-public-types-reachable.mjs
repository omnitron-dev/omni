#!/usr/bin/env node
/**
 * A type a public prop is declared with, that a consumer cannot name.
 *
 * A component library's contract is its props, and a prop is only usable if
 * its TYPE can be imported. Export `DateRangePicker` and
 * `DateRangePickerProps` but not `DateRangePickerTranslations`, and someone
 * supplying translations — on a platform that ships in two languages, the
 * point of the prop — has to inline the shape or reach for
 * `DateRangePickerProps['translations']`.
 *
 * Found 2026-09-12, after `UserMenu` turned out to be reachable from nowhere
 * at all (omni d6f3629). Four symbols were exported by an inner barrel and by
 * no published subpath; three were real and are fixed:
 *
 *   DateRangePickerTranslations   the type of `translations`
 *   DateRangeInputTranslations    the type of `pickerTranslations`
 *   TextTransformOptions          the options of a public TipTap Mark, so
 *                                 `TextTransform.configure({…})` could not be
 *                                 typed
 *
 * The fourth was not: `CarouselSlide` is published as `CarouselSlideType`,
 * renamed deliberately because a styled internal in `carousel.tsx` already
 * owns the plain name — `use-carousel.ts` explains it. Aliases are followed
 * here so that case stays quiet.
 *
 * 1299 symbols are reachable from the 15 published subpaths, so this is a
 * narrow check by design: it is looking for the one that slipped, not
 * auditing the surface.
 *
 * Usage: node scripts/prism-public-types-reachable.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PKG = join(ROOT, 'packages/prism');

const pkgJson = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
const subpaths = Object.keys(pkgJson.exports ?? {});

/** Names a module exports, following relative `export *` and honouring `as`. */
function namesFrom(file, depth = 0, seen = new Set()) {
  const out = new Set();
  if (seen.has(file) || depth > 5 || !existsSync(file)) return out;
  seen.add(file);
  const src = readFileSync(file, 'utf8');

  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) out.add(m[1]);

  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    const block = stripComments(m[1]);
    for (const part of block.split(',')) {
      const t = part.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const as = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(t);
      // Record BOTH sides of a rename: the local name is what an inner
      // barrel calls it, the alias is what a consumer imports.
      if (as) { out.add(as[1]); out.add(as[2]); } else out.add(t.split(/\s/)[0]);
    }
  }

  for (const m of src.matchAll(/export\s+(?:type\s+)?\*\s+(?:as\s+[A-Za-z_$][\w$]*\s+)?from\s+'([^']+)'/g)) {
    let p = m[1];
    if (!p.startsWith('.')) continue;
    p = join(dirname(file), p).replace(/\.js$/, '');
    for (const c of [`${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`]) {
      if (existsSync(c)) { for (const n of namesFrom(c, depth + 1, seen)) out.add(n); break; }
    }
  }
  out.delete('');
  return out;
}

/**
 * Resolve a published subpath to its SOURCE barrel through the package's own
 * exports map, not by guessing from the subpath name.
 *
 * Two shapes bite. The name and the directory need not match — titan
 * publishes './module/logger' from 'dist/modules/logger', and guessing
 * 'src/module/logger' finds nothing, which makes every symbol in that barrel
 * look unreachable. And an entry may be condition-keyed
 * (`{ import: { types, default }, require: {…} }`) rather than flat, which
 * netron-react uses; reading only `types`/`default` resolves it to nothing.
 * Both were met while generalising this check to the other packages, and both
 * produced confident-looking findings that were the resolver's fault.
 */
function pickDist(entry) {
  if (typeof entry === 'string') return entry;
  return entry?.types ?? entry?.default ?? pickDist(entry?.import) ?? pickDist(entry?.require) ?? '';
}

const reachable = new Set();
for (const sp of subpaths) {
  const srcRel = String(pickDist(pkgJson.exports[sp]))
    .replace(/^\.\//, '')
    .replace(/^dist\//, '')
    .replace(/\.(d\.ts|js|cjs|d\.cts)$/, '');
  const candidates = [
    `${PKG}/src/${srcRel}.ts`,
    `${PKG}/src/${srcRel}.tsx`,
    `${PKG}/src/${srcRel}/index.ts`,
    `${PKG}/src/${srcRel}/index.tsx`,
  ];
  for (const c of candidates) if (existsSync(c)) { for (const n of namesFrom(c)) reachable.add(n); break; }
}

function barrels(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (/^(__tests__|node_modules)$/.test(name)) continue;
      barrels(full, acc);
    } else if (/^index\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}

const orphans = new Map();
for (const b of barrels(join(PKG, 'src'))) {
  for (const n of namesFrom(b)) {
    if (reachable.has(n) || !/^[A-Z]/.test(n)) continue;
    const rel = b.slice(join(PKG, 'src').length + 1);
    if (!orphans.has(n)) orphans.set(n, []);
    orphans.get(n).push(rel);
  }
}

// --- self-check -----------------------------------------------------------
{
  const fail = [];
  if (subpaths.length < 10) fail.push(`only ${subpaths.length} subpaths — the exports map moved`);
  if (reachable.size < 900) fail.push(`only ${reachable.size} reachable — the barrel parse broke`);
  for (const must of ['UserMenu', 'DateRangePickerTranslations', 'TextTransformOptions', 'Carousel']) {
    if (!reachable.has(must)) fail.push(`${must} is unreachable again`);
  }
  if (!reachable.has('CarouselSlide')) fail.push('the `as` rename is no longer followed');
  // `pickDist` is asserted directly: prism's own exports map is flat, so
  // breaking the condition-keyed branch changes nothing here and an indirect
  // probe passes while it is broken. netron-react uses that shape.
  if (pickDist({ import: { types: './dist/cache/index.d.ts' } }) !== './dist/cache/index.d.ts') {
    fail.push('a condition-keyed exports entry is no longer resolved');
  }
  if (pickDist({ types: './dist/index.d.ts' }) !== './dist/index.d.ts') {
    fail.push('a flat exports entry is no longer resolved');
  }
  // Names that exist ONLY inside a standalone `export type { … }` block —
  // without them the earlier probe for that regression passed while the
  // parser was broken, because every other asserted name also appears in a
  // plain `export { … }`.
  for (const typeOnly of ['NavigationMenuType', 'LayoutProviderProps']) {
    if (!reachable.has(typeOnly)) fail.push(`${typeOnly}: an \`export type { … }\` block was not parsed`);
  }
  if (fail.length) { console.error('SELF-CHECK FAILED: ' + fail.join('; ')); process.exit(1); }
}

console.log(`${subpaths.length} published subpaths`);
console.log(`${reachable.size} symbols reachable from them`);
console.log(`${orphans.size} exported by an inner barrel and reachable from none\n`);
for (const [n, where] of [...orphans].sort()) console.log(`  ${n.padEnd(34)} ${where[0]}`);
if (orphans.size === 0) console.log('  (none)');
