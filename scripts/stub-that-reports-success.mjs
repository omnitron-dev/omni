#!/usr/bin/env node
/**
 * A method that reports success and does no work.
 *
 * This is the worst shape an unfinished feature can take. An absent feature is
 * discovered the first time someone looks for it; a stub that logs
 * "… completed" is discovered never, because every place an operator would
 * look says it is working: the log reads healthy, the execution count climbs,
 * and the NAME is taken, so "do we have one of those?" answers yes.
 *
 * Ported from the downstream copy, which found three scheduled stubs in payments
 * (a custody control among them). This one scans `apps` AND `packages`,
 * because that is where omni keeps its code.
 *
 * WHAT IT LOOKS FOR: a method whose body logs at info/warn with a
 * success-shaped message and contains no `await` of anything but the logger.
 * A placeholder comment (`// This would`, TODO, FIXME) is reported as STUB and
 * is the strongest signal, but is not required — a stub need not admit to
 * being one.
 *
 * TRIAGE (2026-09-12, first run on omni): opened at 13, closed at 0. Every
 * one was the scan, not the code — which is the usual arc, and the reason to
 * fix the scan before opening a worklist:
 *
 *   - 7 were under `packages/titan/examples/`, now skipped like `test/`;
 *   - 4 were methods that do real work SYNCHRONOUSLY. "No await" is a good
 *     proxy for "no work" in the downstream project, whose services are DB-bound; omni is full
 *     of in-memory state. `project.service.updateProject` rewrites the
 *     registry and emits, `connection-manager.cleanupIdleConnections` closes
 *     connections, `health-monitor.updateNodes` / `updateConfig` replace
 *     state. Mutating a collection, emitting, or calling a collaborator now
 *     counts as work;
 *   - 1 was `if (exitCode === 0) logger.info('Done');` in
 *     `titan-database/migration/cli.ts`, which sits at method indentation and
 *     matched the header pattern. Control keywords are now excluded;
 *   - 1 was `orchestrator.wireSupervisorEvents`, which registers handlers —
 *     covered by the same synchronous-work rule.
 *
 * A zero here is only meaningful while the self-check still fires, so it
 * probes BOTH directions: a bare success log must be seen, and synchronous
 * work must not be reported.
 *
 * Usage: node scripts/stub-that-reports-success.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// omni keeps most of its code in `packages`, not `apps`, so both are roots.
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ROOTS = [join(REPO, 'apps'), join(REPO, 'packages')];

function files(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (/^(node_modules|dist|test|examples|\.omnitron-build|\.turbo)$/.test(name)) continue;
      files(full, acc);
    } else if (name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

const PLACEHOLDER = /\/\/\s*(This would|TODO|FIXME|Placeholder|Not implemented)/i;
/** Control keywords that indent like a method header. */
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'do', 'else', 'try', 'function']);

/** Synchronous work: mutate a collection, emit, assign to state, call a collaborator. */
const WORK = /\.(set|delete|add|push|splice|clear|unshift|pop|shift|emit|write|close|kill|destroy)\s*\(|\bthis\.[\w.]+\s*(=|\+=|-=)[^=]|\bthis\.(?!logger)[\w]+\.[\w]+\s*\(/;
const SUCCESS =
  /logger\.(info|warn)\s*\(\s*[^)]*?(completed|processed|done|finished|success|synced|updated|sent|created|cleaned)/i;

const hits = [];
let examined = 0;

for (const file of ROOTS.flatMap((r) => files(r))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const starts = [];
  lines.forEach((l, i) => {
    if (/^\s{2}(?:private\s+|public\s+|protected\s+)?(?:async\s+)?[a-zA-Z_$][\w$]*\s*\(/.test(l) && !/^\s*\/\//.test(l)) {
      starts.push(i);
    }
  });
  for (let k = 0; k < starts.length; k++) {
    const a = starts[k];
    const b = k + 1 < starts.length ? starts[k + 1] : Math.min(a + 80, lines.length);
    const body = lines.slice(a, b).join('\n');
    if (body.length > 6000) continue;
    examined++;
    if (!SUCCESS.test(body)) continue;
    if ((body.match(/await\s+(?!this\.logger)/g) || []).length > 0) continue;
    // A method can do real work without awaiting anything. Downstream services are
    // DB-bound so "no await" was a good proxy there; omni is full of
    // synchronous in-memory state, and on its first run this rule reported
    // four methods that plainly do their job — `updateProject` rewrites the
    // registry, `cleanupIdleConnections` closes connections. Mutating state,
    // emitting an event or calling out to a collaborator all count.
    if (WORK.test(body)) continue;
    const name = /^\s*(?:private\s+|public\s+|protected\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/.exec(lines[a])?.[1];
    // `if (exitCode === 0) logger.info('Done');` sits at method indentation and
    // matches the header pattern. A control keyword is never a method name.
    if (!name || KEYWORDS.has(name)) continue;
    hits.push({ file: file.slice(REPO.length + 1), line: a + 1, name, stub: PLACEHOLDER.test(body) });
  }
}

// --- self-check -----------------------------------------------------------
{
  const fail = [];
  const probe = (body) => {
    const lines = ['  async probe() {', ...body, '  }', '  async next() {}'];
    const b = lines.join('\n');
    return SUCCESS.test(b) && (b.match(/await\s+(?!this\.logger)/g) || []).length === 0 && !WORK.test(b);
  };
  if (!probe(["    this.logger.info({}, 'Sweep completed');"])) fail.push('a bare success log was not seen');
  if (probe(["    this.entries.delete(id);", "    this.logger.info({}, 'Sweep completed');"])) {
    fail.push('synchronous work was reported as a stub');
  }
  if (probe(["    this.emit('swept', id);", "    this.logger.info({}, 'Sweep completed');"])) {
    fail.push('an emitted event was reported as a stub');
  }
  if (!KEYWORDS.has('if')) fail.push('a control keyword would be read as a method name');
  if (probe(["    await this.repo.sweep();", "    this.logger.info({}, 'Sweep completed');"])) {
    fail.push('a method that does real work was reported');
  }
  if (probe(["    this.logger.debug({}, 'Sweep completed');"])) fail.push('a debug line was treated as a claim');
  if (fail.length) { console.error('SELF-CHECK FAILED: ' + fail.join('; ')); process.exit(1); }
}

console.log(`${examined} method bodies examined`);
console.log(`${hits.length} report success without awaiting any work\n`);
for (const h of hits) {
  console.log(`  ${h.stub ? 'STUB ' : '     '}${h.file}:${h.line}  ${h.name}`);
}
if (hits.length === 0) console.log('  (none)');
