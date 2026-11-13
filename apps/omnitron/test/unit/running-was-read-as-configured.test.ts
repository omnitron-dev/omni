import { expect, it } from 'vitest';
import { resolveOmnitronPg, withInfrastructureScope } from '../../src/infrastructure/service-resolver.js';

it('keeps the host database, bridge, port and volume identical across concurrent project scopes', async () => {
  const global = resolveOmnitronPg();
  const observed = await Promise.all(['tenant-a', 'tenant-b'].map(project => withInfrastructureScope(project, 'dev', async () => {
    await Promise.resolve();
    return resolveOmnitronPg();
  })));
  expect(observed).toEqual([global, global]);
  expect(global).toMatchObject({ name: 'omnitron-pg', network: 'omnitron_default',
    ports: [{ host: 5480, container: 5432, bindHost: '127.0.0.1' }],
    volumes: [{ source: 'omnitron-pg-data', target: '/var/lib/postgresql/data' }] });
});
