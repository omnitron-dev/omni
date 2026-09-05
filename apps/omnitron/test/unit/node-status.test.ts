/**
 * The fleet view's two ways of being confidently wrong.
 *
 * A node list answers one question — is this machine reachable — and the
 * answer is worth exactly as much as its age. Both defects here are of that
 * shape: a reading presented as current that was taken once, long ago, and
 * never refreshed.
 */

import { describe, it, expect } from 'vitest';

import { formatCheckedAt } from '../../src/commands/node.js';
import { NodeManagerService } from '../../src/services/node-manager.service.js';
import { CLI_VERSION } from '../../src/config/defaults.js';

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

/** DaemonStateStore stand-in: an empty registry that accepts writes. */
const emptyStore: any = {
  selectNodesSync: () => [],
  upsertNodeSync: () => {},
  deleteNodeSync: () => {},
  kvGetSync: () => null,
  kvSetSync: () => {},
};

describe('formatCheckedAt', () => {
  it('says "never" when a node has never been checked', () => {
    // The distinction the console could not draw: a node with no status at
    // all looked exactly like one checked a second ago, because neither
    // showed a time.
    expect(formatCheckedAt(undefined)).toBe('never');
    expect(formatCheckedAt('')).toBe('never');
    expect(formatCheckedAt('not a date')).toBe('never');
  });

  it('reports the age at the resolution an operator cares about', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

    expect(formatCheckedAt(ago(5_000))).toBe('just now');
    expect(formatCheckedAt(ago(3 * 60_000))).toBe('3m ago');
    expect(formatCheckedAt(ago(2 * 3_600_000))).toBe('2h ago');
    expect(formatCheckedAt(ago(3 * 86_400_000))).toBe('3d ago');
  });

  it('does not report a negative age from a clock that ran backwards', () => {
    expect(formatCheckedAt(new Date(Date.now() + 60_000).toISOString())).toBe('just now');
  });
});

describe('local node status', () => {
  it('reports the version the daemon is actually running', () => {
    // It was the string literal '0.1.0' while the package was at 0.2.0, and
    // the console renders it in the node tooltip — so the fleet view named a
    // version this daemon has never been.
    const service = new NodeManagerService(silentLogger, emptyStore);
    const local = service.getNode('local');

    expect(local?.status?.omnitronVersion).toBe(CLI_VERSION);
    expect(local?.status?.omnitronVersion).not.toBe('0.1.0');
  });

  it('takes the reading now, not at construction', async () => {
    // `omnitronUptime` and `checkedAt` were written once into a cache in the
    // constructor. The console labels the first "Uptime" and it showed a few
    // seconds no matter how long the daemon had been up.
    const service = new NodeManagerService(silentLogger, emptyStore);

    const first = service.getNode('local')?.status;
    await new Promise((r) => setTimeout(r, 25));
    const second = service.getNode('local')?.status;

    expect(second!.omnitronUptime!).toBeGreaterThan(first!.omnitronUptime!);
    expect(Date.parse(second!.checkedAt)).toBeGreaterThanOrEqual(Date.parse(first!.checkedAt));
  });

  it('reports the running process, not a remembered one', () => {
    const service = new NodeManagerService(silentLogger, emptyStore);
    const local = service.getNode('local');

    expect(local?.status?.omnitronPid).toBe(process.pid);
    expect(local?.status?.omnitronConnected).toBe(true);
    expect(local?.status?.omnitronRole).toBe('master');
  });

  it('gives the local node a status even with an empty registry', () => {
    const service = new NodeManagerService(silentLogger, emptyStore);
    const list = service.listNodes();

    expect(list.map((n) => n.id)).toContain('local');
    expect(list.find((n) => n.id === 'local')?.status).not.toBeNull();
  });
});
