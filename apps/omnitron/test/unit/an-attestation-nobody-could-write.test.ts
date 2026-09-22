/**
 * An attestation nobody could write.
 *
 * `StackAttestation` was declared, judged and never produced: the only live
 * caller of `decideStackRelease` passed its fourth argument as `[]`, so a
 * stack declaring `verifiedOn` refused every release for ever, with a
 * refusal that read «nothing has been verified on 'test'» — true, and
 * impossible to change from the outside. This court holds the half that was
 * missing:
 *
 *   - the door (`storeAttestation`) refuses the four ways an attestation can
 *     be about the wrong thing, and keeps the rest;
 *   - what it keeps is read back (`loadAttestations`) and makes the policy say
 *     YES — the branch that could not;
 *   - the transport's pure half reads the producer's exit codes as the
 *     producer defines them, and builds a command the producer accepts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadAttestations, parseAttestation, storeAttestation } from '../../src/release/attest.js';
import { attestationCommand, interpretRun } from '../../src/release/attest-on-node.js';
import { decideStackRelease, type ReleaseManifest } from '../../src/release/manifest.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'attest-court-')));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const RELEASE = 'daos-202609221654-8d2f51e0-225cde48';

function manifest(): ReleaseManifest {
  return {
    id: RELEASE,
    project: { repo: 'gitlab', commit: 'a'.repeat(40), onRemote: true },
    omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: true },
    artifacts: [{ app: 'main', version: '0.0.1', sha256: 'c'.repeat(64), bytes: 10 }],
    gates: [{ name: 'build', status: 'passed' }],
    builtWith: { omnitron: '0.2.0', packages: [] },
    builtAt: '2026-09-22T17:12:02.196Z',
    builtBy: 'court',
  };
}

fs.mkdirSync(path.join(root, RELEASE), { recursive: true });
fs.writeFileSync(path.join(root, RELEASE, 'manifest.json'), JSON.stringify(manifest()));

/** What `scripts/attest.mjs` prints: human words first, one JSON object last. */
function printed(over: Record<string, unknown> = {}): string {
  const object = {
    stack: 'test',
    release: RELEASE,
    at: '2026-09-22T18:00:00.000Z',
    probes: [
      { name: 'revocation-live', outcome: 'passed', ms: 5776, detail: 'signing out on main stops the bytes on storage' },
      { name: 'token-binding-live', outcome: 'passed', ms: 2210 },
    ],
    onNode: { claimed: true, hosts: ['37.27.130.185'], matched: true },
    total: 2,
    passed: 2,
    ok: true,
    ...over,
  };
  return `probing test…\n${JSON.stringify(object)}\n`;
}

