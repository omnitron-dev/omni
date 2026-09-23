/**
 * A list that could not say which release test runs.
 *
 * `omnitron release list` printed Release, Built, Gates, Apps, Statics, MB.
 * Measured 2026-09-23 on the master: 25 releases on disk; test running
 * daos-202609230810-66740d9c-5a3315fc since 08:38:44Z by its `stack.start`
 * row, which `OmnitronRelease.deployments()` returns; eleven of the 25
 * attested, 0810 on test 31 of 31, which the JSON carried as `verified`. The
 * table had neither fact, and no CLI command printed the first.
 *
 * The court holds:
 *   - each row names the stacks that run it and what each stack measured;
 *   - the JSON says the same (`deployedOn` beside `verified`);
 *   - a daemon that cannot be asked is SAID to be — «?» and a line, never
 *     «—», which means «on no stack» — and that includes the daemon that
 *     answers with no audit trail behind it: it serves `deployments()` as
 *     `[]`, the same shape as «nothing deployed».
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-list-court-')));
const ROOT = path.join(HOME, 'releases');
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

vi.mock('../../src/config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/defaults.js')>();
  return { ...actual, OMNITRON_HOME: HOME };
});

/** The daemon the command reaches: with a trail, without one, or not at all. */
const daemon = {
  state: 'up' as 'up' | 'down' | 'no-trail' | 'trail-off',
  deployments: [] as unknown[],
};

vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 600_000,
  createDaemonClient: () => ({
    whyUnreachable: async () => (daemon.state === 'down' ? { kind: 'stopped' } : null),
    service: async (name: string) => {
      if (name === 'OmnitronAudit') {
        // A daemon whose database did not come up exposes no audit service…
        if (daemon.state === 'no-trail') throw new Error("Service 'OmnitronAudit' is not exposed");
        return { available: async () => ({ available: daemon.state !== 'trail-off' }) };
      }
      if (name === 'OmnitronRelease') {
        // …and answers `deployments()` with `[]`, as `release.rpc-service.ts` does.
        return { deployments: async () => (daemon.state === 'up' ? daemon.deployments : []) };
      }
      throw new Error(`Service '${name}' is not exposed`);
    },
    disconnect: async () => {},
  }),
}));

const said: Array<{ level: string; text: string }> = [];
const tables: Array<{ data: Array<Record<string, string>>; columns: Array<{ key: string; header: string }> }> = [];
vi.mock('@xec-sh/kit', () => ({
  log: Object.fromEntries(
    ['info', 'success', 'warn', 'error', 'step', 'message'].map((level) => [level, (m: unknown) => said.push({ level, text: String(m) })]),
  ),
  table: (options: never) => tables.push(options),
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const { releaseListCommand } = await import('../../src/commands/release.js');
const { resetEnvCache, setEnvOverride } = await import('../../src/shared/env-config.js');

const R0810 = 'daos-202609230810-66740d9c-5a3315fc';
const R0741 = 'daos-202609230741-10904f01-5a3315fc';
const R0652 = 'daos-202609230652-efd85dce-5a3315fc';

/** The live answer of 2026-09-23: test on 0810, dev on its working tree. */
const LIVE = [
  { project: 'daos', stack: 'dev', at: '2026-09-23T09:16:35.369Z', actorId: null, source: 'boot', release: null, releaseUnnamed: false, projectCommit: null, omniCommit: null },
  { project: 'daos', stack: 'test', at: '2026-09-23T08:38:44.297Z', actorId: null, source: 'operator', release: R0810, releaseUnnamed: false, projectCommit: '66740d9c', omniCommit: '5a3315fc' },
];

function writeRelease(id: string, builtAt: string, attested?: { passed: number; total: number }): void {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
  const body = Buffer.from(`${id}:main`);
  fs.writeFileSync(path.join(dir, 'artifacts', 'main-0.0.1.tar.gz'), body);
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      id,
      project: { repo: 'gitlab', commit: 'a'.repeat(40), onRemote: true },
      omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: true },
      artifacts: [{ app: 'main', version: '0.0.1', sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length, inputs: 'c'.repeat(64) }],
      gates: [{ name: 'build', status: 'passed' }],
      builtWith: { omnitron: '0.2.0', packages: [] },
      builtAt,
      builtBy: 'court',
    }),
  );
  if (attested) {
    fs.mkdirSync(path.join(dir, 'attestations'), { recursive: true });
    const gates = Array.from({ length: attested.total }, (_, i) => ({ name: `probe-${i}`, status: i < attested.passed ? 'passed' : 'failed' }));
    fs.writeFileSync(
      path.join(dir, 'attestations', 'test.json'),
      JSON.stringify({ stack: 'test', release: id, gates, at: '2026-09-23T08:39:38.976Z', onNode: { claimed: true, hosts: ['37.27.130.185'], matched: true }, storedAt: '2026-09-23T08:40:00.000Z' }),
    );
  }
}

