import { describe, expect, it } from 'vitest';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';
import { ProjectService, SLAVE_PROJECT_SERVICE_PROVIDER } from '../../src/services/project.service.js';
import { AUDIT_SERVICE_TOKEN, DAEMON_STATE_STORE_TOKEN, FLEET_SERVICE_TOKEN, ORCHESTRATOR_TOKEN, SECRETS_SERVICE_TOKEN } from '../../src/shared/tokens.js';
const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger; } };
const orchestrator: any = { list: () => [], listHandleNames: () => [] };
const state: any = { save() {}, load: () => null, get: () => null, set() {} };
const stack: any = { settings: { appEnv: { api: { DATABASE_URL: { secret: 'application.database' } } } } };
type Resolution = { stackEnvFor(project: string, stack: string, definition: unknown, apps: string[]): Promise<unknown> };
function service(value: string | null) {
  const values = new Map<unknown,unknown>([
    [LOGGER_SERVICE_TOKEN, {logger}], [ORCHESTRATOR_TOKEN, orchestrator], [DAEMON_STATE_STORE_TOKEN, state],
    [SECRETS_SERVICE_TOKEN, {get: async () => value}],
  ]);
  const args=SLAVE_PROJECT_SERVICE_PROVIDER.inject.map(token => {
    if(!values.has(token)) throw Error('Slave cannot provide this collaborator');
    return values.get(token);
  });
  return (SLAVE_PROJECT_SERVICE_PROVIDER.useFactory as (...args: any[])=>ProjectService)(...args) as unknown as Resolution;
}
describe('slave ProjectService receives the vault its daemon already owns', () => {
  it('resolves declared application references using the local vault', async () => {
    await expect(service('private-fixture-value').stackEnvFor('fixture','production',stack,['api'])).resolves.toEqual({api:{DATABASE_URL:'private-fixture-value'}});
    expect(SLAVE_PROJECT_SERVICE_PROVIDER.inject).not.toContain(AUDIT_SERVICE_TOKEN);
    expect(SLAVE_PROJECT_SERVICE_PROVIDER.inject).not.toContain(FLEET_SERVICE_TOKEN);
  });
  it('still refuses absent and empty vault entries', async () => {
    for(const value of [null,'']) await expect(service(value).stackEnvFor('fixture','production',stack,['api'])).rejects.toThrow('vault holds no');
  });
  it('retains the measured no-vault factory as a negative control', async () => {
    const old=new ProjectService(logger,orchestrator,state) as unknown as Resolution;
    await expect(old.stackEnvFor('fixture','production',stack,['api'])).rejects.toThrow('this daemon has no vault');
  });
});

it('registers the same vault-aware provider in the actual slave daemon module', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DEFAULT_DAEMON_CONFIG, DEFAULT_ECOSYSTEM } = await import('../../src/config/defaults.js');
  const { createDaemonModule, getDaemonLogStream, getDaemonErrorStream } = await import('../../src/daemon/daemon.module.js');
  const { PROJECT_SERVICE_TOKEN } = await import('../../src/shared/tokens.js');
  const directory = mkdtempSync(join(tmpdir(), 'slave-provider-metadata-'));
  try {
    const module = createDaemonModule({ ...DEFAULT_ECOSYSTEM, apps: [] }, { ...DEFAULT_DAEMON_CONFIG, role: 'slave', logDir: directory });
    const metadata = Reflect.getMetadata('nexus:module', module);
    const provider = metadata.providers.find(([token]: [unknown]) => token === PROJECT_SERVICE_TOKEN)?.[1];
    expect(provider?.inject).toContain(SECRETS_SERVICE_TOKEN);
    expect(provider?.useFactory).toBe(SLAVE_PROJECT_SERVICE_PROVIDER.useFactory);
  } finally {
    await Promise.all([getDaemonLogStream(), getDaemonErrorStream()].map(stream => stream ? new Promise<void>(resolve => stream.end(resolve)) : Promise.resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
