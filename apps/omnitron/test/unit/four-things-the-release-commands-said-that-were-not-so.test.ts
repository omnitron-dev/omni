/**
 * Four things the release commands said that were not so.
 *
 * Each measured on the master's releases of 2026-09-22/23:
 *
 *   1. `gates.notRun` counted every outcome that was neither passed nor
 *      failed. daos-202609230557's `unit:paysys` RAN and timed out, and the
 *      JSON said `notRun: 1` — the one thing `manifest.ts` keeps apart.
 *   2. A build with `--skip-gates` records one outcome, `gates: not-run`, and
 *      the list printed it as «0/1» — what one failed gate reads as too
 *      (daos-202609221438).
 *   3. `release show` of a directory with no manifest said «No release 'X'
 *      on this machine», then «X exists (0.1 MB) and holds no manifest»
 *      (daos-202609221632) — two statements, the first false.
 *   4. The same screen printed a 41 054-byte log as «0.0 MB».
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-untruths-court-')));
const ROOT = path.join(HOME, 'releases');
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

vi.mock('../../src/config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/defaults.js')>();
  return { ...actual, OMNITRON_HOME: HOME };
});

vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 600_000,
  createDaemonClient: () => ({
    whyUnreachable: async () => null,
    service: async (name: string) => {
      if (name === 'OmnitronAudit') return { available: async () => ({ available: true }) };
      if (name === 'OmnitronRelease') return { deployments: async () => [] };
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

const { releaseListCommand, releaseShowCommand } = await import('../../src/commands/release.js');
const { listReleases } = await import('../../src/release/store.js');

function writeManifest(id: string, builtAt: string, gates: unknown[]): void {
  fs.mkdirSync(path.join(ROOT, id), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, id, 'manifest.json'),
    JSON.stringify({
      id,
      project: { repo: 'gitlab', commit: 'a'.repeat(40) },
      omni: { repo: 'github', commit: 'b'.repeat(40) },
      artifacts: [],
      gates,
      builtWith: { omnitron: '0.2.0', packages: [] },
      builtAt,
      builtBy: 'court',
    }),
  );
}

const exitCodeBefore = process.exitCode;
beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  said.length = 0;
  tables.length = 0;
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = exitCodeBefore;
});

describe('1. a timed-out gate is not a gate that did not run', () => {
  it('counts each outcome word under its own name', () => {
    const id = 'daos-202609230557-367f5cc7-f9e17151';
    writeManifest(id, '2026-09-23T06:23:00.000Z', [
      { name: 'build', status: 'passed' },
      { name: 'unit:paysys', status: 'timed-out', detail: 'file failed, 0 tests failed — ETIMEDOUT' },
      { name: 'unit:main', status: 'killed' },
      { name: 'scans', status: 'not-run' },
      { name: 'lint', status: 'failed' },
    ]);
    expect(listReleases(ROOT)[0]!.gates).toEqual({ total: 5, passed: 1, failed: 1, notRun: 1, timedOut: 1, killed: 1 });
  });
});

describe('2. a build that ran no gate', () => {
  it('reads «skipped» for --skip-gates and «not run» for any other reason — never «0/1»', async () => {
    writeManifest('daos-202609221438-6c62b7ae-09d95ed2', '2026-09-22T14:40:00.000Z', [
      { name: 'gates', status: 'not-run', detail: 'skipped by --skip-gates' },
    ]);
    writeManifest('daos-202609221439-6c62b7ae-09d95ed2', '2026-09-22T14:41:00.000Z', [
      { name: 'gates', status: 'not-run', detail: 'scripts/gates.mjs does not exist at 6c62b7ae' },
    ]);
    // One gate that ran and failed: THIS is «0/1».
    writeManifest('daos-202609221440-6c62b7ae-09d95ed2', '2026-09-22T14:53:00.000Z', [{ name: 'unit:geo', status: 'failed' }]);
    await releaseListCommand();
    const gatesKey = tables.at(-1)!.columns.find((c) => c.header === 'Gates')!.key;
    const cell = (id: string) => tables.at(-1)!.data.find((r) => r['id'] === id)![gatesKey];
    expect(cell('daos-202609221438-6c62b7ae-09d95ed2')).toBe('skipped');
    expect(cell('daos-202609221439-6c62b7ae-09d95ed2')).toBe('not run');
    expect(cell('daos-202609221440-6c62b7ae-09d95ed2')).toBe('0/1');
  });

  it('is «none ran» on the release’s own page too, not «0 of 1 passed»', async () => {
    writeManifest('daos-202609221438-6c62b7ae-09d95ed2', '2026-09-22T14:40:00.000Z', [
      { name: 'gates', status: 'not-run', detail: 'skipped by --skip-gates' },
    ]);
    await releaseShowCommand('daos-202609221438-6c62b7ae-09d95ed2');
    expect(said.some((s) => s.text === '  gates: none ran')).toBe(true);
    expect(said.some((s) => s.text.includes('0 of 1 passed'))).toBe(false);
  });
});

describe('3 and 4. a build that did not finish, shown', () => {
  const id = 'daos-202609221632-35e18484-d5d41aa0';
  const LOGS: Record<string, number> = {
    'build-omni.log': 41_054,
    'build-project-packages.log': 1_139,
    'clone.log': 900,
    'gates.log': 481,
    'install-omni.log': 4_977,
    'install-project.log': 3_090,
  };

  beforeEach(() => {
    fs.mkdirSync(path.join(ROOT, id, 'logs'), { recursive: true });
    for (const [name, bytes] of Object.entries(LOGS)) fs.writeFileSync(path.join(ROOT, id, 'logs', name), 'x'.repeat(bytes));
  });

  it('is said once: a build that did not finish, not «no release» and then «it exists»', async () => {
    await releaseShowCommand(id);
    const errors = said.filter((s) => s.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.text).toContain('its build did not finish');
    expect(said.some((s) => s.text.includes('No release'))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('prints a log of 41 054 bytes in KB, not as «0.0 MB»', async () => {
    await releaseShowCommand(id);
    expect(said.find((s) => s.text.includes('logs/build-omni.log'))?.text).toContain('40.1 KB');
    expect(said.find((s) => s.text.includes('logs/gates.log'))?.text).toContain('0.5 KB');
    expect(said.some((s) => s.text.includes('0.0 MB'))).toBe(false);
  });
});