let stdout: string[] = [];
beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  writeRelease(R0810, '2026-09-23T08:35:51.523Z', { passed: 31, total: 31 });
  writeRelease(R0741, '2026-09-23T08:01:00.000Z');
  writeRelease(R0652, '2026-09-23T07:16:00.000Z', { passed: 31, total: 31 });
  daemon.state = 'up';
  daemon.deployments = LIVE;
  said.length = 0;
  tables.length = 0;
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
});

function rowOf(id: string): Record<string, string> {
  const row = tables.at(-1)?.data.find((r) => r['id'] === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

describe('the table', () => {
  it('names the stack that runs a release, and what each stack measured about it', async () => {
    await releaseListCommand();
    const headers = tables.at(-1)!.columns.map((c) => c.header);
    expect(headers).toContain('Deployed');
    expect(headers).toContain('Attested');
    const deployedKey = tables.at(-1)!.columns.find((c) => c.header === 'Deployed')!.key;
    const attestedKey = tables.at(-1)!.columns.find((c) => c.header === 'Attested')!.key;

    expect(rowOf(R0810)[deployedKey]).toBe('test');
    expect(rowOf(R0810)[attestedKey]).toBe('test: 31/31');
    // Measured on test once, and no longer what test runs.
    expect(rowOf(R0652)[deployedKey]).toBe('—');
    expect(rowOf(R0652)[attestedKey]).toBe('test: 31/31');
    expect(rowOf(R0741)[deployedKey]).toBe('—');
    expect(rowOf(R0741)[attestedKey]).toBe('—');
  });

  it('says it could not ask when the daemon is down — «?», not «on no stack»', async () => {
    daemon.state = 'down';
    await releaseListCommand();
    const deployedKey = tables.at(-1)!.columns.find((c) => c.header === 'Deployed')!.key;
    for (const id of [R0810, R0741, R0652]) expect(rowOf(id)[deployedKey]).toBe('?');
    expect(said.find((s) => s.level === 'warn' && s.text.includes('Deployed: unknown'))?.text).toContain('Daemon is not running');
  });

  it.each(['no-trail', 'trail-off'] as const)(
    'says the same of a daemon that answers from no audit trail (%s) — its `[]` is not «nothing deployed»',
    async (state) => {
      daemon.state = state;
      await releaseListCommand();
      const deployedKey = tables.at(-1)!.columns.find((c) => c.header === 'Deployed')!.key;
      expect(rowOf(R0810)[deployedKey]).toBe('?');
      expect(said.find((s) => s.level === 'warn' && s.text.includes('Deployed: unknown'))?.text).toContain('no audit trail');
    },
  );
});

describe('the JSON', () => {
  function emitted(): { releases: Array<Record<string, unknown>>; deployments: unknown; deploymentsUnknown?: string } {
    const line = stdout.join('').trim().split('\n').at(-1)!;
    return JSON.parse(line).data;
  }

  it('carries where each release runs beside what was measured about it', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    await releaseListCommand();
    const data = emitted();
    const r0810 = data.releases.find((r) => r['id'] === R0810)!;
    expect(r0810['deployedOn']).toEqual([{ stack: 'test', at: '2026-09-23T08:38:44.297Z', source: 'operator' }]);
    expect(r0810['verified']).toEqual([{ stack: 'test', passed: 31, total: 31, at: '2026-09-23T08:39:38.976Z' }]);
    expect(data.releases.find((r) => r['id'] === R0741)!['deployedOn']).toEqual([]);
    expect(data.deployments).toEqual(LIVE);
  });

  it('says `null` and why when the daemon could not be asked — not `[]`', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    daemon.state = 'down';
    await releaseListCommand();
    const data = emitted();
    expect(data.releases.find((r) => r['id'] === R0810)!['deployedOn']).toBeNull();
    expect(data.deployments).toBeNull();
    expect(data.deploymentsUnknown).toContain('Daemon is not running');
  });
});
