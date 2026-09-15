#!/usr/bin/env node
/**
 * A module offering `forRoot` and `forRootAsync` promises the same wiring
 * either way. Where the two disagree, one of them quietly does less.
 *
 * Written after fixing the same shape three times in one day: `applyGlobalPlugins`
 * treating two option sources as alternatives, an RLS plugin delivered through
 * the one registry path that could not work, and `titan-ratelimit` applying its
 * key prefix twice — fixed in `forRoot`, still broken in `forRootAsync`, which
 * is the path downstream actually takes. Reading the code said the fix was complete
 * every time; only a probe on the running system said otherwise.
 *
 * WHAT IT REPORTS: per module, the DI tokens and the classes each root
 * constructs that the other does not.
 *
 * TRIAGE (2026-09-12, first run): two real findings out of fourteen modules —
 *
 *   - `config.module.ts` provided `CONFIG_SCHEMA_TOKEN` only in `forRoot`, so
 *     an app configured asynchronously with a schema had `validateOnStartup`
 *     silently doing nothing.
 *   - `logger.module.ts` injected the optional `CONFIG_SERVICE_TOKEN` only in
 *     `forRootAsync`, so `logger.level` / `prettyPrint` / `redact` / `base` /
 *     `timestamp` / `messageKey` were ignored under `forRoot`.
 *
 * Both fixed. A hit here is not automatically a defect — a root may legitimately
 * wire less — but it is always a question worth answering out loud.
 *
 * Usage: node scripts/module-root-drift.mjs
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { stripComments } from './lib/strip-comments.mjs';

const files = execSync("git ls-files 'packages/*/src/**/*.module.ts'", { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

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

/** Body of a static method, by brace matching. */
function methodBody(src, header) {
  const at = src.indexOf(header);
  if (at < 0) return null;

  // Walk the PARAMETER LIST first. A signature like
  // `forRoot(options: IConfigModuleOptions & { defaults?: … } = {})` contains
  // braces of its own, and starting the body scan at the first `{` after the
  // header lands inside that type literal — which returns a one-line "body"
  // and makes every module look like it wires nothing. That is how this scan
  // first reported config.module.ts as its only finding.
  let i = src.indexOf('(', at);
  let parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') parens++;
    else if (src[i] === ')') { parens--; if (parens === 0) { i++; break; } }
  }

  // Then skip the return-type annotation to the `{` that opens the body.
  const bodyStart = src.indexOf('{', i);
  if (bodyStart < 0) return null;

  let depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  return null;
}

// --- self-check: the shape that fooled it ---------------------------------
{
  const fixture = `
class M {
  static forRoot(options: Opts & { defaults?: Record<string, any> } = {}): any {
    const a = new AlphaService();
    return { providers: [ALPHA_TOKEN] };
  }
  static forRootAsync(options: AsyncOpts): any {
    const a = new AlphaService();
    return { providers: [ALPHA_TOKEN] };
  }
}`;
  const sync = methodBody(fixture, 'static forRoot(');
  if (!sync || !sync.includes('new AlphaService')) {
    console.error('SELF-CHECK FAILED: a brace in the parameter type still truncates the body');
    process.exit(2);
  }
}

/** Tokens/classes a body registers, and the notable option keys it reads. */
function fingerprint(body) {
  const providers = new Set(
    [...body.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)].map((m) => m[1]).filter((t) => t.includes('_')),
  );
  const classes = new Set([...body.matchAll(/new\s+([A-Z][A-Za-z0-9]+)\s*\(/g)].map((m) => m[1]));
  return { providers, classes };
}

const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

let findings = 0;
for (const f of files) {
  const src = strip(readFileSync(f, 'utf8'));
  const sync = methodBody(src, 'static forRoot(');
  const async_ = methodBody(src, 'static forRootAsync(');
  if (!sync || !async_) continue;

  const a = fingerprint(sync);
  const b = fingerprint(async_);
  const onlySyncClasses = diff(a.classes, b.classes);
  const onlyAsyncClasses = diff(b.classes, a.classes);
  const onlySyncTokens = diff(a.providers, b.providers);
  const onlyAsyncTokens = diff(b.providers, a.providers);

  if (onlySyncClasses.length || onlyAsyncClasses.length || onlySyncTokens.length || onlyAsyncTokens.length) {
    findings++;
    console.log(`\n${f.replace('packages/', '')}`);
    if (onlySyncClasses.length) console.log(`  constructs only in forRoot:      ${onlySyncClasses.join(', ')}`);
    if (onlyAsyncClasses.length) console.log(`  constructs only in forRootAsync: ${onlyAsyncClasses.join(', ')}`);
    if (onlySyncTokens.length) console.log(`  provides only in forRoot:        ${onlySyncTokens.join(', ')}`);
    if (onlyAsyncTokens.length) console.log(`  provides only in forRootAsync:   ${onlyAsyncTokens.join(', ')}`);
  }
}
console.log(`\n${findings} module(s) whose two roots do not wire the same things`);
