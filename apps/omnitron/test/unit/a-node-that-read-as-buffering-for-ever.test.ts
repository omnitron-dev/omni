/**
 * A node that read as «Buffering» for ever.
 *
 * The master pulls each slave's sync buffer on its heartbeat sweep, every 15 s
 * by default; `lastSyncAt` is what the pull advances. On the test node,
 * sampled every 10 s (2026-09-23), 275 to 515 entries waited between pulls
 * while `lastSyncAt` moved every 15 s — a node keeping up. The console's
 * stack page read `connected`, the push channel nothing opens, and said
 * «Buffering» in amber whatever the node did.
 */

import { describe, it, expect } from 'vitest';

import { PULL_OVERDUE_MS, inSync, syncFinding, syncWords } from '../../src/shared/sync-reading.js';

const NOW = Date.parse('2026-09-23T13:41:51Z');
const status = (pendingItems: number, lastSyncAgoMs: number | null, connected = false) => ({
  pendingItems,
  lastSyncAt: lastSyncAgoMs === null ? null : NOW - lastSyncAgoMs,
  connected,
});

describe('a node that read as buffering for ever', () => {
  it('is in sync with nothing waiting', () => {
    const finding = syncFinding(status(0, 5_000), NOW);
    expect(finding).toEqual({ state: 'synced' });
    expect(syncWords(finding)).toBe('in sync');
  });

  it('is in sync with the entries since a recent pull waiting', () => {
    const finding = syncFinding(status(515, 18_000), NOW);
    expect(inSync(finding)).toBe(true);
    expect(syncWords(finding)).toBe('in sync · 515 since the last pull');
  });

  it('is behind when entries wait and no pull has come', () => {
    const finding = syncFinding(status(515, PULL_OVERDUE_MS + 30_000), NOW);
    expect(inSync(finding)).toBe(false);
    expect(syncWords(finding)).toBe('behind · 515 waiting, last pull 90 s ago');
    expect(syncWords(syncFinding(status(7, null), NOW))).toBe('behind · 7 waiting, never pulled');
  });

  it('does not read the push channel', () => {
    expect(syncFinding(status(515, 18_000, true), NOW)).toEqual(syncFinding(status(515, 18_000, false), NOW));
    expect(syncFinding(status(515, 600_000, true), NOW).state).toBe('behind');
  });
});
