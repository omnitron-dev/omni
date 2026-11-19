import { describe, expect, it } from 'vitest';
import { Pipeline } from '@xec-sh/ops/pipeline';
import type { PipelineStep } from '../../src/shared/dto/pipelines';
import { canConnectSteps, parsePipelineSteps, pipelineLevels, removeStep, renameStep } from '../../webapp/src/components/pipeline-graph';

const shell = (name: string, dependsOn?: string[]): PipelineStep => ({
  name, run: 'echo example', ...(dependsOn && { dependsOn }),
});

describe('Console pipeline dependencies', () => {
  it('positions forward references, independent roots and joins using the Xec dependency set', () => {
    const steps = [shell('publish', ['build', 'test']), shell('build', ['checkout']), shell('test', ['checkout']), shell('checkout'), shell('notify')];
    const ranks = pipelineLevels(steps);
    expect(Object.fromEntries(ranks)).toEqual({ checkout: 0, notify: 0, build: 1, test: 1, publish: 2 });
    for (const source of steps) for (const destination of steps) {
      const graph = Pipeline.create('qualification');
      for (const step of steps) graph.step(step.name, { run: async () => {}, dependsOn: [
        ...(step.dependsOn ?? []), ...(step === destination ? [source.name] : []),
      ] });
      const allowed = canConnectSteps(steps, source.name, destination.name);
      if (allowed || destination.dependsOn?.includes(source.name)) expect(() => graph.validate()).not.toThrow();
      else expect(() => graph.validate()).toThrow(/circular/i);
    }
  });

  it('keeps sealed identities, literal arguments and unrelated conditions when editing references', () => {
    const release: PipelineStep = { kind: 'release', name: 'run', args: ['a b', '--format=json'], condition: 'params.ready',
      target: { project: 'sample', stack: 'dev', app: 'worker', entry: 'dist/run.js', artifact: {
        releaseId: 'build', producerApp: 'worker', manifestSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64),
        projectCommit: 'c'.repeat(40), frameworkCommit: 'd'.repeat(40),
      } }, dependsOn: ['verify'] };
    const input = [release, shell('verify'), shell('independent')];
    const renamed = renameStep(input, 'verify', 'check');
    expect(renamed[0]).toEqual({ ...release, dependsOn: ['check'] });
    expect(renamed[2]).toBe(input[2]);
    expect(removeStep(renamed, 'check')).toEqual([{ ...release, dependsOn: [] }, input[2]]);
    expect(input[0]).toEqual(release);
  });

  it('refuses dangling references, duplicate identities, cycles and unknown executors in Advanced JSON', () => {
    for (const steps of [[shell('one', ['absent'])], [shell('one'), shell('one')], [shell('self', ['self'])],
      [shell('one', ['two']), shell('two', ['three']), shell('three', ['one'])],
      [{ ...shell('extra'), kind: 'unknown' }], [{ name: 'release', kind: 'release', target: 'mutable' }]]) {
      expect(() => parsePipelineSteps(JSON.stringify(steps))).toThrow();
    }
    const steps = [shell('second', ['first']), shell('first')];
    expect(parsePipelineSteps(JSON.stringify(steps))).toEqual(steps);
  });
});
