#!/usr/bin/env node
/**
 * Methods that delete old state, and whether anything calls them.
 *
 * A janitor with no caller is not dead code: whatever it was meant to bound
 * grows without limit, while the method reads as finished so review passes
 * over it — and the docstring often asserts a schedule that does not exist.
 * The downstream copy found five of these across six backends, including a sweeper
 * that a service's own comment promised was running.
 *
 * Ported for omni, where the shape is different in two ways. There are no
 * repositories to filter on (the downstream project's copy looks only at `*.repository.ts`), so
 * this walks everything under `apps` and `packages`; and a caller here is
 * often a timer rather than another service, so a method registered with
 * `setInterval`, `addInterval`, `@Cron`, `@Interval` or `scheduler.` counts as
 * called even when nothing names it with a dot.
 *
 * TRIAGE (2026-09-12, first run): opened at 4, closed at 0. Two were the scan
 * and one was real:
 *
 *   - `cleanupStaleEntries` (netron http middleware) is a local arrow function
 *     called bare, without a dot — and worse, the scan had matched the CALL as
 *     a definition. Downstream's copy requires a literal `async ` before the name so
 *     it only ever matched definitions; dropping that (omni has synchronous
 *     and arrow-function janitors) needed a real discriminator, which is now
 *     what follows the parameter list: a definition continues into a body.
 *     That alone took the janitor count from 212 to 83 — most of the "extra"
 *     were call sites counted as definitions.
 *   - `trimming` (titan-redis) was the same thing: a property name.
 *   - `cleanupContainer` (packages/testing) is a helper for test authors,
 *     exported from a testing package. No caller in this repo is correct.
 *   - `cleanupProcess` (omnitron ServiceRouter) was REAL, and the fix was not
 *     to call it. See the commit: the router is per app launch and is torn
 *     down whole, and one child of a pool crashing does not mean the service
 *     is gone. It was replaced by `releaseAll()`, which both orchestrator
 *     paths now use — including the stale-duplicate branch that used to drop
 *     an errored handle with its registrations still live on the daemon.
 *
 * Usage: node scripts/uncalled-janitors.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ROOTS = [join(REPO, 'apps'), join(REPO, 'packages')];

const walk = (d, out = []) => {
  if (!existsSync(d)) return out;
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) {
      if (!/^(node_modules|dist|test|examples|\.turbo|\.omnitron-build)$/.test(e)) walk(p, out);
    } else if (e.endsWith('.ts') && !/\.(test|spec|d)\.ts$/.test(e)) out.push(p);
  }
  return out;
};

/** A name that says it removes state by age or expiry. */
const NAME = /\b(prune\w*|cleanup\w*|purge\w*|sweep\w*|delete(?:Expired|Old\w*|Stale\w*)\w*|reap\w*|evict\w*|trim\w*|remove(?:Idle|Stale|Expired|Old)\w*)\s*\(/g;

/**
 * Is the occurrence at `at` a DEFINITION rather than a call?
 *
 * the downstream project's copy requires a literal `async ` before the name, so it only ever
 * matched definitions. Dropping that — omni has plenty of synchronous and
 * arrow-function janitors — made the scan match call sites too, and then
 * report them as uncalled because the only other mention was the real
 * definition. The discriminator is what follows the parameter list: a
 * definition continues into a body (`{`, a return type, or `=>`), a call
 * does not.
 */
function isDefinition(src, at, name) {
  let i = src.indexOf('(', at + name.length - 1);
  if (i < 0) return false;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  const after = src.slice(i, i + 80).replace(/^\s+/, '');
  if (after.startsWith('=>') || after.startsWith('{')) return true;
  if (after.startsWith(':')) return /^:[^;=]{0,60}\{/.test(after);  // a return type, then a body
  return false;
}

const files = ROOTS.flatMap((r) => walk(r));
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

let found = 0;
const rows = [];
const seen = new Set();

for (const [file, src] of sources) {
  let m;
  NAME.lastIndex = 0;
  while ((m = NAME.exec(src))) {
    const name = m[1];
    if (!isDefinition(src, m.index, name)) continue;
    const key = `${file}::${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found++;

    const called = new RegExp(`[.\\s(\\[]${name}\\s*[(,\\)]|['"\`]${name}['"\`]`);
    // A caller is any OTHER file naming it, or a timer registration in THIS
    // file — `setInterval(() => this.sweep(), …)` is a caller.
    const elsewhere = [...sources.entries()].some(([f, s]) => f !== file && called.test(s));
    // A caller in the SAME file counts — `runJanitor` calling
    // `this.trimDeliveredEvents()` is exactly the shape this scan must not
    // report, and it is what the self-check below pins.
    // A caller in the SAME file counts, with or without a dot: a local arrow
    // function is called bare. Anything that is not itself a definition is a
    // call.
    let here = false;
    const local = new RegExp(`\\b${name}\\s*\\(`, 'g');
    let c;
    while ((c = local.exec(src))) {
      if (!isDefinition(src, c.index, name)) { here = true; break; }
    }
    const scheduledHere = new RegExp(
      `(setInterval|setTimeout|addInterval|addCron|schedule\\w*|@Cron|@Interval)[\\s\\S]{0,200}?\\b${name}\\s*\\(`,
    ).test(src);
    const decorated = new RegExp(`@(Cron|Interval|Timeout)\\([\\s\\S]{0,200}?\\b${name}\\s*\\(`).test(src);

    if (!elsewhere && !here && !scheduledHere && !decorated) {
      rows.push(`  ${name.padEnd(26)} ${file.slice(REPO.length + 1)}`);
    }
  }
}

// --- self-check -----------------------------------------------------------
// A scan nobody has seen fire is a scan nobody knows works. These pin both
// directions against real files in this repo.
{
  const fail = [];
  const janitorNames = [...seen].map((k) => k.split('::')[1]);
  if (!janitorNames.includes('trimDeliveredEvents')) {
    fail.push('cannot see titan-notifications `trimDeliveredEvents`, a janitor known to exist');
  }
  if (rows.some((r) => /trimDeliveredEvents/.test(r))) {
    fail.push('`trimDeliveredEvents` reported uncalled — `runJanitor` calls it');
  }
  if (fail.length) {
    console.error('SELF-CHECK FAILED: ' + fail.join('; '));
    process.exit(2);
  }
}

console.log(`scanned ${files.length} files, found ${found} janitor methods, ${rows.length} with no caller\n`);
rows.forEach((r) => console.log(r));
if (rows.length === 0) console.log('  (none)');
console.log('\nself-check OK: sees a known janitor, and does not call a called one uncalled');
