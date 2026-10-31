import { describe, expect, it } from 'vitest';
import { appDependencies, topologyEndpoint } from '../../src/project/dependency-topology.js';
import { resolveStack, resolvedConfigToEnv } from '../../src/project/config-resolver.js';
import type { IEcosystemConfig, IAppDefinition } from '../../src/config/types.js';

describe('dependency configuration evidence', () => {
  it('uses launch resolver output and respects final environment overrides', () => {
    const definitions = new Map([['api', { omnitronConfig: { database: true, redis: true } } as IAppDefinition]]);
    const config = { apps: [{ name: 'api', script: 'main.js' }] } as IEcosystemConfig;
    const resolved = resolveStack(config, 'sample', 'dev', { type: 'local', apps: 'all' }, definitions);
    const env = resolvedConfigToEnv(resolved.appConfigs.get('api')!, 'api', 'dev');
    const graph = appDependencies('sample', 'dev', { name: 'sample/dev/api', script: 'main.js', dependsOn: ['worker'], env: {
      ...env, DATABASE_URL: 'postgres://operator:secret@external.example:15432/private?password=secret#token',
    } }, definitions.get('api'));
    expect(graph).toEqual(expect.arrayContaining([
      expect.objectContaining({ app: 'api', service: 'postgres', host: 'external.example', port: 15432, evidence: 'configuration' }),
      expect.objectContaining({ service: 'redis', port: 6379 }),
      expect.objectContaining({ targetApp: 'worker', evidence: 'declaration' }),
    ]));
    const serialized = JSON.stringify(graph);
    for (const secret of ['operator', 'secret', 'private', 'token']) expect(serialized).not.toContain(secret);
  });
  it('never treats credentials or an arbitrary public URL as a dependency', () => {
    const graph = appDependencies('sample', 'dev', { name: 'api', env: {
      PUBLIC_URL: 'https://site.example', API_SECRET: 'https://secret.example', REDIS_URL: '',
      DATABASE_URL: '${DATABASE_URL}', REDIS_PASSWORD: 'hidden',
    } });
    expect(graph).toEqual([]);
  });
  it('keeps IPv6 and TLS ports, drops credentials and refuses unparseable templates', () => {
    expect(topologyEndpoint('rediss://:secret@[::1]:6380/4')).toEqual({ host: '::1', port: 6380 });
    expect(topologyEndpoint('https://user:secret@storage.example/bucket?signature=secret')).toEqual({ host: 'storage.example', port: 443 });
    expect(topologyEndpoint('postgres://${user}:${pass}@host/db')).toBeNull();
  });
});

it('reads cold topology without executing or compiling an application bootstrap', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { ProjectService } = await import('../../src/services/project.service.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topology-read-'));
  try {
    fs.mkdirSync(path.join(directory, 'apps/api/config'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'apps/api/src'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'apps/api/src/bootstrap.ts'), "throw new Error('Topology must not import me')");
    fs.writeFileSync(path.join(directory, 'apps/api/config/default.json'), JSON.stringify({ omnitron: { redis: true } }));
    const entries = [{ name: 'api', bootstrap: 'apps/api/src/bootstrap.ts' }];
    const service = Object.assign(Object.create(ProjectService.prototype), {
      registry: { get: () => ({ path: directory }) }, bootstrapTopology: new Map(),
      ensureConfig: async () => ({ apps: entries }), resolveStacks: () => ({ dev: { type: 'local', apps: 'all' } }),
      resolveStackApps: () => entries, stackEnvFor: async () => ({}),
      infraManager: { getPortAllocation: () => undefined, getNormalizedServices: () => undefined },
    }) as InstanceType<typeof ProjectService>;
    const graph = await service.getTopology({ project: 'sample' });
    expect(graph.dependencies).toEqual([expect.objectContaining({ app: 'api', service: 'redis', port: 6379 })]);
    expect(graph.warnings[0]?.reason).toMatch(/Bootstrap metadata not loaded/);
    expect(fs.readdirSync(path.join(directory, 'apps/api'))).toEqual(['config', 'src']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
