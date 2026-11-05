/** Deployment history and attestations remain useful without claiming current execution. */

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
  stacks: [] as unknown[],
  inventoryUnavailable: false,
  disconnected: 0,
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
      if (name === 'OmnitronProject') return { listStacks: async () => {
        if (daemon.inventoryUnavailable) throw new Error('unavailable');
        return daemon.stacks;
      } };
      if (name === 'OmnitronRelease') {
        // …and answers `deployments()` with `[]`, as `release.rpc-service.ts` does.
        return { deployments: async () => (daemon.state === 'up' ? daemon.deployments : []) };
      }
      throw new Error(`Service '${name}' is not exposed`);
    },
    disconnect: async () => { daemon.disconnected++; },
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

const { releaseListCommand, releaseStatusCommand } = await import('../../src/commands/release.js');
const { resetEnvCache, setEnvOverride } = await import('../../src/shared/env-config.js');

const R0810 = 'sample-202609230810-66740d9c-5a3315fc';
const R0741 = 'sample-202609230741-10904f01-5a3315fc';
const R0652 = 'sample-202609230652-efd85dce-5a3315fc';

/** The live answer of 2026-09-23: test on 0810, dev on its working tree. */
const LIVE = [
  { project: 'sample', stack: 'dev', at: '2026-09-23T09:16:35.369Z', actorId: null, source: 'boot', release: null, releaseUnnamed: false, projectCommit: null, omniCommit: null },
  { project: 'sample', stack: 'test', at: '2026-09-23T08:38:44.297Z', actorId: null, source: 'operator', release: R0810, releaseUnnamed: false, projectCommit: '66740d9c', omniCommit: '5a3315fc' },
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
  daemon.stacks = [];
  daemon.inventoryUnavailable = false;
  daemon.disconnected = 0;
  process.exitCode = 0;
  said.length = 0;
  tables.length = 0;
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  resetEnvCache();
});

function rowOf(id: string): Record<string, string> {
  const row = tables.at(-1)?.data.find((r) => r['id'] === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

describe('the table', () => {
  it('names the last recorded deployment and what each stack measured', async () => {
    await releaseListCommand();
    const headers = tables.at(-1)!.columns.map((c) => c.header);
    expect(headers).toContain('Last deployed');
    expect(headers).toContain('Attested');
    const deployedKey = tables.at(-1)!.columns.find((c) => c.header === 'Last deployed')!.key;
    const attestedKey = tables.at(-1)!.columns.find((c) => c.header === 'Attested')!.key;

    expect(rowOf(R0810)[deployedKey]).toBe('test');
    expect(rowOf(R0810)[attestedKey]).toBe('test: 31/31');
    // Measured on test once, but not its latest recorded deployment.
    expect(rowOf(R0652)[deployedKey]).toBe('—');
    expect(rowOf(R0652)[attestedKey]).toBe('test: 31/31');
    expect(rowOf(R0741)[deployedKey]).toBe('—');
    expect(rowOf(R0741)[attestedKey]).toBe('—');
  });

  it('says it could not ask when the daemon is down — «?», not «on no stack»', async () => {
    daemon.state = 'down';
    await releaseListCommand();
    const deployedKey = tables.at(-1)!.columns.find((c) => c.header === 'Last deployed')!.key;
    for (const id of [R0810, R0741, R0652]) expect(rowOf(id)[deployedKey]).toBe('?');
    expect(said.find((s) => s.level === 'warn' && s.text.includes('Deployment history: unknown'))?.text).toContain('Daemon is not running');
  });

  it.each(['no-trail', 'trail-off'] as const)(
    'says the same of a daemon that answers from no audit trail (%s) — its `[]` is not «nothing deployed»',
    async (state) => {
      daemon.state = state;
      await releaseListCommand();
      const deployedKey = tables.at(-1)!.columns.find((c) => c.header === 'Last deployed')!.key;
      expect(rowOf(R0810)[deployedKey]).toBe('?');
      expect(said.find((s) => s.level === 'warn' && s.text.includes('Deployment history: unknown'))?.text).toContain('cannot read the deployment audit history');
    },
  );
});

describe('the JSON', () => {
  function emitted(): { releases: Array<Record<string, unknown>>; deployments: unknown; deploymentsUnknown?: string } {
    const line = stdout.join('').trim().split('\n').at(-1)!;
    return JSON.parse(line).data;
  }

  it('carries deployment history beside measurements', async () => {
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


describe('current status', () => {
  it.each([['launch-1', 0], ['stale-launch', 2]] as const)('uses owner generation %s for a worker-only launch and exits %s', async (generation, exitCode) => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    daemon.stacks = [{ name: 'test', type: 'local', status: 'running', nodes: [], apps: [{
      name: 'mail', status: 'online', pid: null, generation, release: { state: 'confirmed', releaseId: 'sample-current',
        manifestSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64), launchId: 'launch-1',
        observedAt: '2026-11-05T00:00:00Z', basis: 'verified-launch' },
    }] }];
    await releaseStatusCommand('sample');
    const state = JSON.parse(stdout.join('').trim()).data.stacks[0];
    expect(state.runningRelease).toBe(exitCode === 0 ? 'confirmed' : 'unreported');
    expect(state.releaseEvidence.observations[0]).toMatchObject({ app: 'mail', pid: null, generation });
    expect(process.exitCode).toBe(exitCode);
  });

  it('keeps historical deployment separate from current processes in JSON and closes one shared client', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    daemon.stacks = [
      { name: 'dev', type: 'local', status: 'stopped', apps: [{ status: 'stopped' }], nodes: [] },
      { name: 'test', type: 'remote', status: 'running', apps: [{ status: 'online' }], nodes: [] },
    ];
    await releaseStatusCommand('sample');
    const data = JSON.parse(stdout.join('').trim()).data;
    expect(data.stacks[0]).toMatchObject({ runningRelease: 'not-running', apps: { online: 0, total: 1 } });
    expect(data.stacks[1]).toMatchObject({ runningRelease: 'unreported', history: { last: { release: R0810 } } });
    expect(process.exitCode).toBe(2);
    expect(daemon.disconnected).toBe(1);
  });

  it('reports incomplete inventory even when readable history remains', async () => {
    daemon.inventoryUnavailable = true;
    await releaseStatusCommand('sample');
    expect(said.some(row => row.level === 'warn' && row.text.includes('execution state is unknown'))).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(daemon.disconnected).toBe(1);
  });

  it('reports a fully stopped observed stack without treating its history as current', async () => {
    daemon.stacks = [{ name: 'test', type: 'remote', status: 'stopped', apps: [{ status: 'stopped' }], nodes: [] }];
    await releaseStatusCommand('sample');
    expect(said.some(row => row.text.includes('No applications running'))).toBe(true);
    expect(said.some(row => row.text.includes(`last recorded deployment: ${R0810}`))).toBe(true);
    expect(process.exitCode).toBe(0);
  });
});
