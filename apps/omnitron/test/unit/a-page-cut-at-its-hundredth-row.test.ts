/**
 * A page cut at its hundredth row, and a limit typed as `abc` that reached Postgres.
 *
 * Measured against the master 2026-09-23:
 *
 *   omnitron audit -n 200   42 cells in 39 of the 178 rows cut to `...` — WHEN
 *                           in 37 (`9/22...`), ACTION in 5 (`node.bundle...`).
 *                           kit sizes a column from the FIRST 100 rows
 *                           (`maxSampleSize` in its `column-width.ts`) and
 *                           truncates the rest; the first hundred were all
 *                           «Nm ago» / «Nh ago», the rest `toLocaleString()`.
 *   omnitron audit -n abc   «Failed: invalid input syntax for type bigint:
 *                           "NaN"» — `parseInt('abc')` is NaN, and
 *                           `Math.min(500, Math.max(1, NaN))` is NaN too.
 *   omnitron audit -n 0     one row, exit 0 — the service's clamp.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { AuditService, type AuditQuery, type AuditRow } from '../../src/services/audit.service.js';

const asked: AuditQuery[] = [];
let rows: AuditRow[] = [];
const createDaemonClient = vi.fn(() => ({
  service: async () => ({
    available: async () => ({ available: true }),
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

async function run(options: Parameters<typeof auditListCommand>[0]) {
  const out: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => (out.push(String(chunk)), true));
  process.exitCode = undefined;
  try {
    await auditListCommand(options);
  } finally {
    stdout.mockRestore();
  }
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  return { out: out.join('').replace(ANSI, ''), exitCode };
}

let id = 0;
function row(over: Partial<AuditRow>): AuditRow {
  return {
    id: String(++id),
    action: 'stack.start',
    actorId: null,
    actorType: 'system',
    resourceType: 'stack',
    resourceId: 'daos/dev',
    details: { source: 'boot' },
    ipAddress: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** The table's data lines — the ones between its box rules. */
const dataLines = (out: string) => out.split('\n').filter((l) => l.startsWith('│ ') && !l.startsWith('│ WHEN'));

const logger: Record<string, unknown> = { info() {}, warn() {}, error() {}, debug() {}, child: () => logger };

beforeEach(() => {
  asked.length = 0;
  rows = [];
  createDaemonClient.mockClear();
});

describe('every row of a page is printed whole', () => {
  it('prints WHEN as UTC to the second, the same width on every row', async () => {
    rows = [
      row({ createdAt: new Date(Date.now() - 3 * 60_000).toISOString() }),
      row({ createdAt: '2026-09-20T15:37:31.006Z' }),
    ];

    const { out } = await run({ limit: '2' });

    const whens = dataLines(out).map((l) => l.split('│')[1]!.trim());
    expect(whens).toHaveLength(2);
    for (const when of whens) expect(when).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(whens[1]).toBe('2026-09-20T15:37:31Z');
  });

  it('sizes every column from all of the rows, not the first hundred', async () => {
    // The live page: a hundred recent starts on top, older node rows below.
    rows = [
      ...Array.from({ length: 100 }, (_, i) => row({ createdAt: new Date(Date.now() - (i + 1) * 60_000).toISOString() })),
      ...Array.from({ length: 100 }, (_, i) =>
        row({
          action: 'node.bundle.activate',
          resourceType: 'node',
          resourceId: '16f3dd5a-2727-49e5-90a2-d762b57073f6',
          details: { version: '0.4.1' },
          createdAt: new Date(Date.UTC(2026, 8, 20, 15, 37, 31) - i * 1000).toISOString(),
        }),
      ),
    ];

    const { out } = await run({ limit: '200' });

    const lines = dataLines(out);
    expect(lines).toHaveLength(200);
    expect(out, 'no cell was cut').not.toContain('...');
    expect(lines.filter((l) => l.includes('│ node.bundle.activate ')), 'every older action whole').toHaveLength(100);
    expect(lines.filter((l) => l.includes('node:16f3dd5a-2727-49e5-90a2-d762b57073f6'))).toHaveLength(100);
    expect(lines[199]).toContain('2026-09-20T15:35:52Z');
  });
});

describe('-n is a number of entries, or a refusal that says so', () => {
  for (const typed of ['abc', '0', '5abc', '-3', '2.5', '501']) {
    it(`refuses -n ${typed} before asking the daemon anything`, async () => {
      const { out, exitCode } = await run({ limit: typed });

      expect(createDaemonClient, 'no connection for a typo').not.toHaveBeenCalled();
      expect(out).toContain('-n takes a whole number of entries, 1 to 500');
      expect(out).toContain(`"${typed}"`);
      expect(exitCode).toBe(1);
    });
  }

  it('asks for what was typed when it is one — the control', async () => {
    await run({ limit: '200' });
    expect(asked[0]).toMatchObject({ limit: 200 });

    asked.length = 0;
    await run({});
    expect(asked[0], 'and the default when nothing was').toMatchObject({ limit: 50 });
  });
});

describe('the service does not hand the database a NaN', () => {
  function recordingDb() {
    const limits: unknown[] = [];
    const q: Record<string, unknown> = {
      selectAll: () => q,
      orderBy: () => q,
      where: () => q,
      limit: (n: unknown) => {
        limits.push(n);
        return q;
      },
      execute: async () => [],
    };
    return { limits, db: { selectFrom: () => q } };
  }

  it('refuses a limit that is not a number, by name', async () => {
    const { limits, db } = recordingDb();
    await expect(new AuditService(logger as never, db as never).list({ limit: Number.NaN })).rejects.toThrow(
      /limit is a number of entries/,
    );
    await expect(new AuditService(logger as never, db as never).list({ limit: 'abc' as never })).rejects.toThrow(
      /limit is a number of entries/,
    );
    expect(limits, 'the query never reached the database').toEqual([]);
  });

  it('refuses a `before` that is not a time', async () => {
    const { db } = recordingDb();
    await expect(new AuditService(logger as never, db as never).list({ before: 'yesterday' })).rejects.toThrow(
      /before is an ISO timestamp/,
    );
  });

  it('still clamps the numbers it is given — the control', async () => {
    const { limits, db } = recordingDb();
    await new AuditService(logger as never, db as never).list({ limit: 100_000 });
    await new AuditService(logger as never, db as never).list({});
    expect(limits).toEqual([500, 100]);
  });
});

describe('the CLI hands the flags over as typed', () => {
  // The real entry point, in a process of its own with a home of its own: it
  // cannot reach a daemon, and the answers below come before it would try.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tsx = path.resolve(here, '../../node_modules/.bin/tsx');
  const entry = path.resolve(here, '../../src/cli/omnitron.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omx-audit-cli-'));
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  const cli = (...args: string[]) => {
    const r = spawnSync(tsx, [entry, ...args], {
      env: { PATH: process.env['PATH'] ?? '', HOME: home, OMNITRON_SOCKET: path.join(home, 'no-daemon.sock') },
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { status: r.status, said: `${r.stdout}${r.stderr}`.replace(ANSI, '') };
  };

  it('does not read `-n 5abc` as 5', () => {
    const { status, said } = cli('audit', '-n', '5abc');
    expect(said).toContain('-n takes a whole number of entries');
    expect(status).toBe(1);
  }, 150_000);

  it('takes --before', () => {
    const { status, said } = cli('audit', '--before', '2026-09-22T21:20:37');
    expect(said).toContain('--before needs a zone');
    expect(status).toBe(1);
  }, 150_000);
});
