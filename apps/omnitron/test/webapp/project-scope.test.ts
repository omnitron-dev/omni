import { describe, expect, it } from 'vitest';
import { projectPrefixes, projectStackName, restoredProjectScope } from '../../webapp/src/utils/project-scope';
import { metricScope, seriesInScope } from '../../webapp/src/utils/metric-series';
import type { IProjectInfo, IStackInfo } from '../../src/shared/dto/project';

const project = { name: 'sample', configurations: [
  { name: 'default', path: '/repo', runtimeProject: 'sample', stacks: {} },
  { name: 'research', path: '/repo/research', runtimeProject: 'sample-research', stacks: { local: 'research' } },
] } as IProjectInfo;
describe('project ownership across historical namespaces', () => {
  it('selects all owned namespaces but a single source for an imported stack', () => {
    expect(projectPrefixes(project, 'sample', null)).toEqual(['sample/', 'sample-research/']);
    expect(projectPrefixes(project, 'sample', 'research')).toEqual(['sample-research/local/']);
    expect(projectPrefixes(project, 'sample', 'test')).toEqual(['sample/test/']);
    expect(projectStackName(project, 'sample-research/local/api')).toBe('research');
  });
  it('restores an old selected registration inside its owner without losing its stack', () => {
    expect(restoredProjectScope([project], 'sample-research', 'local')).toEqual({ project: 'sample', stack: 'research' });
    expect(restoredProjectScope([project], 'sample-research', null)).toEqual({ project: 'sample', stack: 'research' });
    expect(restoredProjectScope([project], 'sample', 'test')).toEqual({ project: 'sample', stack: 'test' });
    expect(restoredProjectScope([project], 'missing', null)).toBeNull();
  });
  it('keeps historical metric series attached to their public stack and excludes unrelated nodes', () => {
    const stacks = [{ name: 'research', type: 'local', runtimeScope: { project: 'sample-research', stack: 'local' }, apps: [], nodes: [] }] as IStackInfo[];
    const scope = metricScope('sample', 'research', stacks, []);
    expect(seriesInScope({ app: 'sample-research/local/api' }, scope)).toBe(true);
    expect(seriesInScope({ app: 'sample-research/local/api', labels: { node: 'unrelated' } }, scope)).toBe(false);
    expect(seriesInScope({ app: 'sample-other/local/api' }, scope)).toBe(false);
  });
});
