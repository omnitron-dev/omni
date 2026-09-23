/**
 * A daemon's memory that was the apps' memory.
 *
 * `totalMemory` is the apps' memory plus the daemon's RSS, and the console
 * showed it as each of the two. Read apart — from the fields a newer daemon
 * sends, or, from an older one, as what the other part leaves of the total.
 */

import { describe, it, expect } from 'vitest';

import { appsMemoryOf, daemonMemoryOf } from './daemon-memory';

const MB = 1024 * 1024;
const apps = [{ memory: 300 * MB }, { memory: 200 * MB }] as never;

describe('a daemon’s memory that was the apps’ memory', () => {
  it('takes each part as the daemon says it', () => {
    const status = { apps, totalMemory: 860 * MB, daemonMemory: 360 * MB, appsMemory: 500 * MB };
    expect(daemonMemoryOf(status)).toBe(360 * MB);
    expect(appsMemoryOf(status)).toBe(500 * MB);
  });

  it('reads an older daemon, which sends only the total, as the same two parts', () => {
    const status = { apps, totalMemory: 860 * MB };
    expect(daemonMemoryOf(status)).toBe(360 * MB);
    expect(appsMemoryOf(status)).toBe(500 * MB);
  });

  it('never gives the total as the daemon’s own', () => {
    expect(daemonMemoryOf({ apps, totalMemory: 860 * MB })).not.toBe(860 * MB);
  });
});
