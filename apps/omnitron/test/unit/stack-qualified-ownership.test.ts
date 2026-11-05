import { describe, it, expect } from 'vitest';
import { ProjectService } from '../../src/services/project.service.js';
import { readStackRelease } from '../../src/shared/release-reading.js';
const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger; } };
function stackView(handles: any[]) {
  const service: any = new ProjectService(logger, { list: () => handles } as any, {
    selectProjectsSync: () => ['one', 'two'].map(name => ({ name, path: `/fixture/${name}`, added_at: new Date(0).toISOString() })),
    kvGetSync: () => null, get: () => null, set() {},
  } as any);
  service.getLoadedConfig = () => ({ apps: [{ name: 'api', script: './api.js' }] });
  service.resolveStackApps = () => [{ name: 'api', script: './api.js' }];
  return (project: string) => service.toStackInfo(project, 'prod', { type: 'local', apps: ['api'] });
}
describe('stack ownership is qualified, never inferred from a basename', () => {
  it('does not report one unowned bare api as online in two projects', () => {
    const view = stackView([{ name: 'api', status: 'online', pid: 123 }]);
    expect(view('one').apps[0]).toMatchObject({ handleKey: 'one/prod/api', status: 'stopped' });
    expect(view('two').apps[0]).toMatchObject({ handleKey: 'two/prod/api', status: 'stopped' });
  });
  it('each qualified api reports its own process and state', () => {
    const view = stackView([{ name: 'one/prod/api', status: 'online', pid: 123 }, { name: 'two/prod/api', status: 'crashed', pid: null }]);
    expect(view('one').apps[0]).toMatchObject({ handleKey: 'one/prod/api', status: 'online', pid: 123 });
    expect(view('two').apps[0]).toMatchObject({ handleKey: 'two/prod/api', status: 'crashed', pid: null });
  });
  it('preserves launch generations for configured and discovered worker-only applications', () => {
    const release = { state: 'confirmed', releaseId: 'sample-release', manifestSha256: 'a'.repeat(64),
      artifactSha256: 'b'.repeat(64), launchId: 'launch-1', observedAt: new Date().toISOString(), basis: 'verified-launch' };
    const info = stackView(['api', 'mail'].map(name => ({ name: `one/prod/${name}`, status: 'online', pid: null,
      generation: 'launch-1', release })))('one');
    expect(info.apps.map((app: { generation?: string }) => app.generation)).toEqual(['launch-1', 'launch-1']);
    expect(readStackRelease(info)).toMatchObject({ runningRelease: 'confirmed', releaseEvidence: { verified: 2, total: 2 } });
  });
});
