/**
 * A gate count the CLI and the console read apart.
 *
 * Each read a release's gates its own way. After 70b988a6 the CLI said
 * «skipped» for a `--skip-gates` build and counted a timed-out gate apart
 * from one that never ran; the console still drew the skipped build as
 * «0/1» — what one failed gate reads as — and coloured by `failed` and
 * `notRun` alone, so daos-202609230557, whose one gate that did not pass
 * timed out, would have read a green «20/21». One reading now, for both.
 */

import { describe, it, expect } from 'vitest';

import {
  deploymentsAnswer,
  pruneBlindness,
  readGates,
  stacksByRelease,
  type ReleaseGates,
} from '../../src/shared/release-reading.js';
import type { ReleaseDeploymentDto } from '../../src/shared/dto/services.js';
import type { GateOutcome } from '../../src/release/manifest.js';

const release = (gateList: GateOutcome[], counts?: Partial<ReleaseGates['gates']>): ReleaseGates => ({
  complete: true,
  gates: {
    total: gateList.length,
    passed: gateList.filter((g) => g.status === 'passed').length,
    failed: gateList.filter((g) => g.status === 'failed').length,
    ...counts,
  },
  gateList,
});

const passed = (n: number): GateOutcome[] => Array.from({ length: n }, (_, i) => ({ name: `gate-${i}`, status: 'passed' }));

describe('a gate count the CLI and the console read apart', () => {
  it('reads a build with --skip-gates as skipped, not as one failed gate', () => {
    const skipped = release([{ name: 'gates', status: 'not-run', detail: 'skipped by --skip-gates' }]);
    expect(readGates(skipped)).toEqual({ text: 'skipped', tone: 'unfinished' });

    const failedOne = release([{ name: 'unit:main', status: 'failed', detail: 'exit 1' }]);
    expect(readGates(failedOne)).toEqual({ text: '0/1', tone: 'failed' });
  });

  it('reads a build that ran no gate for any other reason as not run', () => {
    expect(readGates(release([{ name: 'gates', status: 'not-run', detail: 'no gates script' }]))).toEqual({
      text: 'not run',
      tone: 'unfinished',
    });
  });

  it('does not call a release with a timed-out or killed gate passed', () => {
    // daos-202609230557: twenty passed, `unit:paysys` timed out.
    const timedOut = release([...passed(20), { name: 'unit:paysys', status: 'timed-out', detail: 'ETIMEDOUT' }]);
    expect(readGates(timedOut)).toEqual({ text: '20/21', tone: 'unfinished' });

    const killed = release([...passed(20), { name: 'unit:main', status: 'killed', detail: 'SIGKILL' }]);
    expect(readGates(killed).tone).toBe('unfinished');
  });

  it('reads the same from a daemon that predates the separate counts', () => {
    // Such a daemon counted the timeout in `notRun` and sent no `timedOut`.
    const old = release([...passed(20), { name: 'unit:paysys', status: 'timed-out' }], { notRun: 1 } as never);
    expect(readGates(old)).toEqual({ text: '20/21', tone: 'unfinished' });
  });

  it('calls all passed passed, and a build without a manifest nothing', () => {
    expect(readGates(release(passed(21)))).toEqual({ text: '21/21', tone: 'passed' });
    expect(readGates({ ...release(passed(3)), complete: false })).toEqual({ text: 'no manifest', tone: 'none' });
  });
});

describe('a prune that protected what it could not see', () => {
  // A daemon whose database did not come up serves `deployments()` as `[]`.
  // The console took that for «no stack has taken a release», sent an empty
  // `protect`, and would have removed the release a stack runs.
  const row = (stack: string, release: string | null, releaseUnnamed = false): ReleaseDeploymentDto => ({
    project: 'daos',
    stack,
    at: '2026-09-23T08:39:38.976Z',
    actorId: null,
    source: 'operator',
    release,
    releaseUnnamed,
    projectCommit: null,
    omniCommit: null,
  });

  it('does not read an empty answer from a daemon without its audit trail as «none deployed»', () => {
    const answer = deploymentsAnswer(false, []);
    expect(answer.known).toBe(false);
    expect(pruneBlindness(answer)).toMatch(/no audit trail/);
  });

  it('names the stack whose last release the trail could not name', () => {
    const answer = deploymentsAnswer(true, [row('test', null, true), row('dev', null)]);
    expect(pruneBlindness(answer)).toBe('daos/test last took a release whose name the trail did not record');
  });

  it('sees nothing to hide when every stack is accounted for, and protects what they run', () => {
    const answer = deploymentsAnswer(true, [row('test', 'daos-202609230810-66740d9c-5a3315fc'), row('dev', null)]);
    expect(pruneBlindness(answer)).toBeNull();
    expect([...stacksByRelease(answer.known ? answer.deployments : []).keys()]).toEqual([
      'daos-202609230810-66740d9c-5a3315fc',
    ]);
  });
});
