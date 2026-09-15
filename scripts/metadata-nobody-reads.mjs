#!/usr/bin/env node
/**
 * A decorator that records something nothing ever looks up.
 *
 * `Reflect.defineMetadata(key, …)` succeeds whatever the key is, so a
 * decorator that writes to the wrong one is silent in every direction: the
 * annotation is there in the source, the metadata is there at runtime, and
 * the feature simply never happens. Found by hand in titan-pm on 2026-09-12 —
 * `@OnShutdown` wrote `'on-shutdown'` on the prototype while the worker
 * runtime scanned each METHOD for an `onShutdown` field, so a decorated
 * cleanup handler was never called and the process exited 0.
 *
 * Same family as a permission nothing checks and a config knob nothing reads.
 *
 * WHAT IT REPORTS: every metadata key written with `defineMetadata` for which
 * no `getMetadata`/`getOwnMetadata`/`hasMetadata` anywhere names the same key.
 *
 * A hit is a QUESTION, not a verdict: a key may be read by an application
 * outside this repo, or by a string built at runtime. Read the writer and ask
 * who was supposed to consume it.
 *
 * Test files are excluded from BOTH sides. A test that reads a key does not
 * make the feature work — `decorators.spec.ts` read `'on-shutdown'` and
 * asserted its contents for months while nothing in the product did, and
 * counting that as a reader is what this scan's own first run got wrong.
 *
 * TRIAGE (2026-09-12, first run): the class's one real defect had already been
 * found by hand that morning (`@OnShutdown`, fixed in 4e1cac6); this scan was
 * written to make sure there was not a second. Everything else it reported was
 * the scan, three times over, and each fix is pinned by the self-check:
 *
 *   - a TEST that reads a key does not make a feature work. `decorators.spec.ts`
 *     read `'on-shutdown'` and asserted its contents for months while nothing in
 *     the product did. Test files are now excluded from both sides.
 *   - an IDENTIFIER is only a local label. `Symbol.for('event:batch')` bound to
 *     `BATCH_HANDLER_METADATA` in one function and to another name elsewhere is
 *     ONE key — that is the whole reason this codebase uses `Symbol.for` across
 *     package boundaries. Identifiers now resolve through their `Symbol.for`.
 *   - a key is often written under a DOTTED name: the container writes
 *     `'titan:inject:container'` as a literal and `@Lazy` reads it as
 *     `DECORATOR_METADATA.CONTAINER`. Constant maps are now resolved too.
 *
 * That took the "written alone" list from 18 to 4, and the four are answered:
 *
 *   - `METHOD_RATE_LIMIT_METADATA_KEY` — deliberate. `@RateLimit` enforces by
 *     wrapping the descriptor; the key exists so introspection can SEE a
 *     declared limit. Its own comment says so.
 *   - `Symbol.for(event:batch)` — `@BatchEvents` records `maxSize`/`maxWait`
 *     and nothing batches. Now documented as declarative-only at the decorator
 *     and in the package's index, alongside `@Public({ transports })`, which
 *     carries the same kind of note.
 *   - `'logger'` — written, in the source, "to set metadata that tests expect".
 *     The decorator's real work is its returned metadata and its hooks.
 *   - `'health-check'` — kept deliberately. `@HealthCheck` used to write ONLY
 *     this key, on the prototype, while the worker runtime looked for a
 *     `healthCheck` field per method; the two never met and every worker
 *     answered healthy. The decorator now writes the field the runtime reads
 *     and keeps this key beside it, because it is part of the shape an
 *     existing reader may rely on. Its own comment says so.
 *
 * It read 3 until the shared comment stripper landed: the old per-scanner
 * regex collapsed each block comment to one space, shrinking this file by 7 154
 * bytes and pulling a write 55 lines and one decorator away into the
 * ±1200-character window below. The bucket a key lands in is a proximity
 * heuristic, and a heuristic measured on stripped text moves when the
 * stripping does — which is why the stripper preserves line structure.
 *
 * The 28 in the second list are notes written beside a key something does read
 * — `@Repository` writes its table name next to the key the framework consumes.
 * Read the writer before acting on any of them.
 *
 * Usage: node scripts/metadata-nobody-reads.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ROOTS = [join(REPO, 'apps'), join(REPO, 'packages')];

const walk = (d, out = []) => {
  if (!existsSync(d)) return out;
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) {
      if (!/^(node_modules|dist|\.turbo|\.omnitron-build)$/.test(e)) walk(p, out);
    } else if (e.endsWith('.ts') && !/\.(d|spec|test)\.ts$/.test(e)) out.push(p);
  }
  return out;
};

/**
 * Comments removed by a walker, not a pair of regexes.
 *
 * This file carried its own copy of the regex form, as six other scanners
 * did. A regex cannot tell a comment from the same characters inside a
 * string, and it deletes everything between them: measured across
 * `apps/omnitron/src`, 6 502 bytes of real code in 6 of 234 files, 5 238 of
 * them in one whose template literals hold build commands. A scanner reading
 * that output sees source with holes in it and reports what it cannot see as
 * absent — and nothing goes red, because a clean scan is what everyone hopes
 * for.
 */
const strip = (s) => stripComments(s);

const files = ROOTS.flatMap((r) => walk(r));
const sources = new Map(files.map((f) => [f, strip(readFileSync(f, 'utf8'))]));

/** First argument of a Reflect.* metadata call: a string literal or an identifier. */
const WRITE = /Reflect\.defineMetadata\(\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))/g;
const READ = /Reflect\.(?:getMetadata|getOwnMetadata|hasMetadata|hasOwnMetadata)\(\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?))/g;

