import { stackFixture } from '../helpers/stack-fixture.js';
import { describe, expect, it } from 'vitest';
import { publicDeploymentStack } from '@omnitron-dev/omnitron/release-reading';
import { projectPrefixes, processWorkspace } from '../../webapp/src/utils/project-scope';
import { metricScope, seriesInScope } from '../../webapp/src/utils/metric-series';
import type { IProjectInfo } from '../../src/shared/dto/project';

const project = { name: 'sample', configurations: [
  { name: 'default', path: '/repo', runtimeProject: 'sample', stacks: {} },
  { name: 'research', path: '/repo/research', runtimeProject: 'sample-research', stacks: { local: 'research' } },
] } as IProjectInfo;
describe('project ownership across historical namespaces', () => {
  it('selects both the public name and its historical runtime namespace for an imported stack', () => {
    expect(projectPrefixes(project, 'sample', null)).toEqual(['sample/', 'sample-research/local/']);
    expect(projectPrefixes(project, 'sample', 'research')).toEqual(['sample-research/local/', 'sample/research/']);
    expect(projectPrefixes(project, 'sample', 'test')).toEqual(['sample/test/']);
    expect(publicDeploymentStack(project, 'sample-research', 'local')).toBe('research');
    expect(publicDeploymentStack(project, 'sample', 'dev')).toBe('dev');
    expect(publicDeploymentStack(project, 'other', 'dev')).toBeNull();
    expect(publicDeploymentStack(project, 'sample-research', 'unregistered')).toBeNull();
    expect(publicDeploymentStack(null, 'other', 'dev')).toBe('dev');
  });
  it('resolves exact public and historical handles and declines ambiguous or unowned names', () => {
    expect(processWorkspace([project], 'sample-research/local/api')).toEqual({ project: 'sample', stack: 'research' });
    expect(processWorkspace([project], 'sample/test/api')).toEqual({ project: 'sample', stack: 'test' });
    for (const handle of ['api', 'sample/api', 'sample-research/missing/api', 'other/local/api']) {
      expect(processWorkspace([project], handle)).toBeNull();
    }
    expect(processWorkspace([project, { ...project, name: 'other' }], 'sample-research/local/api')).toBeNull();
  });
  it('keeps historical metric series attached to their public stack and excludes unrelated nodes', () => {
    const stacks = [stackFixture('research', { runtimeScope: { project: 'sample-research', stack: 'local' } })];
    const scope = metricScope('sample', 'research', stacks, []);
    expect(seriesInScope({ app: 'sample-research/local/api', labels: {} }, scope)).toBe(true);
    expect(seriesInScope({ app: 'sample-research/local/api', labels: { node: 'unrelated' } }, scope)).toBe(false);
    expect(seriesInScope({ app: 'sample-other/local/api', labels: {} }, scope)).toBe(false);
  });
});
