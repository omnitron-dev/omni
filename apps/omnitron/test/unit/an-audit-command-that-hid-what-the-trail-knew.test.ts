/**
 * `omnitron audit` hid what the trail knew, and could not be asked for most of it.
 *
 * Measured against the master 2026-09-23 (the trail up to 09:16:35Z, 178 rows):
 *
 *   - 73 of the 79 `stack.start` rows carry `details.source` — 44 `boot`, 28
 *     `operator` — and 16 carry `details.release`; the command printed
 *     neither, so a boot autostart and a deployment someone typed were the
 *     same line;
 *   - there was no way to see how anything ended;
 *   - `--actor system` answered «Nothing recorded yet» over 171 `system`
 *     rows: it compared the word with `actorId`, which those rows do not have;
 *   - `--json` exited 2 — «`audit` does not support --json» — after printing
 *     the table anyway;
 *   - the service could page (`before`), and the command could not ask it to.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AuditQuery, AuditRow } from '../../src/services/audit.service.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const asked: AuditQuery[] = [];
let rows: AuditRow[] = [];
let available = true;
const createDaemonClient = vi.fn(() => ({
  service: async () => ({
    available: async () => ({ available }),
    list: async (q: AuditQuery) => {
      asked.push(q);
      return rows;
    },
  }),
  disconnect: async () => {},
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient }));

const { auditListCommand } = await import('../../src/commands/audit.js');

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** Run the command; what it wrote, and the exit code it set. */
async function run(options: Parameters<typeof auditListCommand>[0]) {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => (out.push(String(chunk)), true));
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => (err.push(String(chunk)), true));
  process.exitCode = undefined;
  try {
    await auditListCommand(options);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  return { out: out.join('').replace(ANSI, ''), err: err.join('').replace(ANSI, ''), exitCode };
}

let id = 0;
function row(over: Partial<AuditRow>): AuditRow {
  return {
    id: String(++id),
    action: 'stack.start',
    actorId: null,
    actorType: 'system',
    resourceType: 'stack',
    resourceId: 'daos/test',
    details: null,
    ipAddress: null,
    createdAt: '2026-09-22T21:20:37.512Z',
    ...over,
  };
}

/** The table line that mentions `needle`. */
const lineWith = (out: string, needle: string) => out.split('\n').find((l) => l.includes(needle)) ?? '';

beforeEach(() => {
  asked.length = 0;
  rows = [];
  available = true;
  createDaemonClient.mockClear();
});

afterEach(() => resetEnvCache());

describe('a boot autostart does not read like a deployment', () => {
  beforeEach(() => {
    rows = [
      row({
        resourceId: 'daos/test',
        actorId: 'omnitron-local',
        actorType: 'user',
        createdAt: '2026-09-22T21:20:37.512Z',
        details: { source: 'operator', release: 'daos-202609230810-66740d9c-5a3315fc', outcome: 'ok' },
      }),
      row({
        action: 'stack.start.failed',
        resourceId: 'daos/test',
        actorId: 'omnitron-local',
        actorType: 'user',
        createdAt: '2026-09-22T21:19:02.114Z',
        details: {
          source: 'operator',
          outcome: 'failed',
          error: 'Deployment to 37.27.130.185:9700 failed for 6 of 6 app(s): priceverse, main, storage, messaging, geo, paysys.',
        },
      }),
      row({ resourceId: 'daos/dev', createdAt: '2026-09-22T20:50:11.000Z', details: { source: 'boot', type: 'local', outcome: 'ok' } }),
    ];
  });

  it('prints who started it, from which release, and how it ended', async () => {
    const { out } = await run({});

    const header = lineWith(out, 'WHEN');
    for (const column of ['SOURCE', 'RELEASE', 'OUTCOME']) expect(header, column).toContain(column);

    const boot = lineWith(out, 'stack:daos/dev');
    expect(boot).toMatch(/\bsystem\b/);
    expect(boot).toMatch(/\bboot\b/);

    const deployed = lineWith(out, 'daos-202609230810-66740d9c-5a3315fc');
    expect(deployed).toMatch(/\boperator\b/);
    expect(deployed).toContain('omnitron-local');
    expect(deployed).toMatch(/\bok\b/);
  });

  it('shows the failure, and why', async () => {
    const { out } = await run({});

    expect(lineWith(out, 'stack.start.failed')).toMatch(/\bfailed\b/);
    expect(out).toContain('Deployment to 37.27.130.185:9700 failed for 6 of 6 app(s)');
  });

  it('reads an older failure named in its action as a failure — `node.upgrade.failed`', async () => {
    rows = [row({ action: 'node.upgrade.failed', resourceType: 'node', resourceId: '16f3dd5a', details: { version: '0.4.1', message: 'bundle checksum mismatch' } })];
    const { out } = await run({});

    expect(lineWith(out, 'node.upgrade.failed')).toMatch(/\bfailed\b/);
    expect(out).toContain('bundle checksum mismatch');
  });
});