/**
 * Canonical name for a metadata key.
 *
 * An identifier is only a local label. `const BATCH_HANDLER_METADATA =
 * Symbol.for('event:batch')` in one function and `const BATCH =
 * Symbol.for('event:batch')` in another are THE SAME KEY — `Symbol.for` is
 * realm-wide, which is the whole reason this codebase uses it across package
 * boundaries. Matching on the identifier made them look like two keys, one of
 * them unread; that was this scan's own first false positive.
 */
const symbolOf = new Map();
for (const src of sources.values()) {
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*Symbol\.for\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) symbolOf.set(m[1], `Symbol.for(${m[2]})`);
}

/**
 * Constant MAPS are the other way a key hides.
 *
 * `DECORATOR_METADATA.CONTAINER` and the string `'titan:inject:container'` are
 * one key, and `@Lazy` reads it under the dotted name while the container
 * writes it as a literal. Capturing only the leading identifier made the two
 * look unrelated — the second false positive this scan produced about itself.
 */
for (const src of sources.values()) {
  const map = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = map.exec(src))) {
    const [, mapName, body] = m;
    const entry = /([A-Za-z_$][\w$]*)\s*:\s*(?:['"]([^'"]+)['"]|Symbol\.for\(\s*['"]([^'"]+)['"]\s*\))/g;
    let e;
    while ((e = entry.exec(body))) {
      symbolOf.set(`${mapName}.${e[1]}`, e[2] !== undefined ? e[2] : `Symbol.for(${e[3]})`);
    }
  }
}

const canonical = (key) => symbolOf.get(key) ?? key;

const collect = (re) => {
  const found = new Map(); // key -> Set of files
  for (const [file, src] of sources) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const key = canonical(m[1] ?? m[2] ?? m[3]);
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(file);
    }
  }
  return found;
};

const written = collect(WRITE);
const read = collect(READ);

// --- self-check -----------------------------------------------------------
// Both directions, against keys known to exist in this repo.
{
  const fail = [];
  const pmk = 'Symbol.for(process:method:metadata)';
  if (!written.has(pmk)) fail.push('cannot see an identifier-keyed write resolved through Symbol.for');
  if (!read.has(pmk)) fail.push('cannot see an identifier-keyed read resolved through Symbol.for');
  if (symbolOf.get('PROCESS_METHOD_METADATA_KEY') !== pmk) fail.push('Symbol.for resolution is not working');
  if (symbolOf.get('DECORATOR_METADATA.CONTAINER') !== 'titan:inject:container') {
    fail.push('constant-map resolution is not working');
  }
  if (!read.has('titan:inject:container')) {
    fail.push("`@Lazy` reads the container key under a dotted name and the scan cannot see it");
  }
  if (!written.has('on-shutdown')) fail.push('cannot see a string-literal write');
  if (!read.has('health-check') && !written.has('health-check')) {
    fail.push("cannot see titan-pm's 'health-check' key at all");
  }
  if (fail.length) {
    console.error('SELF-CHECK FAILED: ' + fail.join('; '));
    process.exit(2);
  }
}

const orphans = [...written.entries()].filter(([key]) => !read.has(key)).sort();

/**
 * Is this key written in the same statement group as one that IS read?
 *
 * A decorator usually writes a primary key the framework consumes and, next to
 * it, a couple of informational ones — `@Repository` writes
 * METADATA_KEYS.REPOSITORY (read) plus `'database:table-name'` and
 * `'database:is-repository'` (not). Those are notes, not gates, and listing
 * them beside a real finding is how a scan becomes a list nobody walks.
 *
 * The test is deliberately coarse: within 1200 characters of this write, in the
 * same file, is there a write of a key something reads? (400 was too narrow —
 * `@OnEvent` writes its four notes and then the live `EVENT_HANDLER_METADATA`
 * about twenty lines further down, in the same decorator.)
 */
function writtenBesideALiveKey(key, files) {
  // A canonical `Symbol.for(x)` name never appears in the source; search for
  // any identifier that resolves to it, plus the literal itself.
  const aliases = [key, ...[...symbolOf.entries()].filter(([, v]) => v === key).map(([k]) => k)];
  const alt = aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  for (const file of files) {
    const src = sources.get(file) ?? '';
    const re = new RegExp(`Reflect\\.defineMetadata\\(\\s*(?:'(?:${alt})'|"(?:${alt})"|(?:${alt}))`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const around = src.slice(Math.max(0, m.index - 1200), m.index + 1200);
      for (const other of read.keys()) {
        if (other === key) continue;
        const otherAliases = [other, ...[...symbolOf.entries()].filter(([, v]) => v === other).map(([k]) => k)];
        const oalt = otherAliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        if (new RegExp(`defineMetadata\\(\\s*(?:'(?:${oalt})'|"(?:${oalt})"|(?:${oalt}))`).test(around)) return true;
      }
    }
  }
  return false;
}

const alone = [];
const beside = [];
for (const [key, where] of orphans) (writtenBesideALiveKey(key, where) ? beside : alone).push([key, where]);

console.log(`${written.size} metadata keys written, ${read.size} read, ${orphans.length} written and never read`);
console.log(`  ${alone.length} written ALONE — the shape that hides an inert decorator`);
console.log(`  ${beside.length} written beside a key something does read — informational, read the writer before acting\n`);

console.log('=== WRITTEN ALONE ===');
for (const [key, where] of alone) {
  console.log(`  ${key}`);
  for (const f of [...where].sort()) console.log(`      ${f.slice(REPO.length + 1)}`);
}
if (alone.length === 0) console.log('  (none)');

console.log('\n=== WRITTEN BESIDE A LIVE KEY ===');
for (const [key] of beside) console.log(`  ${key}`);
if (beside.length === 0) console.log('  (none)');
console.log('\nself-check OK: sees both literal and identifier keys, in both directions');
