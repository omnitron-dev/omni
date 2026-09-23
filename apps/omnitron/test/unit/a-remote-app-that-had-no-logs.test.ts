/**
 * A remote app that had no logs.
 *
 * `omnitron logs daos/test/paysys` answered «No log entries found» — and so
 * did `daos/deployed/paysys` — while the master's table held 2 088 of that
 * app's rows from the last hour alone (measured 2026-09-23): the command read
 * the daemon's own capture, and the daemon runs none of a remote stack's
 * apps. A node names what it runs `<project>/deployed/<app>`, so the stack's
 * name has no rows at all; and a second remote stack of the same project
 * syncs rows under the same node-side name from ITS nodes.
 *
 * And a bare `omnitron logs` printed the apps' buffers — 193 paysys and 7
 * storage records out of 200 — where the help promised the daemon's log.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-remote-logs-'));

vi.mock('../../src/config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/defaults.js')>();
  return { ...actual, OMNITRON_HOME: TMP };
});

const row = (message: string, sourceNode: string) => ({
  timestamp: Date.now(),
  app: 'daos/deployed/paysys',
  level: 'warn',
  message,
  data: { sourceNode },
});

vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    whyUnreachable: async () => null,
    // This master runs none of it.
    inspect: async ({ name }: { name: string }) => {
      throw new Error(`App '${name}' not found`);
    },
    getLogs: async ({ name }: { name: string }) =>
      name === 'daos/deployed/paysys'
        ? [row('BTC scan failed: ECONNREFUSED', 'node-test'), row('from another stack', 'node-other')]
        : [],
    service: async (svc: string) =>
      svc === 'OmnitronProject'
        ? {
            getStack: async () => ({
              name: 'test',
              type: 'remote',
              config: { type: 'remote', nodes: [{ host: '37.27.130.185', port: 9700 }] },
            }),
          }
        : {
            listNodes: async () => [
              { id: 'node-test', name: 'daos-test', host: '37.27.130.185' },
              { id: 'node-other', name: 'daos-stage', host: '10.0.0.9' },
            ],
          },
    disconnect: async () => undefined,
  }),
}));

const printed: string[] = [];
vi.mock('@xec-sh/kit', () => ({
  log: { info: (m: string) => printed.push(String(m)) },
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const { logsCommand } = await import('../../src/commands/logs.js');

const consoleLines: string[] = [];
beforeEach(() => {
  printed.length = 0;
  consoleLines.length = 0;
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    consoleLines.push(a.map(String).join(' '));
  });
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('an app on a node is read from what its node synced', () => {
  it('finds the stack\'s app under the node\'s name, from that stack\'s node only', async () => {
    await logsCommand('daos/test/paysys', { lines: 20 });

    const out = consoleLines.join('\n');
    expect(out).toMatch(/BTC scan failed/);
    expect(out, 'another stack\'s node syncs the same name').not.toMatch(/from another stack/);
    expect(printed.join('\n')).toMatch(/runs on its stack's node as daos\/deployed\/paysys/);
    expect(printed.join('\n')).not.toMatch(/No log entries found/);
  });

  it('answers the node\'s own name too, saying which node each record came from', async () => {
    await logsCommand('daos/deployed/paysys', { lines: 20 });

    expect(consoleLines.join('\n')).toMatch(/BTC scan failed/);
    expect(printed.join('\n')).toMatch(/node daos-test/);
  });
});

describe('a bare `omnitron logs` is the daemon\'s own log', () => {
  it('reads omnitron.log, not the apps\' buffers', async () => {
    fs.mkdirSync(path.join(TMP, 'logs'), { recursive: true });
    fs.writeFileSync(
      path.join(TMP, 'logs', 'omnitron.log'),
      `${JSON.stringify({ level: 30, time: Date.now(), msg: 'Daemon started' })}\n`,
    );

    await logsCommand(undefined, { lines: 5 });

    expect(consoleLines.join('\n')).toMatch(/Daemon started/);
  });
});
