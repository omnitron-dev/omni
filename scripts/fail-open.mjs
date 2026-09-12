#!/usr/bin/env node
/**
 * Find catch blocks that swallow a SECURITY decision.
 *
 * The shape: a `try` whose body makes an authorization, verification, or
 * integrity check, and a `catch` that does nothing with the failure but log it.
 * The request then continues as if the check had passed. That is not the same
 * bug as a check that is missing — it is worse, because the code reads as
 * though the check is there and a reviewer stops looking.
 *
 * Ported from the downstream copy, which carries its own triage for its own tree.
 * One vocabulary difference: `sendErrorResponse` counts as a refusal here,
 * because it is how netron's packet branches answer a caller with an error.
 *
 * TRIAGE (2026-09-12, first run on omni): 36 hits, 2 real defects.
 *
 *   - `netron/transport/http/server.ts` `validateMethodInput` — a declared
 *     input contract that could not be evaluated was skipped rather than
 *     refused, on two branches. The `safeParse` one is reachable from the wire:
 *     zod propagates an exception thrown inside a `.refine()` callback, so a
 *     crafted payload chose whether it got validated. Fixed in de89641.
 *   - `netron/core-tasks/authenticate.ts` — not a fail-open itself (it returns
 *     `success: false`), but reading it found the catch logging
 *     `{ ...credentials, password: '***', token: '***' }`: a denylist over a
 *     type whose index signature is `[key: string]: any`. Fixed in 6f200a8.
 *
 * The other 34 are fail-CLOSED or not security, and should not be re-litigated:
 *   - `apps/omnitron` doctor / health / node / up commands (14): diagnostics.
 *     A failed probe becomes a finding or a printed error, never an allowance.
 *   - `built-in-policies.ts`, `rate-limiter.ts`: both answer `allowed: false` /
 *     `resolve(false)` on error. A rate limiter that fails closed is correct.
 *   - `titan-auth/auth.guards.ts` (both): `{ allowed: false }`.
 *   - `authentication-manager.ts` (both), `websocket/auth.ts`,
 *     `http/server.ts:390`: `success: false` / `authenticated = false`.
 *   - `titan-database` `validateConnectionHealth`, `titan-cache`
 *     `cache.health.ts`: health probes returning `{ healthy: false }`.
 *   - `rotif.ts` `ensureStreamGroup`, `daemon.ts`/`up.ts` `ensureImage`,
 *     `project.service.ts` `validateStackInfrastructure`,
 *     `daemon-scheduler.ts` `checkRotation`: provisioning and pollers whose
 *     failure denies nothing and which retry on the next tick.
 *   - `remote-deployer.service.ts:499`: the hit is the progress-listener loop;
 *     a listener that throws must not break a deployment.
 *
 * NOTE on a near-miss, left alone deliberately: `isPublic(target, method)`
 * falls through to the class-level decorator, so a class-level `@Public()`
 * makes every method public including one carrying `@RequireRole`. It is
 * documented and tested behaviour, and no class in either repo is annotated
 * that way — the only occurrence is a test fixture.
 *
 * Usage: node scripts/fail-open.mjs
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DECISION = /\b(require[A-Z]\w*|assert[A-Z]\w*|verify\w*|validate\w*|check\w*|canAccess|hasPermission|isAllowed|authorize\w*|authenticate\w*|ensure[A-Z]\w*|guard\w*|signatureIs\w*|timingSafeEqual|compare|decrypt|getForWrite|getForRead)\s*\(/;
/** Names that are checks by shape but not by consequence. */
const BENIGN = /\b(validateEnv|checkHealth|healthCheck|checkConnection|validateConfig|compareVersions?)\s*\(/;
// `sendErrorResponse` is netron's refusal: the packet's caller receives the
// error instead of a result. Without it in this vocabulary, every `TYPE_*`
// branch in `remote-peer.ts` reads as a swallow — which is how this scan
// reported its own first false positive, on the branch that had just been
// given a validation call.
const REFUSES = /\b(throw|return\s+(false|null|undefined)|reject|deny|forbid|process\.exit|sendErrorResponse)\b/;
const RETHROWS = /\bthrow\b/;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

/** Match the block that starts at `open` (an index pointing at '{'). */
function blockAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

const files = execSync(
  "find apps packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -name '*.test.ts' -not -name '*.d.ts'",
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
).trim().split('\n').filter(Boolean);

let tries = 0, withDecision = 0, benign = 0, handled = 0;
// --- self-check -----------------------------------------------------------
// A rule nobody has seen fire is a rule nobody knows works. These pin the two
// directions of the catch-assignment decision, which is the part most likely
// to rot into "everything is handled".
{
  const PERMISSIVE = /=\s*(true|1|\[\]|\{\})\s*;/;
  const REFUSING = /=\s*(false|null|undefined|0|-1)\s*;/;
  const handled = (body) => {
    if (!/^\s*[\w$.[\]]+\s*=[^=]/m.test(body)) return false;
    if (REFUSING.test(body) && !PERMISSIVE.test(body)) return true;
    return !PERMISSIVE.test(body);
  };
  const fail = [];
  if (handled(' allowed = true; ')) fail.push('a permissive default was read as handling');
  if (!handled(' allowed = false; ')) fail.push('a refusing default was not read as handling');
  if (!handled(" msg = '[decryption failed]'; ")) fail.push('an explicit message was not read as handling');
  if (handled(' perms = []; ')) fail.push('an empty collection default was read as handling');
  if (fail.length) { console.error('SELF-CHECK FAILED: ' + fail.join('; ')); process.exit(1); }
}

const findings = [];

for (const file of files) {
  // A test that catches deliberately is not a fail-open — and one of this
  // scan's own regression tests was being reported as a finding.
  if (/(^|\/)test\/|\.(spec|test)\.ts$/.test(file)) continue;
  const raw = readFileSync(file, 'utf8');
  const src = stripComments(raw);

  for (let i = src.indexOf('try'); i !== -1; i = src.indexOf('try', i + 1)) {
    if (/[\w$]/.test(src[i - 1] ?? ' ')) continue;
    const tryOpen = src.indexOf('{', i);
    if (tryOpen === -1 || tryOpen - i > 4) continue;
    const tryBody = blockAt(src, tryOpen);
    if (tryBody === null) continue;
    tries++;

    if (!DECISION.test(tryBody)) continue;
    if (BENIGN.test(tryBody) && !DECISION.test(tryBody.replace(BENIGN, ''))) { benign++; continue; }
    withDecision++;

    const after = src.slice(tryOpen + tryBody.length + 2);
    const cm = after.match(/^\s*catch\s*(\([^)]*\))?\s*\{/);
    if (!cm) continue;
    const catchOpen = tryOpen + tryBody.length + 2 + cm[0].length - 1;
    const catchBody = blockAt(src, catchOpen);
    if (catchBody === null) continue;

    // A catch that rethrows, refuses, or is a bare `if (…) throw` is handling it.
    if (RETHROWS.test(catchBody) || REFUSES.test(catchBody)) { handled++; continue; }
    // A catch that assigns something the caller can branch on is handling it —
    // but ONLY if what it assigns is a refusal.
    //
    // The first version accepted ANY assignment, which is the exact shape this
    // scan exists to find: `catch { allowed = true }` sets a variable the
    // caller branches on, and it branches the wrong way. Treating "it assigns
    // something" as "it handles it" excluded the permissive default — the
    // definition of fail-open — from a fail-open scan.
    // A permissive DEFAULT is a boolean allow or an empty collection standing
    // in for "nothing restricts this". A STRING is almost always a message —
    // `messageContent = '[sys:chat.e2ee.decryptionFailed]'` is the user being
    // told what happened, which is handling it. Including strings here flagged
    // four correct E2EE fallbacks in the portal before this line was narrowed.
    const PERMISSIVE = /=\s*(true|1|\[\]|\{\})\s*;/;
    const REFUSING = /=\s*(false|null|undefined|0|-1)\s*;/;
    if (/^\s*[\w$.[\]]+\s*=[^=]/m.test(catchBody)) {
      if (REFUSING.test(catchBody) && !PERMISSIVE.test(catchBody)) { handled++; continue; }
      if (!PERMISSIVE.test(catchBody)) { handled++; continue; }
      // falls through to be reported: the catch assigns a permissive value
    }

    const line = raw.slice(0, raw.indexOf(tryBody.slice(0, 40))).split('\n').length;
    const called = [...tryBody.matchAll(new RegExp(DECISION.source, 'g'))].map((m) => m[1]);
    findings.push({
      file: file.replace(/^apps\//, ''),
      line,
      calls: [...new Set(called)].slice(0, 3).join(', '),
      swallow: catchBody.trim().split('\n')[0]?.trim().slice(0, 60) || '(empty)',
    });
  }
}

console.log(`${tries} try blocks examined`);
console.log(`${withDecision} of those make an access / authenticity decision (${benign} dropped as health-check shaped)`);
console.log(`${handled} of those rethrow, refuse, or record the failure for the caller`);
console.log(`${findings.length} swallow it\n`);

const byApp = new Map();
for (const f of findings) {
  const app = f.file.split('/')[0];
  if (!byApp.has(app)) byApp.set(app, []);
  byApp.get(app).push(f);
}
for (const [app, list] of [...byApp].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`=== ${app} (${list.length}) ===`);
  for (const f of list) console.log(`  ${f.file}:${f.line}  [${f.calls}]  catch → ${f.swallow}`);
}
