import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectService } from '../../src/services/project.service.js';
import { inspectLocalReleaseInstallation, inspectLocalReleasePayloads } from '../../src/release/local-installation.js';

vi.mock('../../src/release/local-installation.js', () => ({
  inspectLocalReleaseInstallation: vi.fn(async (_release, _stack, entries) => entries),
  inspectLocalReleasePayloads: vi.fn(async () => new Map()),
}));
afterEach(() => vi.clearAllMocks());

function fixture(appEnv: Record<string, Record<string, string>>) {
  const logger: any = { info() {}, warn() {}, error() {}, debug() {} };
  const state: any = { selectProjectsSync: () => [], kvGetSync: () => null };
  const owner: any = { getExecutionOwnerPid: () => 123, getExecutionOwnerPackage: () => '/fixture/owner' };
  const service: any = new ProjectService(logger, owner, state);
  service.registry = { get: () => ({ path: '/fixture/project' }) };
  service.resolveStackApps = () => [{ name: 'api', cwd: 'apps/api' }, { name: 'mail', cwd: 'apps/mail' }];
  return () => service.installedEntries('fixture', 'local', { settings: { appEnv } }, {}, {}, false, ['api'], { api: ['dist/database/config.js'] });
}

it('validates the full stack but admits only the requested migration owner and its environment', async () => {
  const entries = await fixture({ api: { API_ONLY: 'api-value' }, mail: { MAIL_ONLY: 'mail-value' } })();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ name: 'api', env: { API_ONLY: 'api-value' } });
  expect(entries[0].env).not.toHaveProperty('MAIL_ONLY');
  expect(inspectLocalReleasePayloads).toHaveBeenCalledWith({}, [], false);
  expect(inspectLocalReleaseInstallation).toHaveBeenCalledWith({}, 'local', entries, {
    prepare: false, ownerPid: 123, ownerPackage: '/fixture/owner', requiredFiles: { api: ['dist/database/config.js'] },
  });
});

it('still refuses environment declarations for an application absent from the stack before admission', async () => {
  await expect(fixture({ absent: { TOKEN: 'fixture' } })()).rejects.toThrow("settings.appEnv names 'absent'");
  expect(inspectLocalReleasePayloads).not.toHaveBeenCalled();
  expect(inspectLocalReleaseInstallation).not.toHaveBeenCalled();
});
