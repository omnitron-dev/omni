/**
 * T#76 — offline-fallback path resolution for `omnitron logs <app>`.
 *
 * The CLI's file-based fallback (used when the daemon is unreachable)
 * historically only looked at the legacy flat layout
 * `~/.omnitron/logs/<app>.log`. Modern LogManager writes to:
 *
 *   - ~/.omnitron/logs/<app>/app.log          (standalone)
 *   - ~/.omnitron/projects/{project}/{stack}/logs/{app}/app.log (project mode)
 *
 * These tests pin the layered probe order — project → standalone-dir →
 * legacy-flat → daemon-log — so future LogManager refactors don't
 * silently break offline diagnostics.
 *
 * Test scope: just the path resolver. The full file-reader path is
 * covered by integration tests against real log files.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';

// Import the internal resolver via the same module under test.
// `logs.ts` doesn't export it currently — we re-import from a
// known-stable internal path. If the resolver becomes private,
// these tests need a small `__test` re-export.
import * as logsCommand from '../../src/commands/logs.js';

// Re-export `resolveCandidateLogPaths` from logs.ts so tests can
// reach it. The implementation already exists — we just need a
// public hook. This shape mirrors how `process-janitor.ts`
// exports `__test`.
const candidates = (
  logsCommand as unknown as {
    __test?: { resolveCandidateLogPaths: (name: string) => string[] };
  }
).__test?.resolveCandidateLogPaths;

describe('logs offline fallback — T#76 path probing', () => {
  it('exposes the resolver helper', () => {
    // Hard, and deliberately the first assertion in the file.
    //
    // This used to warn and return when the export was missing, and the two
    // tests below opened with `if (!candidates) return;`. Between them, a
    // removed export left three green tests that checked nothing — with a
    // console warning nobody reads in a passing run, which is worse than
    // silence because it looks like diligence.
    //
    // The export exists (`logs.ts` line ~155). If it is ever removed, this
    // fails and names what to put back.
    expect(
      candidates,
      'logs.ts must export __test.resolveCandidateLogPaths for these tests to mean anything'
    ).toBeTypeOf('function');
  });

  it('probes project mode first, then standalone, then legacy, then the daemon log', () => {
    const result = candidates!('omni/dev/messaging');
    expect(result.length).toBeGreaterThanOrEqual(3);

    // Project-mode path comes first (most specific).
    expect(result[0]).toMatch(/projects[/\\]omni[/\\]dev[/\\]logs[/\\]messaging[/\\]app\.log$/);
    // Standalone directory layout.
    expect(result[1]).toMatch(/logs[/\\]omni\/dev\/messaging[/\\]app\.log$/);
    // Legacy flat layout.
    expect(result[2]).toMatch(/logs[/\\]omni\/dev\/messaging\.log$/);
    // Daemon log fallback last.
    expect(result[result.length - 1]).toMatch(/omnitron\.log$/);
  });

  it('standalone-only app gets standalone + legacy candidates (no project prefix)', () => {
    const result = candidates!('messaging');
    // Three parts not present → no project-mode candidate.
    expect(result.some((p) => p.includes('/projects/'))).toBe(false);
    // Standalone-dir layout present.
    expect(result.some((p) => p.match(/logs[/\\]messaging[/\\]app\.log$/))).toBe(true);
    // Legacy flat present.
    expect(result.some((p) => p.endsWith('logs/messaging.log'))).toBe(true);
  });

  it('all candidate paths are absolute (no relative drift)', () => {
    const result = candidates!('omni/dev/messaging');
    for (const p of result) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });
});
