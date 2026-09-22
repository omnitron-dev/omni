/**
 * The mesh link dropped every 360 seconds, to the second.
 *
 * Measured on `daos/test`, 2026-09-22, from the daemon log: 51 drops in one
 * day, «Socket closed during RPC», median interval between them 360 s with
 * 32 of 45 inside 360 ± 5, each followed by a rejoin about nine seconds
 * later. An interval that tight is a timer, not a network.
 *
 * It is not omnitron's timer: the mesh heartbeat is 15 s, the backoff cap
 * 120 s, the slave request timeout 600 s, netron's idle timeout 30 s, ssh2's
 * keepalive 15 s × 4. It is `@xec-sh/core`'s SSH connection pool, which
 * sweeps every 60 s and closes anything whose `lastUsed` is older than its
 * `idleTimeout` — 300 s by default.
 *
 * And the connection is not idle. The node's daemon port is closed, so the
 * mesh runs through an in-process SSH tunnel and heartbeats cross it every
 * 15 s — but the pool counts USE as a command execution, and a forwarded
 * channel is not a command. The pool's question and the caller's are
 * different questions with the same name.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';
import { SSH_CONNECTION_POOL } from '../../src/execution/execution.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** When the first sweep strictly after `idleMs` lands, sweeping every `sweepMs`. */
function firstClosingSweep(idleMs: number, sweepMs: number): number {
  for (let t = sweepMs; t <= 48 * 60 * 60 * 1000; t += sweepMs) {
    if (t > idleMs) return t;
  }
  return Infinity;
}

describe('the arithmetic that produced 360', () => {
  it('lands the first closing sweep at exactly 360 s for the default', () => {
    // 60, 120, 180, 240, 300 — and 300 is not GREATER than 300, so the
    // connection survives that pass and dies on the next one.
    expect(firstClosingSweep(300_000, 60_000)).toBe(360_000);
  });

  it('never closes on idleness with what this daemon now asks for', () => {
    // A day was the first answer, and this test refused it: the sweep at
    // 24 h + 60 s still closes the link, which moves the drop rather than
    // removing it. Idleness is not measurable for a tunnel, so it is not a
    // reason to close one.
    expect(firstClosingSweep(SSH_CONNECTION_POOL.idleTimeout, 60_000)).toBe(Infinity);
  });
});

describe('what the two numbers mean', () => {
  it('never uses zero for the idle timeout, where zero means «close it now»', () => {
    // `now - lastUsed > idleTimeout` has no guard around it: at zero every
    // connection is older than the limit on the very next sweep. The trap is
    // that the field beside it reads the opposite way.
    expect(SSH_CONNECTION_POOL.idleTimeout).toBeGreaterThan(0);
    expect(SSH_CONNECTION_POOL.idleTimeout).toBeGreaterThan(6 * 60 * 1000);
  });

  it('uses zero for the lifetime, where zero does mean disabled', () => {
    // That check IS guarded — `maxLifetime > 0 && …` — so zero switches it
    // off rather than closing everything. Without this the link would still
    // drop, once an hour instead of every six minutes.
    expect(SSH_CONNECTION_POOL.maxLifetime).toBe(0);
  });

  it('says «never by idleness» with the only number that says it here', () => {
    // Not a claim that the connection is immortal: the pool's own
    // `isConnected()` pass still removes one that died, and this change does
    // not touch it. It is a claim that IDLENESS is not evidence — the pool
    // cannot see the traffic that keeps this link busy.
    expect(SSH_CONNECTION_POOL.idleTimeout).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('where the pool is configured', () => {
  const service = stripComments(
    fs.readFileSync(path.join(here, '../../src/execution/execution.service.ts'), 'utf8'),
  );

  it('passes it to the engine, because the adapter is built once from the engine config', () => {
    // `engine.ssh(target)` builds an execution context for one target; the
    // SSHAdapter — and its pool — is constructed in the engine's own
    // `initializeAdapters` from `config.adapters.ssh`. A `connectionPool`
    // handed to `engine.ssh(...)` per call is read by nobody, which is the
    // fix this would have been if it had gone there.
    expect(service).toMatch(/new xec\.ExecutionEngine\(\{[\s\S]*adapters: \{ ssh: \{ connectionPool: SSH_CONNECTION_POOL \} \}/);
  });

  it('does not put pool settings in the per-target config', () => {
    const perTarget = service.slice(
      service.indexOf('function sshConfig(target: SSHTarget)'),
      service.indexOf('export class ExecutionService'),
    );

    expect(perTarget).not.toMatch(/connectionPool/);
  });
});
