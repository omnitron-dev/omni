/**
 * Deciding what to tell an operator about the daemon.
 *
 * The distinction this file exists for: "the daemon says it is down" and "I
 * could not find out" produce different actions, and only the first earns
 * the word offline. The banner that follows says `run omnitron up`, which is
 * an instruction — and an instruction on a non-observation sends someone to
 * start a daemon that is already running.
 */

import { describe, it, expect } from 'vitest';

import { classifyHealthResponse, nextBackendStatus } from './backend-health.js';

describe('classifyHealthResponse', () => {
  it('reports up only when the daemon says so', () => {
    expect(classifyHealthResponse(200, 'application/json', { status: 'online' })).toBe('up');
  });

  it('reports down when the daemon answers with anything else', () => {
    expect(classifyHealthResponse(200, 'application/json', { status: 'starting' })).toBe('down');
  });

  it('reports down when the proxy answers on the daemon’s behalf', () => {
    // 502/503 come from nginx having tried and failed to reach it — that is
    // an observation about the daemon, not about the network.
    expect(classifyHealthResponse(502, 'text/plain', null)).toBe('down');
    expect(classifyHealthResponse(503, 'text/plain', null)).toBe('down');
  });

  it('does not blame the daemon for a routing mistake', () => {
    // The SPA fallback: /api/health is not proxied at all, so this
    // deployment cannot answer the question.
    expect(classifyHealthResponse(200, 'text/html; charset=utf-8', null)).toBe('unreachable');
  });

  it('does not blame the daemon for an answer it could not read', () => {
    // A 2xx with a malformed or empty body. `body` is null in both cases and
    // neither says anything about the daemon's state; this used to report
    // `down`, putting "run omnitron up" in front of a parse failure.
    expect(classifyHealthResponse(200, 'application/json', null)).toBe('unreachable');
    expect(classifyHealthResponse(204, null, null)).toBe('unreachable');
  });

  it('treats every other status as unknown', () => {
    expect(classifyHealthResponse(404, 'application/json', null)).toBe('unreachable');
    expect(classifyHealthResponse(500, 'application/json', null)).toBe('unreachable');
  });
});

describe('nextBackendStatus', () => {
  it('clears the failure count on a good probe', () => {
    expect(nextBackendStatus('up', 7)).toEqual({ status: 'online', consecutiveUnreachable: 0 });
  });

  it('goes offline on an explicit down, without corroboration', () => {
    expect(nextBackendStatus('down', 0)).toEqual({ status: 'offline', consecutiveUnreachable: 0 });
  });

  it('never escalates repeated non-observation to offline', () => {
    // The rule this module is built on: repeating a non-observation leaves
    // it a non-observation. Watched live on a loaded host where the probe
    // took 8.2s against a 5s timeout while the daemon answered the same
    // query in 3ms — two failures in a row, and a console telling its
    // operator to start a daemon that was running.
    let count = 0;
    for (let i = 0; i < 10; i++) {
      const next = nextBackendStatus('unreachable', count);
      expect(next.status).toBe('degraded');
      count = next.consecutiveUnreachable;
    }
    expect(count).toBe(10);
  });
});