describe('the door', () => {
  it('keeps an attestation about this release on this stack', async () => {
    const stored = await storeAttestation(RELEASE, 'test', printed(), { root });
    expect(stored.attestation.gates.map((g) => g.status)).toEqual(['passed', 'passed']);
    expect(fs.existsSync(stored.path)).toBe(true);
  });

  it('refuses one about another stack', async () => {
    await expect(storeAttestation(RELEASE, 'test', printed({ stack: 'dev' }), { root })).rejects.toThrow(
      /about stack 'dev' and was offered for 'test'/,
    );
  });

  it('refuses one that names another release', async () => {
    await expect(
      storeAttestation(RELEASE, 'test', printed({ release: 'daos-202609221512-d3be506a-d5d94e3d' }), { root }),
    ).rejects.toThrow(/names release 'daos-202609221512/);
  });

  it('refuses --on-node that the producer could not confirm — the probes measured the machine they ran on', async () => {
    await expect(
      storeAttestation(RELEASE, 'test', printed({ onNode: { claimed: true, hosts: ['10.0.0.7'], matched: false } }), { root }),
    ).rejects.toThrow(/could not confirm it ran on one/);
  });

  it('keeps an --on-node run the producer could not check either way (a node behind NAT is not a lie)', async () => {
    const stored = await storeAttestation(
      RELEASE,
      'test',
      printed({ onNode: { claimed: true, hosts: [], matched: null } }),
      { root },
    );
    expect(stored.attestation.onNode.matched).toBeNull();
  });

  it('refuses one that finished before the deployment it claims to be about', async () => {
    await expect(
      storeAttestation(RELEASE, 'test', printed({ at: '2026-09-22T17:00:00.000Z' }), {
        root,
        deployedAt: '2026-09-22T17:30:00.000Z',
      }),
    ).rejects.toThrow(/measured a system that has since been replaced/);
  });

  it('refuses one that carries no probes — it measured nothing', async () => {
    await expect(storeAttestation(RELEASE, 'test', printed({ probes: [] }), { root })).rejects.toThrow(/carries no probes/);
  });

  it('records an outcome word it does not know as not-run, and names the word', async () => {
    const stored = await storeAttestation(
      RELEASE,
      'test',
      printed({ probes: [{ name: 'paywall-live', outcome: 'ok' }] }),
      { root },
    );
    expect(stored.attestation.gates[0]).toMatchObject({ status: 'not-run', detail: expect.stringContaining("'ok'") });
  });

  it('finds the last JSON object even when the producer spoke before it', () => {
    expect(parseAttestation('line one\n{"not":"it"}\nnoise\n{"stack":"test"}\n')).toEqual({ stack: 'test' });
    expect(() => parseAttestation('only words\n')).toThrow(/nothing was measured/);
  });
});

describe('the policy that could not say yes', () => {
  const requirements = { mode: 'required' as const, verifiedOn: { stack: 'test', gates: ['revocation-live', 'token-binding-live'] } };

  it('refuses a release nobody has attested — the refusal it gave for ever', () => {
    fs.rmSync(path.join(root, RELEASE, 'attestations'), { recursive: true, force: true });
    const verdict = decideStackRelease(manifest(), requirements, ['main'], loadAttestations(RELEASE, root));
    expect(verdict.action).toBe('refuse');
  });

  it('promotes it once the door has kept a passing attestation', async () => {
    await storeAttestation(RELEASE, 'test', printed(), { root });
    const verdict = decideStackRelease(manifest(), requirements, ['main'], loadAttestations(RELEASE, root));
    expect(verdict).toMatchObject({ action: 'promote' });
  });

  it('does not read a file that names another release as evidence, whatever its file name says', () => {
    const dir = path.join(root, RELEASE, 'attestations');
    fs.writeFileSync(
      path.join(dir, 'prod.json'),
      JSON.stringify({ stack: 'prod', release: 'someone-else', gates: [], at: '', onNode: {}, storedAt: '' }),
    );
    expect(loadAttestations(RELEASE, root).map((a) => a.stack)).toEqual(['test']);
  });
});

describe('the transport, as the producer defines it', () => {
  it('keeps exit 0 and exit 1 — a refused probe is a fact about the release', () => {
    expect(interpretRun({ stdout: '{}', stderr: '', code: 0 })).toMatchObject({ keep: true, allPassed: true });
    expect(interpretRun({ stdout: '{}', stderr: '', code: 1 })).toMatchObject({ keep: true, allPassed: false });
  });

  it('keeps nothing from exit 2 and passes the producer\'s own words on', () => {
    const run = interpretRun({ stdout: '', stderr: 'omnitron.stacks.json is not here', code: 2 });
    expect(run).toMatchObject({ keep: false });
    expect(run.keep === false && run.because).toMatch(/omnitron\.stacks\.json is not here/);
  });

  it('keeps nothing from the transport failing — ssh\'s own 255 is not the producer', () => {
    expect(interpretRun({ stdout: '', stderr: 'Connection reset', code: 255 })).toMatchObject({ keep: false });
  });

  it('hands the stack its own container names and passes no flag the producer would refuse', () => {
    const command = attestationCommand({
      remoteDir: '/opt/omnitron/attest/0123456789abcdef',
      stack: 'test',
      releaseId: RELEASE,
      containerPrefix: 'daos-test',
    });
    expect(command).toContain("DAOS_PG_CONTAINER='daos-test-postgres'");
    expect(command).toContain("DAOS_REDIS_CONTAINER='daos-test-redis'");
    expect(command).toContain('--on-node');
    // The producer's KNOWN list: --stack= --release= --out= --only= --on-node.
    // Anything else is `unknown argument`, exit 2 — which would store nothing.
    const flags = command.match(/--[a-z-]+/g) ?? [];
    for (const flag of flags) expect(['--stack', '--release', '--out', '--only', '--on-node']).toContain(flag);
  });
});
