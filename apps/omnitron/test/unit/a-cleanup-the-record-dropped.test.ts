/**
 * A cleanup the record dropped.
 *
 * 2026-09-25, the first attestation of a release whose probes remove what
 * their run made (daos migration 192, `probe_principals`): `scripts/attest.mjs`
 * printed `cleanup: {run, removed, leftBehind}` — and says why in its own
 * comment, «so "36 of 36" does not hide what the run left behind». The
 * stored attestation had `stack, release, gates, at, onNode, storedAt` and
 * nothing else, and the command printed «35 of 36 probes passed» and no word
 * about the stand. `storeAttestation` kept the probes and dropped the rest of
 * what the producer measured on the node.
 *
 * Held here: the record keeps `cleanup` (in the shape the producer gives it,
 * and nothing else) and `legalTextsUnread`; a producer that predates them
 * leaves none; and both attest paths say what the run removed, what it left
 * and why.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReleaseManifest } from '../../src/release/manifest.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-court-')));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const RELEASE = 'daos-202609250051-6cb85fdd-6308d07e';
const manifest: ReleaseManifest = {
  id: RELEASE,
  project: { repo: 'gitlab', commit: 'a'.repeat(40), onRemote: true },
  omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: false },
  artifacts: [{ app: 'main', version: '0.0.1', sha256: 'c'.repeat(64), bytes: 10 }],
  gates: [{ name: 'build', status: 'passed' }],
  builtWith: { omnitron: '0.2.0', packages: [] },
  builtAt: '2026-09-25T01:23:08.000Z',
  builtBy: 'court',
};
fs.mkdirSync(path.join(root, RELEASE), { recursive: true });
fs.writeFileSync(path.join(root, RELEASE, 'manifest.json'), JSON.stringify(manifest));

const CLEANUP = {
  run: 'attest-20260925T012700.000Z-af0237',
  removed: { accounts: 20, organisations: 4, journalRows: 8, paysysAccounts: 1, identities: 1, rooms: 0, sessions: 30 },
  leftBehind: [{ what: 'organisation Cat Probe Org 17', why: ['its journal holds a binding act'] }],
};

function printed(over: Record<string, unknown> = {}): string {
  return `probing test…\n${JSON.stringify({
    stack: 'test',
    release: RELEASE,
    at: '2026-09-25T01:30:00.000Z',
    probes: [
      { name: 'revocation-live', outcome: 'passed', ms: 5776 },
      { name: 'dead-tables:main', outcome: 'failed', ms: 900 },
    ],
    onNode: { claimed: true, hosts: ['37.27.130.185'], matched: true },
    cleanup: CLEANUP,
    ...over,
  })}\n`;
}

const said: string[] = [];
vi.mock('@xec-sh/kit', () => ({
  log: Object.fromEntries(['info', 'success', 'warn', 'error', 'step', 'message'].map((level) => [level, (m: unknown) => said.push(String(m))])),
  table: () => undefined,
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const daemon = { answer: null as unknown };
vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 600_000,
  createDaemonClient: () => ({
    whyUnreachable: async () => null,
    service: async () => ({ attestOnNode: async () => daemon.answer, attest: async () => daemon.answer }),
    disconnect: async () => {},
  }),
}));

const { storeAttestation, cleanupOf } = await import('../../src/release/attest.js');
const { releaseAttestCommand } = await import('../../src/commands/release.js');

describe('the record keeps what the producer said about the stand', () => {
  it('stores the run\'s cleanup and the unread legal texts beside the probes', async () => {
    const stored = await storeAttestation(RELEASE, 'test', printed({ legalTextsUnread: 'the gateway did not answer' }), { root });
    expect(stored.attestation.cleanup).toEqual(CLEANUP);
    expect(stored.attestation.legalTextsUnread).toBe('the gateway did not answer');
    const onDisk = JSON.parse(fs.readFileSync(stored.path, 'utf8'));
    expect(onDisk.cleanup.removed.accounts).toBe(20);
  });

  it('keeps only the shape it knows — numbers as numbers, reasons as strings', () => {
    expect(
      cleanupOf({ run: 'r1', removed: { accounts: 3, organisations: 'many', sessions: Number.NaN }, leftBehind: [{ what: 'x', why: 'not a list' }], extra: 1 }),
    ).toEqual({ run: 'r1', removed: { accounts: 3 }, leftBehind: [{ what: 'x', why: [] }] });
    expect(cleanupOf({ run: null, notRun: 'the run had no name' })).toEqual({ run: null, notRun: 'the run had no name' });
    expect(cleanupOf({ removed: { accounts: 1 } })).toBeUndefined();
    expect(cleanupOf('text')).toBeUndefined();
  });

  it('adds nothing for a producer that predates it', async () => {
    const stored = await storeAttestation(RELEASE, 'test', printed({ cleanup: undefined }), { root });
    expect('cleanup' in stored.attestation).toBe(false);
    expect('legalTextsUnread' in stored.attestation).toBe(false);
  });
});

describe('the command says what the run left', () => {
  beforeEach(() => {
    said.length = 0;
    process.exitCode = 0;
  });

  it('--on-node: removed per kind, and each thing left behind with its reason', async () => {
    daemon.answer = {
      path: `${root}/${RELEASE}/attestations/test.json`,
      gates: 36,
      passed: 35,
      node: '37.27.130.185:22',
      scriptsFrom: 'release',
      sourceFiles: 2635,
      accounts: 'provisioned',
      cleanup: CLEANUP,
    };
    await releaseAttestCommand(RELEASE, { stack: 'test', onNode: true });
    const out = said.join('\n');
    expect(out).toMatch(/cleanup: run attest-20260925T012700\.000Z-af0237 removed 20 accounts, 4 organisations, 8 journalRows, 1 paysysAccounts, 1 identities, 30 sessions/);
    expect(out).toMatch(/left behind: organisation Cat Probe Org 17 — its journal holds a binding act/);
  });

  it('says so when the removal failed, and when there was no run to remove by', async () => {
    daemon.answer = { path: 'p', gates: 1, passed: 1, node: 'n', scriptsFrom: 'release', sourceFiles: 1, accounts: 'provisioned', cleanup: { run: 'r2', removed: {}, failed: 'docker did not answer' } };
    await releaseAttestCommand(RELEASE, { stack: 'test', onNode: true });
    daemon.answer = { path: 'p', gates: 1, passed: 1, node: 'n', scriptsFrom: 'release', sourceFiles: 1, accounts: 'provisioned', cleanup: { run: null, notRun: 'the producer ran without a run name' } };
    await releaseAttestCommand(RELEASE, { stack: 'test', onNode: true });
    const out = said.join('\n');
    expect(out).toMatch(/cleanup: run r2 removed nothing — it had made nothing to remove — FAILED: docker did not answer/);
    expect(out).toMatch(/cleanup: not run — the producer ran without a run name/);
  });
});
