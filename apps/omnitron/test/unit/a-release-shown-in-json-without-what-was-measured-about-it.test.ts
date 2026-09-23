/**
 * A release shown in JSON without what was measured about it.
 *
 * `omnitron release show <id>` prints, after the manifest, the two things
 * measured since it was written: «6 artifact file(s) on this disk match the
 * manifest» and «attested on test: 31 of 31 probes passed». Under `--json`
 * the command emitted the manifest and returned BEFORE reading either —
 * measured on daos-202609230810, the JSON held id, project, omni, artifacts,
 * gates, machine, builtWith, builtAt, builtBy, statics, and no attestation.
 *
 * And an error in JSON mode read as a missing feature: for an id that is
 * not there, `log.error` printed «■ No release…» on stdout, nothing
 * machine-readable was written, and the guard added «`release show` does
 * not support --json» on stderr, exit 1 — about a command that does.
 *
 * The court holds: the JSON carries `verifiedFiles` and `attestations`; an
 * error is one JSON object on stderr with nothing on stdout.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-show-json-court-')));
const ROOT = path.join(HOME, 'releases');
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

vi.mock('../../src/config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/defaults.js')>();
  return { ...actual, OMNITRON_HOME: HOME };
});

vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 600_000,
  createDaemonClient: () => ({
    whyUnreachable: async () => ({ kind: 'stopped' }),
    service: async () => {
      throw new Error('not reachable');
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

const ID = 'daos-202609230810-66740d9c-5a3315fc';
const APPS = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];

function writeRelease(): void {
  const dir = path.join(ROOT, ID);
  fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
  const artifacts = APPS.map((app) => {
    const body = Buffer.from(`${ID}:${app}`);
    fs.writeFileSync(path.join(dir, 'artifacts', `${app}-0.0.1.tar.gz`), body);
    return { app, version: '0.0.1', sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length, inputs: crypto.createHash('sha256').update(app).digest('hex') };
  });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      id: ID,
      project: { repo: 'gitlab', commit: 'a'.repeat(40), onRemote: false },
      omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: false },
      artifacts,
      gates: [{ name: 'build', status: 'passed' }],
      builtWith: { omnitron: '0.2.0', packages: [] },
      builtAt: '2026-09-23T08:35:51.523Z',
      builtBy: 'court',
    }),
  );
  fs.mkdirSync(path.join(dir, 'attestations'), { recursive: true });
  const gates = Array.from({ length: 31 }, (_, i) => ({ name: `probe-${i}`, status: 'passed' }));
  fs.writeFileSync(
    path.join(dir, 'attestations', 'test.json'),
    JSON.stringify({ stack: 'test', release: ID, gates, at: '2026-09-23T08:39:38.976Z', onNode: { claimed: true, hosts: ['37.27.130.185'], matched: true }, storedAt: '2026-09-23T08:40:00.000Z' }),
  );
}

let stdout: string[] = [];
let stderr: string[] = [];
const exitCodeBefore = process.exitCode;
beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  writeRelease();
  said.length = 0;
  stdout = [];
  stderr = [];
  process.exitCode = undefined;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
  process.exitCode = exitCodeBefore;
});

describe('show --json', () => {
  it('carries the files checked on this disk and every stack attestation, as the text does', async () => {
    await releaseShowCommand(ID);
    const data = JSON.parse(stdout.join('').trim()).data;
    expect(data.id).toBe(ID);
    expect(data.verifiedFiles.map((f: { app: string }) => f.app)).toEqual(APPS);
    for (const f of data.verifiedFiles) {
      expect(f.sha256).toBe(data.artifacts.find((a: { app: string }) => a.app === f.app).sha256);
    }
    expect(data.attestations).toHaveLength(1);
    expect(data.attestations[0].stack).toBe('test');
    expect(data.attestations[0].gates.filter((g: { status: string }) => g.status === 'passed')).toHaveLength(31);
    expect(process.exitCode).toBeUndefined();
  });

  it('answers an id that is not there with one JSON error on stderr, and nothing on stdout', async () => {
    await releaseShowCommand('daos-nope');
    expect(stdout.join('')).toBe('');
    // What the TUI logger would have printed is not the answer.
    expect(said.filter((s) => s.level === 'error')).toEqual([]);
    const lines = stderr.join('').trim().split('\n');
    expect(lines).toHaveLength(1);
    const error = JSON.parse(lines[0]!);
    expect(error.ok).toBe(false);
    expect(error.error).toContain("No release 'daos-nope'");
    expect(process.exitCode).toBe(1);
  });

  it('answers a build that did not finish the same way, with what it left', async () => {
    const unfinished = 'daos-202609221632-35e18484-d5d41aa0';
    fs.mkdirSync(path.join(ROOT, unfinished, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, unfinished, 'logs', 'build-omni.log'), 'x'.repeat(41_054));
    await releaseShowCommand(unfinished);
    expect(stdout.join('')).toBe('');
    const error = JSON.parse(stderr.join('').trim());
    expect(error.ok).toBe(false);
    expect(error.error).toContain('its build did not finish');
    expect(error.logs).toEqual([{ name: 'build-omni.log', bytes: 41_054 }]);
    expect(process.exitCode).toBe(1);
  });
});
