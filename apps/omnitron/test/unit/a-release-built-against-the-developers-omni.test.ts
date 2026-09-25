/**
 * A release built against the developer's omni.
 *
 * The project links every omni package by a path the lockfile records
 * relative to each importer. A clean clone of the project installed anywhere
 * else linked nothing (97 of 97 links dangling, install exit 0); installed at
 * the working checkout's depth it linked the DEVELOPER'S omni — whatever was
 * on that disk — into a build that would then claim to be two commits.
 *
 * So the build root reproduces the layout the lockfile implies, with a clean
 * clone of omni where the links land. This court holds the layout to the one
 * property that matters: a link, followed from any importer, arrives inside
 * the omni clone. And it holds the release's conclusions — its name, its
 * gates, its manifest — to saying no more than the build found.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { planBuildRoot, readLinkLayout } from '../../src/release/layout.js';
import { assembleManifest, gateOutcomesFromGates, releaseId } from '../../src/release/builder.js';
import { decideRelease } from '../../src/release/manifest.js';

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@omnitron-dev/omnitron':
        specifier: link:/Users/dev/projects/luxquant/omnitron-dev/omni/apps/omnitron
        version: link:../../luxquant/omnitron-dev/omni/apps/omnitron

  apps/main:
    dependencies:
      '@daos/common':
        specifier: workspace:*
        version: link:../../packages/common
      '@omnitron-dev/titan':
        specifier: link:/Users/dev/projects/luxquant/omnitron-dev/omni/packages/titan
        version: link:../../../../luxquant/omnitron-dev/omni/packages/titan

packages:

  left-pad@1.3.0:
    resolution: {integrity: sha512-x}
`;

describe('the build root puts omni where the lockfile will look', () => {
  it('reads the layout from the lockfile — the links that leave the project are omni', () => {
    const layout = readLinkLayout(LOCK);
    expect(layout).toEqual({
      omniRel: '../../luxquant/omnitron-dev/omni',
      climbs: 2,
      // `../../packages/common` from apps/main stays inside the project: its
      // own workspace, not omni.
      linkedDirs: ['apps/omnitron', 'packages/titan'],
    });
  });

  it('every link, followed from its own importer, lands in the omni clone', () => {
    const layout = readLinkLayout(LOCK);
    if ('refusal' in layout) throw new Error(layout.refusal);
    const plan = planBuildRoot('/r/src', '/Users/dev/projects/dao/daos', layout);
    if ('refusal' in plan) throw new Error(plan.refusal);

    expect(plan).toEqual({ projectDir: '/r/src/dao/daos', omniDir: '/r/src/luxquant/omnitron-dev/omni' });
    // What pnpm will do with the frozen lockfile, from both importers.
    expect(path.resolve(plan.projectDir, '../../luxquant/omnitron-dev/omni/apps/omnitron')).toBe(
      '/r/src/luxquant/omnitron-dev/omni/apps/omnitron',
    );
    expect(path.resolve(plan.projectDir, 'apps/main', '../../../../luxquant/omnitron-dev/omni/packages/titan')).toBe(
      '/r/src/luxquant/omnitron-dev/omni/packages/titan',
    );
  });

  it('refuses links into two outside checkouts rather than choose one', () => {
    const two = LOCK.replace('../../../../luxquant/omnitron-dev/omni/packages/titan', '../../../../elsewhere/omni/packages/titan');
    expect(readLinkLayout(two)).toEqual({ refusal: expect.stringMatching(/2 outside checkouts/) });
  });

  it('refuses a lockfile that links nothing outside the project', () => {
    const none = LOCK.replace(/version: link:(\.\.\/)+luxquant[^\n]+/g, 'version: 1.0.0');
    expect(readLinkLayout(none)).toEqual({ refusal: expect.stringMatching(/links nothing outside/) });
  });

  it('refuses an outside link that is not a workspace package', () => {
    const stray = LOCK.replace('../../luxquant/omnitron-dev/omni/apps/omnitron', '../../vendor/blob');
    expect(readLinkLayout(stray)).toEqual({ refusal: expect.stringMatching(/not a workspace package/) });
  });

  it('refuses when the links climb above the project path itself', () => {
    const layout = readLinkLayout(LOCK);
    if ('refusal' in layout) throw new Error(layout.refusal);
    expect(planBuildRoot('/r/src', '/daos', layout)).toEqual({ refusal: expect.stringMatching(/climb 2 directories/) });
  });
});

describe('the release says what the build found, and no more', () => {
  it('is named by project, UTC minute and both commits', () => {
    expect(releaseId('daos', new Date('2026-09-22T14:32:09Z'), '81c8a0744a1b', 'c64963f6e2d0')).toBe(
      'daos-202609221432-81c8a074-c64963f6',
    );
  });

  it('reads every gate from the last JSON line, keeping killed and timed-out apart', () => {
    const out = [
      'PASS  links                 1s  358 installed links resolve',
      'KILL  unit:main           412s  killed by SIGKILL',
      JSON.stringify({
        total: 4,
        passed: 1,
        gates: [
          { name: 'links', outcome: 'passed', ms: 812, detail: '358 installed links resolve' },
          { name: 'unit:main', outcome: 'killed', ms: 412000, detail: 'killed by SIGKILL' },
          { name: 'scans', outcome: 'timed-out', ms: 180000, detail: 'no answer in 180s' },
          { name: 'security:paysys', outcome: 'exploded', ms: 1 },
        ],
        ok: false,
      }),
    ].join('\n');

    const gates = gateOutcomesFromGates(out, 1);
    expect(gates.map((g) => [g.name, g.status])).toEqual([
      ['links', 'passed'],
      ['unit:main', 'killed'],
      ['scans', 'timed-out'],
      // A word nobody recognises must not read as a pass.
      ['security:paysys', 'not-run'],
    ]);
    expect(gates[3]!.detail).toMatch(/unrecognised outcome 'exploded'/);
    expect(gates[1]!.durationMs).toBe(412000);
  });

  it('no result object is one gate that did not run, with the exit code — not an empty list', () => {
    expect(gateOutcomesFromGates('node: cannot find module scripts/gates.mjs\n', 1)).toEqual([
      { name: 'gates', status: 'not-run', detail: 'the gates script printed no result object (exit 1)' },
    ]);
  });

  it('a run stopped part-way keeps the verdicts that had landed, and still is not whole', () => {
    // Two builds stopped on 2026-09-25 reported «gates: 0 of 1 passed» over
    // lines like these.
    const stdout = [
      'PASS  links                 0s  359 installed links resolve',
      'PASS  scans               138s  69 of 69',
      'FAIL  unit:main           306s  Tests 1 failed | 4824 passed (4825) — test/unit/a-refusal-in-paysyss-words.test.ts',
      'TIME  integration:paysys  600s',
      '',
    ].join('\n');
    expect(gateOutcomesFromGates(stdout, null)).toEqual([
      { name: 'links', status: 'passed', durationMs: 0, detail: '359 installed links resolve' },
      { name: 'scans', status: 'passed', durationMs: 138000, detail: '69 of 69' },
      {
        name: 'unit:main',
        status: 'failed',
        durationMs: 306000,
        detail: 'Tests 1 failed | 4824 passed (4825) — test/unit/a-refusal-in-paysyss-words.test.ts',
      },
      { name: 'integration:paysys', status: 'timed-out', durationMs: 600000 },
      {
        name: 'gates',
        status: 'not-run',
        detail: 'the gates script printed no result object (exit by signal); 4 gate(s) had reported before it did',
      },
    ]);
  });

  it('a killed gate refuses the release, and says it was killed', () => {
    const manifest = assembleManifest({
      id: 'r',
      project: { repo: 'gitlab', commit: 'a'.repeat(40) },
      omni: { repo: 'github', commit: 'b'.repeat(40) },
      artifacts: [{ app: 'main', version: '0.0.1', tarballSha256: 'c'.repeat(64), size: 10 }],
      artifactFailures: [],
      gates: gateOutcomesFromGates(JSON.stringify({ gates: [{ name: 'unit:main', outcome: 'killed', detail: 'killed by SIGKILL' }] }), 1),
      omnitron: '0.2.0',
      packages: [],
      builtAt: new Date(0),
      builtBy: 'test',
    });
    expect(decideRelease(manifest, { requiredGates: ['unit:main'], requiredApps: ['main'] })).toEqual({
      action: 'refuse',
      because: "the gate 'unit:main' was killed before it answered: killed by SIGKILL",
    });
  });

  it('an artifact with no tarball checksum is written as such, and refused by name', () => {
    const manifest = assembleManifest({
      id: 'r',
      project: { repo: 'gitlab', commit: 'a'.repeat(40) },
      omni: { repo: 'github', commit: 'b'.repeat(40) },
      artifacts: [{ app: 'main', version: '0.0.1', size: 10 }],
      artifactFailures: [{ app: 'geo', error: 'exit 2: TS2416' }],
      gates: [{ name: 'build', status: 'passed' }],
      omnitron: '0.2.0',
      packages: [],
      builtAt: new Date(0),
      builtBy: 'test',
    });
    expect(manifest.artifacts[0]!.sha256).toBe('');
    expect(manifest.artifactFailures).toEqual([{ app: 'geo', error: 'exit 2: TS2416' }]);
    expect(decideRelease(manifest, { requiredGates: ['build'], requiredApps: ['main'] })).toEqual({
      action: 'refuse',
      because: "the artifact for 'main' carries no usable checksum",
    });
    expect(decideRelease(manifest, { requiredGates: ['build'], requiredApps: ['geo'] })).toEqual({
      action: 'refuse',
      because: "the release carries no artifact for 'geo'",
    });
  });
});

describe('a project registered through a symlink', () => {
  it('resolves its links from the real directory, as pnpm does', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const { resolveCheckouts } = await import('../../src/release/layout.js');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-symlink-')));
    // ~/projects/dao/daos and ~/projects/luxquant/omnitron-dev/omni, and the
    // registry's `omni/internal/daos` pointing at the first.
    fs.mkdirSync(path.join(root, 'dao', 'daos'), { recursive: true });
    fs.mkdirSync(path.join(root, 'luxquant', 'omnitron-dev', 'omni', 'internal'), { recursive: true });
    const viaLink = path.join(root, 'luxquant', 'omnitron-dev', 'omni', 'internal', 'daos');
    fs.symlinkSync(path.join(root, 'dao', 'daos'), viaLink);

    const layout = readLinkLayout(LOCK);
    if ('refusal' in layout) throw new Error(layout.refusal);
    expect(resolveCheckouts(viaLink, layout)).toEqual({
      projectReal: path.join(root, 'dao', 'daos'),
      omniPath: path.join(root, 'luxquant', 'omnitron-dev', 'omni'),
    });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
