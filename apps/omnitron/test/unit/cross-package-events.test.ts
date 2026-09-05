/**
 * Event names that cross a package boundary.
 *
 * Inside omnitron a wrong event name is usually caught by something. These
 * five are not: the orchestrator subscribes to `ProcessSupervisor` by string
 * literal, the supervisor emits by string literal, and no type connects the
 * two. Rename one side and the compiler stays quiet, the tests stay green,
 * and an app started by the supervisor simply never leaves `starting` —
 * because `child:started` is what marks it online.
 *
 * That is the whole reason this file exists. It is a link check, not a style
 * rule: every name the orchestrator listens for must be a name the supervisor
 * actually emits.
 *
 * It also checks itself. A guard that reads two files by path and greps them
 * is one moved file away from finding nothing and reporting success, which is
 * the failure mode it is supposed to prevent — so the extractions must both
 * come back non-empty and contain a known anchor before any comparison
 * counts. (Found the hard way: the first version of this sweep used
 * `grep -E '\\s*'`, which BSD grep does not support, matched nothing, and
 * read as "the supervisor emits no events at all".)
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR = path.resolve(here, '../../src/orchestrator/orchestrator.service.ts');
const SUPERVISOR = path.resolve(here, '../../../../packages/titan-pm/src/process-supervisor.ts');

/** Names passed to `<receiver>.on('name', …)`, for the given receiver. */
function subscriptions(source: string, receiver: string): Set<string> {
  const re = new RegExp(`\\b${receiver}\\s*\\.\\s*on\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
  return new Set(Array.from(source.matchAll(re), (m) => m[1]!));
}

/** Names passed to `this.emit('name', …)`. */
function emissions(source: string): Set<string> {
  const re = /\bthis\s*\.\s*emit\s*\(\s*['"]([^'"]+)['"]/g;
  return new Set(Array.from(source.matchAll(re), (m) => m[1]!));
}

describe('orchestrator ↔ ProcessSupervisor event names', () => {
  const orchestratorSrc = fs.existsSync(ORCHESTRATOR) ? fs.readFileSync(ORCHESTRATOR, 'utf8') : '';
  const supervisorSrc = fs.existsSync(SUPERVISOR) ? fs.readFileSync(SUPERVISOR, 'utf8') : '';

  it('can still find both files', () => {
    // Before asserting anything about the contents.
    expect(orchestratorSrc.length, ORCHESTRATOR).toBeGreaterThan(0);
    expect(supervisorSrc.length, SUPERVISOR).toBeGreaterThan(0);
  });

  it('extracts subscriptions and emissions, so a match means something', () => {
    const listened = subscriptions(orchestratorSrc, 'supervisor');
    const emitted = emissions(supervisorSrc);

    // Anchors: if these two stop being found, the extraction has broken and
    // every "no mismatch" result below is vacuous.
    expect(listened, 'orchestrator subscriptions').toContain('child:started');
    expect(emitted, 'supervisor emissions').toContain('child:started');
    expect(listened.size).toBeGreaterThanOrEqual(4);
    expect(emitted.size).toBeGreaterThanOrEqual(4);
  });

  it('listens only for events the supervisor emits', () => {
    const listened = subscriptions(orchestratorSrc, 'supervisor');
    const emitted = emissions(supervisorSrc);

    const orphans = [...listened].filter((name) => !emitted.has(name));
    expect(orphans, `subscribed in the orchestrator, never emitted by the supervisor`).toEqual([]);
  });

  it('still marks apps online, restarts and escalations', () => {
    // The four that carry state changes an operator can see. Losing any of
    // them leaves the console showing a status the process does not have.
    const listened = subscriptions(orchestratorSrc, 'supervisor');
    for (const required of ['child:started', 'child:crash', 'child:restart', 'escalate']) {
      expect(listened, required).toContain(required);
    }
  });
});
