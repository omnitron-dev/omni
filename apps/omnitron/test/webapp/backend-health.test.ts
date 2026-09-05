/**
 * Deciding whether the daemon is down.
 *
 * The console's banner says "Daemon offline — run `omnitron dev` to start the
 * backend". That is an instruction, not an observation, and it was raised by
 * a single failed probe — where one way to fail is a five-second timeout. So
 * on a loaded machine, which is exactly when a console is being watched, a
 * daemon answering CLI queries in the same second was reported as not
 * running. Observed live during this audit.
 */

import { describe, it, expect } from 'vitest';

import {
  classifyHealthResponse,
  nextBackendStatus,
} from '../../webapp/src/utils/backend-health.js';

describe('classifyHealthResponse', () => {
  it('believes a daemon that says it is up', () => {
    expect(classifyHealthResponse(200, 'application/json', { status: 'online' })).toBe('up');
  });

  it('treats a proxy 502/503 as evidence the daemon is not there', () => {
    // nginx reached, the daemon did not answer it. That is a conclusion, not
    // a failed measurement.
    expect(classifyHealthResponse(502, 'text/plain', null)).toBe('down');
    expect(classifyHealthResponse(503, 'text/plain', null)).toBe('down');
  });

  it('treats an HTML answer as unreachable, not as a dead daemon', () => {
    // The SPA fallback means `/api/health` is not proxied at all — a routing
    // mistake in the deployment. Calling that "offline" blames the daemon for
    // something that is not its fault and points the operator at the wrong fix.
    expect(classifyHealthResponse(200, 'text/html; charset=utf-8', null)).toBe('unreachable');
  });

  it('treats any other non-2xx as unreachable', () => {
    expect(classifyHealthResponse(500, 'application/json', null)).toBe('unreachable');
    expect(classifyHealthResponse(404, 'application/json', null)).toBe('unreachable');
  });

  it('takes a 200 that does not say "online" at its word', () => {
    expect(classifyHealthResponse(200, 'application/json', { status: 'starting' })).toBe('down');
    expect(classifyHealthResponse(200, 'application/json', null)).toBe('down');
  });
});

describe('nextBackendStatus', () => {
  it('goes online on a successful probe, whatever came before', () => {
    expect(nextBackendStatus('up', 5)).toEqual({ status: 'online', consecutiveUnreachable: 0 });
  });

  it('goes offline immediately on an explicit "not there"', () => {
    // No corroboration needed: something answered on the daemon's behalf and
    // said it is not running.
    expect(nextBackendStatus('down', 0)).toEqual({ status: 'offline', consecutiveUnreachable: 0 });
  });

  it('does not conclude offline from one probe that never completed', () => {
    // The defect this exists for. A timeout is absence of evidence.
    expect(nextBackendStatus('unreachable', 0)).toEqual({
      status: 'degraded',
      consecutiveUnreachable: 1,
    });
  });

  it('never concludes offline from failures alone, however many', () => {
    // This used to escalate on the second consecutive failure, on the
    // reasoning that a repeated failure corroborates. It does not: repeating
    // a non-observation leaves it a non-observation. Watched live on a host
    // at load 147 — the health probe took 8.2 s against a five-second
    // timeout while the daemon answered the CLI in 3 ms, and the console
    // told its operator to start a daemon that was running.
    expect(nextBackendStatus('unreachable', 1)).toEqual({
      status: 'degraded',
      consecutiveUnreachable: 2,
    });
    expect(nextBackendStatus('unreachable', 9)).toEqual({
      status: 'degraded',
      consecutiveUnreachable: 10,
    });
  });

  it('reserves offline for the one outcome that is evidence', () => {
    // 502/503 — something answered for the daemon and said it is not there.
    // Only that produces the banner that tells an operator to start it.
    expect(nextBackendStatus('down', 0).status).toBe('offline');
    expect(nextBackendStatus('down', 7)).toEqual({ status: 'offline', consecutiveUnreachable: 0 });
  });

  it('forgets the streak as soon as anything answers', () => {
    const recovered = nextBackendStatus('up', 1);
    expect(recovered.consecutiveUnreachable).toBe(0);
    // …so the next single failure is degraded again, not offline.
    expect(nextBackendStatus('unreachable', recovered.consecutiveUnreachable).status).toBe('degraded');
  });
});
