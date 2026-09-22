/**
 * What earns a release the right to reach the one test server.
 *
 * The rule under test is a single sentence with a measured cost behind it:
 * a gate that did not run is not a gate that passed. Measured 2026-09-22,
 * `daos` carries a 310-line GitHub Actions workflow whose own docblock says
 * «every PR + every push to main runs the full guard rail — typecheck, lint,
 * unit tests, AND the integration tests», and the repository lives on a
 * self-hosted GitLab with no runner and no `.gitlab-ci.yml`. Nothing in that
 * file has ever run. Under «no gate failed» that reads as green.
 *
 * So absence is a refusal here, in three forms that a weaker rule would let
 * through: a gate missing from the release, a gate that reports `not-run`,
 * and an artifact that is present by name and empty by size.
 */

import { describe, it, expect } from 'vitest';

import {
  decideRelease,
  type ReleaseManifest,
  type StackReleasePolicy,
} from '../../src/release/manifest.js';

const SHA = 'a'.repeat(64);
const SIX = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];

function release(over: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    id: 'r-0001',
    project: { repo: 'https://gitlab.ry.ht/dao/daos.git', commit: '0fb3849e' },
    omni: { repo: 'git@github.com:omnitron-dev/omni.git', commit: 'b05ab316' },
    artifacts: SIX.map((app) => ({ app, version: '0.0.1', sha256: SHA, bytes: 4_194_304 })),
    gates: [
      { name: 'typecheck', status: 'passed' },
      { name: 'scans', status: 'passed' },
      { name: 'unit', status: 'passed' },
    ],
    builtWith: { omnitron: '0.2.0', packages: [{ name: '@omnitron-dev/titan', distBuiltAt: '2026-09-22T10:05:00Z' }] },
    builtAt: '2026-09-22T11:00:00Z',
    builtBy: 'master',
    ...over,
  };
}

const TEST_POLICY: StackReleasePolicy = {
  requiredGates: ['typecheck', 'scans', 'unit'],
  requiredApps: SIX,
};

describe('a release reaching the test stack', () => {
  it('is promoted when every required gate ran and passed', () => {
    const d = decideRelease(release(), TEST_POLICY);

    expect(d.action).toBe('promote');
    expect(d.because).toBe('3 gate(s) ran and passed, 6 artifact(s) present');
  });

  it('is refused when a required gate is simply absent', () => {
    // The `daos` case: the guard rail is described and never executed. A
    // rule that only looks for failures cannot see this.
    const d = decideRelease(
      release({ gates: [{ name: 'typecheck', status: 'passed' }, { name: 'scans', status: 'passed' }] }),
      TEST_POLICY,
    );

    expect(d.action).toBe('refuse');
    expect(d.because).toBe("the gate 'unit' is not in this release — it did not run");
  });

  it('is refused when a required gate reports that it did not run, and carries its words', () => {
    const d = decideRelease(
      release({
        gates: [
          { name: 'typecheck', status: 'passed' },
          { name: 'scans', status: 'passed' },
          { name: 'unit', status: 'not-run', detail: 'no runner collected this suite' },
        ],
      }),
      TEST_POLICY,
    );

    expect(d.action).toBe('refuse');
    expect(d.because).toBe("the gate 'unit' did not run: no runner collected this suite");
  });

  it('is refused when a required gate failed, and names which', () => {
    const d = decideRelease(
      release({
        gates: [
          { name: 'typecheck', status: 'passed' },
          { name: 'scans', status: 'failed', detail: 'exit 1: 2 findings' },
          { name: 'unit', status: 'passed' },
        ],
      }),
      TEST_POLICY,
    );

    expect(d.action).toBe('refuse');
    expect(d.because).toBe("the gate 'scans' failed: exit 1: 2 findings");
  });

  it('is refused when a required gate ran out of time, and says so rather than «failed»', () => {
    // A gate that answered «no» judged the code; one that did not answer
    // judged the machine. Measured 2026-09-22: a scanner over 3502 files
    // finishes in under a second alone and blew a 180-second limit twice
    // while other work ran beside it. Calling that `failed` bills the
    // machine's hour to the commit.
    const d = decideRelease(
      release({
        gates: [
          { name: 'typecheck', status: 'passed' },
          { name: 'scans', status: 'timed-out', detail: '180s limit, load average 41.7' },
          { name: 'unit', status: 'passed' },
        ],
      }),
      TEST_POLICY,
    );

    expect(d.action).toBe('refuse');
    expect(d.because).toBe("the gate 'scans' did not answer in time: 180s limit, load average 41.7");
  });

  it('does not mind gates the policy did not ask for — the control', () => {
    // Otherwise adding a scanner would break every stack until each policy
    // was edited, and policies edited under pressure get shortened.
    const d = decideRelease(
      release({
        gates: [
          { name: 'typecheck', status: 'passed' },
          { name: 'scans', status: 'passed' },
          { name: 'unit', status: 'passed' },
          { name: 'integration', status: 'not-run', detail: 'needs a database' },
        ],
      }),
      TEST_POLICY,
    );

    expect(d.action).toBe('promote');
  });
});