describe('--actor takes what the ACTOR column prints', () => {
  it('asks for a kind of actor by its kind', async () => {
    for (const kind of ['system', 'service', 'user']) {
      asked.length = 0;
      await run({ actor: kind });
      expect(asked[0], kind).toMatchObject({ actorType: kind });
      expect(asked[0], kind).not.toHaveProperty('actorId');
    }
  });

  it('asks for anything else by id — the control', async () => {
    await run({ actor: 'omnitron-local' });
    expect(asked[0]).toMatchObject({ actorId: 'omnitron-local' });
    expect(asked[0]).not.toHaveProperty('actorType');

    asked.length = 0;
    await run({ actor: '8c818e98-a0e2-4356-98ea-3263c64df4ab' });
    expect(asked[0]).toMatchObject({ actorId: '8c818e98-a0e2-4356-98ea-3263c64df4ab' });
  });
});

describe('--json', () => {
  it('answers with the rows, each saying how it ended', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    rows = [
      row({ details: { source: 'operator', outcome: 'ok' } }),
      row({ action: 'stack.start.failed', details: { source: 'operator', outcome: 'failed', error: 'x' } }),
      row({ action: 'secret.read', resourceType: 'secret', resourceId: 'db.password' }),
    ];

    const { out, exitCode } = await run({});

    const answer = JSON.parse(out.trim());
    expect(answer.ok).toBe(true);
    expect(answer.data.available).toBe(true);
    expect(answer.data.entries.map((e: { outcome: string | null }) => e.outcome)).toEqual(['ok', 'failed', null]);
    expect(answer.data.entries[0].createdAt, 'the exact instant, for --before').toBe('2026-09-22T21:20:37.512Z');
    expect(exitCode ?? 0).toBe(0);
  });

  it('says so in JSON when there is no trail to read', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    available = false;

    const { out } = await run({});

    expect(JSON.parse(out.trim())).toEqual({ ok: true, data: { available: false, entries: [] } });
  });

  it('refuses a bad flag in JSON too, and fails', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });

    const { err, out, exitCode } = await run({ limit: 'abc' });

    expect(out).toBe('');
    expect(JSON.parse(err.trim())).toMatchObject({ ok: false, error: expect.stringContaining('-n') });
    expect(exitCode).toBe(1);
  });
});

describe('--before pages the trail', () => {
  it('asks the service for the rows older than the instant given', async () => {
    await run({ before: '2026-09-22T21:20:37Z' });
    expect(asked[0]).toMatchObject({ before: '2026-09-22T21:20:37.000Z' });
  });

  it('names the instant to page from when the page is full', async () => {
    rows = [row({ createdAt: '2026-09-22T21:20:37.512Z' }), row({ createdAt: '2026-09-22T21:19:02.114Z' })];

    const { out } = await run({ limit: '2' });

    // Exact to the millisecond: the WHEN column's second would skip a row
    // that shares it.
    expect(out).toContain('--before 2026-09-22T21:19:02.114Z');
  });

  it('refuses a time with no zone rather than reading it in this machine’s', async () => {
    const { out, exitCode } = await run({ before: '2026-09-22T21:20:37' });

    expect(createDaemonClient).not.toHaveBeenCalled();
    expect(out).toContain('--before needs a zone');
    expect(exitCode).toBe(1);
  });

  it('refuses what is not a time', async () => {
    const { out, exitCode } = await run({ before: 'yesterday' });

    expect(createDaemonClient).not.toHaveBeenCalled();
    expect(out).toContain('--before takes an ISO time');
    expect(exitCode).toBe(1);
  });
});
