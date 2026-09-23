/**
 * A deployment whose restarts nobody could see.
 *
 * Between daos-202609230652 and daos-202609230810 the tarball sha256
 * differs for all six apps — a tarball carries its build — and `inputs`,
 * the hash a deployment hands `decideRedeploy`, differs for `main` alone.
 * Deploying 0810 over 0652 on test restarted main and left the other five
 * running («Left running» ×5 at 08:38:35Z). `release show` printed the
 * sha256 and not `inputs`, so what it showed said «six changed» and what the
 * deployment did said one.
 *
 * The court holds: every artifact line carries `inputs`; with the daemon's
 * answer in hand, a release that differs from what another stack of its
 * project runs says which apps carry other inputs — in text and JSON; and
 * with no answer, `inputs` is still printed and the unknown is said.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-inputs-court-')));
const ROOT = path.join(HOME, 'releases');
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

vi.mock('../../src/config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/defaults.js')>();
  return { ...actual, OMNITRON_HOME: HOME };
});

const daemon = { up: true, deployments: [] as unknown[] };

vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 600_000,
  createDaemonClient: () => ({
    whyUnreachable: async () => (daemon.up ? null : { kind: 'stopped' }),
    service: async (name: string) => {
      if (name === 'OmnitronAudit') return { available: async () => ({ available: true }) };
      if (name === 'OmnitronRelease') return { deployments: async () => daemon.deployments };
      throw new Error(`Service '${name}' is not exposed`);
    },
    disconnect: async () => {},
  }),
}));

const said: Array<{ level: string; text: string }> = [];
vi.mock('@xec-sh/kit', () => ({
  log: Object.fromEntries(
    ['info', 'success', 'warn', 'error', 'step', 'message'].map((level) => [level, (m: unknown) => said.push({ level, text: String(m) })]),
  ),
  table: () => undefined,
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const { releaseShowCommand } = await import('../../src/commands/release.js');
const { resetEnvCache, setEnvOverride } = await import('../../src/shared/env-config.js');

const R0652 = 'daos-202609230652-efd85dce-5a3315fc';
const R0810 = 'daos-202609230810-66740d9c-5a3315fc';
const APPS = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
/** The inputs of 0652 and 0810: the same for five apps, not for main. */
const inputsOf = (release: string, app: string) => hash(app === 'main' ? `${release}:main-inputs` : `${app}-inputs`);

function writeRelease(id: string, builtAt: string): void {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
  const artifacts = APPS.map((app) => {
    // Every tarball differs from the other release's: it carries its build.
    const body = Buffer.from(`${id}:${app}`);
    fs.writeFileSync(path.join(dir, 'artifacts', `${app}-0.0.1.tar.gz`), body);
    return { app, version: '0.0.1', sha256: hash(body.toString()), bytes: body.length, inputs: inputsOf(id, app) };
  });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      id,
      project: { repo: 'gitlab', commit: 'a'.repeat(40), onRemote: true },
      omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: true },
      artifacts,
      gates: [{ name: 'build', status: 'passed' }],
      builtWith: { omnitron: '0.2.0', packages: [] },
      builtAt,
      builtBy: 'court',
    }),
  );
}

const testRuns = (release: string) => [
  { project: 'daos', stack: 'test', at: '2026-09-23T07:40:00.000Z', actorId: null, source: 'operator', release, releaseUnnamed: false, projectCommit: null, omniCommit: null },
  { project: 'daos', stack: 'dev', at: '2026-09-23T09:16:35.369Z', actorId: null, source: 'boot', release: null, releaseUnnamed: false, projectCommit: null, omniCommit: null },
];

let stdout: string[] = [];
const exitCodeBefore = process.exitCode;
beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  writeRelease(R0652, '2026-09-23T07:16:00.000Z');
  writeRelease(R0810, '2026-09-23T08:35:51.523Z');
  daemon.up = true;
  daemon.deployments = testRuns(R0652);
  said.length = 0;
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
  process.exitCode = exitCodeBefore;
});

const lineOf = (app: string) => said.find((s) => s.text.includes(`  ${app}@0.0.1 `))?.text ?? '';

describe('show, text', () => {
  it('prints each app’s inputs beside its sha256', async () => {
    await releaseShowCommand(R0810);
    for (const app of APPS) expect(lineOf(app)).toContain(`inputs ${inputsOf(R0810, app).slice(0, 12)}`);
  });

  it('marks the one app whose inputs differ from what test last took, and says what a deployment ships', async () => {
    await releaseShowCommand(R0810);
    expect(lineOf('main')).toContain(`differs from test's ${inputsOf(R0652, 'main').slice(0, 12)}`);
    for (const app of APPS.filter((a) => a !== 'main')) expect(lineOf(app)).toContain("same as test's");
    const summary = said.find((s) => s.text.includes('against test'))?.text ?? '';
    expect(summary).toContain(R0652);
    expect(summary).toContain('1 of 6 app(s) carry other inputs — main');
    // dev runs its working tree: nothing on this disk to compare it with.
    expect(said.some((s) => s.text.includes('against dev'))).toBe(false);
  });

  it('says where it runs instead of comparing it with itself', async () => {
    daemon.deployments = testRuns(R0810);
    await releaseShowCommand(R0810);
    expect(said.some((s) => s.text.includes('deployed on test since 2026-09-23T07:40:00.000Z'))).toBe(true);
    expect(said.some((s) => s.text.includes('against test'))).toBe(false);
  });

  it('still prints inputs when the daemon cannot be asked, and says that the rest is unknown', async () => {
    daemon.up = false;
    await releaseShowCommand(R0810);
    expect(lineOf('main')).toContain(`inputs ${inputsOf(R0810, 'main').slice(0, 12)}`);
    expect(said.find((s) => s.level === 'warn' && s.text.includes('deployed on: unknown'))?.text).toContain('Daemon is not running');
  });
});

describe('show, JSON', () => {
  it('carries the same comparison', async () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    await releaseShowCommand(R0810);
    const data = JSON.parse(stdout.join('').trim()).data;
    expect(data.inputsAgainst).toHaveLength(1);
    expect(data.inputsAgainst[0].stack).toBe('test');
    expect(data.inputsAgainst[0].release).toBe(R0652);
    expect(data.inputsAgainst[0].apps.filter((a: { differs: boolean }) => a.differs).map((a: { app: string }) => a.app)).toEqual(['main']);
    expect(data.deployedOn).toEqual([]);
  });
});