describe('what the release must carry', () => {
  it('is refused when an application the stack expects has no artifact', () => {
    const d = decideRelease(
      release({ artifacts: SIX.filter((a) => a !== 'paysys').map((app) => ({ app, version: '0.0.1', sha256: SHA, bytes: 4_000 })) }),
      TEST_POLICY,
    );

    expect(d.action).toBe('refuse');
    expect(d.because).toBe("the release carries no artifact for 'paysys'");
  });

  it('is refused when an artifact carries no usable checksum', () => {
    const artifacts = release().artifacts.map((a) => (a.app === 'geo' ? { ...a, sha256: 'unknown' } : a));
    const d = decideRelease(release({ artifacts }), TEST_POLICY);

    expect(d.action).toBe('refuse');
    expect(d.because).toBe("the artifact for 'geo' carries no usable checksum");
  });

  it('is refused when an artifact is empty, and says how empty', () => {
    // A zero-length file with the right sum is impossible; a truncated one
    // with a wrong sum is ordinary. The size travels so the refusal can say
    // whether anything arrived at all.
    const artifacts = release().artifacts.map((a) => (a.app === 'main' ? { ...a, bytes: 0 } : a));
    const d = decideRelease(release({ artifacts }), TEST_POLICY);

    expect(d.action).toBe('refuse');
    expect(d.because).toBe("the artifact for 'main' is recorded as 0 bytes");
  });
});

describe('where the release came from', () => {
  it('is refused without the project commit', () => {
    const d = decideRelease(release({ project: { repo: 'x', commit: '' } }), TEST_POLICY);

    expect(d.action).toBe('refuse');
    expect(d.because).toMatch(/project commit/);
  });

  it('is refused without the omni commit — its packages are inside every artifact', () => {
    // The trail records the project's commit today and nothing about omni,
    // so «what is running there» cannot be answered from it.
    const d = decideRelease(release({ omni: { repo: 'x', commit: '' } }), TEST_POLICY);

    expect(d.action).toBe('refuse');
    expect(d.because).toMatch(/omni commit/);
  });
});

describe('production takes what a running system was measured to do', () => {
  const LIVE = ['revocation-live', 'paywall-live'];
  const PROD: StackReleasePolicy = {
    ...TEST_POLICY,
    verifiedOn: { stack: 'test', gates: LIVE },
  };

  const attested = (gates: Array<{ name: string; status: 'passed' | 'failed' | 'not-run'; detail?: string }>) => [
    { stack: 'test', release: 'r-0001', gates },
  ];

  it('refuses a release nothing has been verified about on test', () => {
    // «Deployed to test» and «verified on test» are different claims. The
    // live probes — revocation, token binding, paywall, dead-drop location —
    // exercise a DEPLOYED system and cannot run in a clean clone, so they
    // are attached to the pair rather than to the build.
    const d = decideRelease(release(), PROD, []);

    expect(d.action).toBe('refuse');
    expect(d.because).toMatch(/nothing has been verified about this release on 'test'/);
  });

  it('refuses when one live gate was never run there, and names it', () => {
    const d = decideRelease(release(), PROD, attested([{ name: 'revocation-live', status: 'passed' }]));

    expect(d.action).toBe('refuse');
    expect(d.because).toBe("'paywall-live' has not been run against this release on 'test'");
  });

  it('refuses when a live gate failed there, and carries its words', () => {
    const d = decideRelease(
      release(),
      PROD,
      attested([
        { name: 'revocation-live', status: 'passed' },
        { name: 'paywall-live', status: 'failed', detail: 'a withheld product was purchasable' },
      ]),
    );

    expect(d.action).toBe('refuse');
    expect(d.because).toBe(
      "'paywall-live' failed against this release on 'test': a withheld product was purchasable",
    );
  });

  it('refuses an attestation that belongs to a different release', () => {
    // The same stack, the same gate names, a different build. Without this
    // the check answers «has test ever been green» rather than «is THIS
    // release the one test proved».
    const other = [{ stack: 'test', release: 'r-0000', gates: LIVE.map((name) => ({ name, status: 'passed' as const })) }];
    const d = decideRelease(release(), PROD, other);

    expect(d.action).toBe('refuse');
    expect(d.because).toMatch(/nothing has been verified about this release on 'test'/);
  });

  it('promotes when test measured every live gate green against this very release', () => {
    const d = decideRelease(
      release(),
      PROD,
      attested(LIVE.map((name) => ({ name, status: 'passed' as const }))),
    );

    expect(d.action).toBe('promote');
    expect(d.because).toMatch(/2 verified on 'test'/);
  });
});

describe('how many checks a gate was made of', () => {
  it('travels with the outcome, so a gate that shrank is visible', () => {
    // `run-checks` finds its gates by reading a directory: a new scanner
    // becomes a gate by existing, and a deleted one stops being one just as
    // quietly. 61 checks where the last release ran 78 passes identically
    // and guards less.
    const manifest = release({
      gates: [
        { name: 'typecheck', status: 'passed' },
        { name: 'scans', status: 'passed', checks: 78 },
        { name: 'unit', status: 'passed' },
      ],
    });

    expect(decideRelease(manifest, TEST_POLICY).action).toBe('promote');
    expect(manifest.gates.find((g) => g.name === 'scans')?.checks).toBe(78);
  });
});
