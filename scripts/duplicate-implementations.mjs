#!/usr/bin/env node
/**
 * One operation, implemented twice.
 *
 * Two copies of a function do not stay equal. One gets fixed and the other
 * keeps answering the old way, and because each reads as correct on its own,
 * nothing points at the disagreement. Written after `handlers/validation.ts`
 * turned out to be a character-identical dead copy of a live security control
 * — both carrying the same fail-open.
 *
 * WHAT IT REPORTS: top-level functions whose bodies are identical after
 * whitespace normalisation, across DIFFERENT files. Bodies under 200
 * characters are ignored: short ones collide for boring reasons.
 *
 * It cannot see method-level duplication, or two implementations that differ
 * in spelling but not in meaning. `prism`'s `getLuminance` /
 * `getLuminanceForContrast` were caught because they were byte-identical under
 * two names; the THIRD implementation in the same package, which differed only
 * in how it parsed the hex, was found by reading the other two.
 *
 * TRIAGE (2026-09-12, first run): 9 groups, 4 of them real defects.
 *
 *   - `compareSemver` × 2 inside netron-browser — and both disagreed with the
 *     server's `semver.rcompare` about which version is "latest" (2159c1d).
 *   - `toTitanError` × 2 inside netron-browser, both `export *`-ed from one
 *     barrel; the name survives only because an explicit re-export line
 *     disambiguates it (2159c1d).
 *   - `getLuminance` / `getLuminanceForContrast` in prism — the thread that
 *     led to three contrast implementations where one had been audited and
 *     fixed (180a4b7).
 *   - `OnShutdown` × 3 in apps/omnitron — the copies were fine; comparing them
 *     with titan-pm's exported version showed the LIBRARY's was inert
 *     (4e1cac6).
 *
 * The other 5 are cross-package by design and should not be collapsed:
 *   - `resolveJsToTs` × 11 in vitest.config.ts — build config, per package.
 *   - `extractTitanErrorExtras`, `isHttpBatchRequest`, `isHttpBatchResponse` —
 *     netron-browser is a standalone browser implementation of the protocol
 *     and cannot import the node-targeted titan. A wire-format change has to
 *     land in both; that is the cost of the bundle, not an oversight.
 *
 * Usage: node scripts/duplicate-implementations.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stripComments } from './lib/strip-comments.mjs';

const ROOTS = ['packages', 'apps'];
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
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const byHash = new Map();
let scanned = 0;

for (const file of ROOTS.flatMap((r) => walk(r))) {
  const src = strip(readFileSync(file, 'utf8'));
  const re = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/gm;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    // body by brace matching from the first { after the signature
    let i = src.indexOf('{', m.index + m[0].length - 1);
    if (i < 0) continue;
    let depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const body = norm(src.slice(i, end + 1));
    if (body.length < 200) continue;           // trivial bodies collide for boring reasons
    scanned++;
    const h = createHash('sha1').update(body).digest('hex').slice(0, 12);
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push({ file, name, len: body.length });
  }
}

const dups = [...byHash.values()].filter((g) => g.length > 1 && new Set(g.map(x=>x.file)).size > 1);
console.log(`${scanned} function bodies of 200+ chars; ${dups.length} duplicated across files\n`);
for (const g of dups.sort((a,b)=>b[0].len-a[0].len)) {
  console.log(`  ${g[0].len} chars — ${g.map(x=>`${x.name} @ ${x.file}`).join('\n                  ')}`);
}
