import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import {
  resolveInfrastructure,
  setContainerPrefix,
  usesGatewayTemplate,
} from '../../src/infrastructure/service-resolver.js';
import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';
import { normalizeInfraConfig } from '../../src/infrastructure/config-normalizer.js';
import type { InfrastructureConfig, IServiceRequirement, ResolvedContainer } from '../../src/infrastructure/types.js';
const explicit: IServiceRequirement = {
  type: 'daemon',
  ports: {},
  env: {},
  docker: {
    image: 'example/private-proxy@sha256:' + 'a'.repeat(64),
    network: 'host',
    resources: { memory: '128m', cpus: 0.5 },
    volumes: { config: { source: '/private/custom.conf', target: '/proxy/config', readonly: true } },
  },
};
afterEach(() => vi.restoreAllMocks());
function assertExplicit(spec: {
  image: string;
  ports: unknown[];
  network?: unknown;
  volumes?: unknown[];
  resources?: unknown;
}) {
  expect(spec.image).toBe(explicit.docker!.image);
  expect(spec.ports).toEqual([]);
  expect(spec.network).toBe('host');
  expect(spec.resources).toMatchObject({ memory: '128m', cpus: 0.5 });
  expect(spec.volumes).toEqual([{ source: '/private/custom.conf', target: '/proxy/config', readonly: true }]);
}
describe('an explicit gateway container is not an OpenResty template', () => {
  it('preserves the declared image, private network and limits on local stack provisioning', async () => {
    vi.spyOn(InfrastructureService.prototype, 'provision').mockResolvedValue(undefined);
    const manager = new StackInfrastructureManager(createNullLogger());
    const infra = await manager.provisionStack(
      'owner-a',
      'production',
      { type: 'local', apps: [] },
      { services: { gateway: explicit } } as InfrastructureConfig,
      undefined,
      '/immutable/app'
    );
    const gateway = (infra as unknown as { desiredContainers: ResolvedContainer[] }).desiredContainers.find(
      (s) => s.name === 'owner-a-production-gateway'
    );
    expect(gateway).toBeDefined();
    assertExplicit(gateway!);
  });
  it('preserves that same declaration on remote resolution even when config files were delivered', () => {
    setContainerPrefix('owner-b', 'production');
    const result = resolveInfrastructure(
      {},
      { gateway: explicit },
      undefined,
      new Map([['gateway', '/shipped/config']]),
      { redis: { host: 'redis', port: 6379, db: 0 } }
    );
    expect(result).toHaveLength(1);
    assertExplicit(result[0]!);
  });
  it('still recognizes the declared OpenResty preset and normalized legacy gateway', () => {
    const registry = createDefaultRegistry();
    for (const input of [
      { services: { gateway: { preset: 'openresty', config: { configDir: 'gateway' } } } },
      { gateway: { port: 8080, configDir: 'gateway' } },
    ]) {
      const services = normalizeInfraConfig(input as InfrastructureConfig, registry);
      expect(usesGatewayTemplate(services.gateway)).toBe(true);
    }
    expect(usesGatewayTemplate(explicit)).toBe(false);
  });
});
