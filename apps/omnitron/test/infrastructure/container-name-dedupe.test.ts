import { describe, it, expect } from 'vitest';
import { resolveInfrastructureDefinition } from '../../src/infrastructure/infrastructure-definition.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { recoveryState } from '../../src/daemon/recovery-state.js';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';

function spec(overrides: Partial<ResolvedContainer> = {}): ResolvedContainer {
  return {
    name: 'omni-dev-postgres', image: 'postgres:16',
    ports: [{ host: 5432, container: 5432 }], environment: { POSTGRES_PASSWORD: 'synthetic' },
    volumes: [], labels: { 'omnitron.managed': 'true' },
    ...overrides,
  } as ResolvedContainer;
}
const definition = (...appContainers: ResolvedContainer[]) => resolveInfrastructureDefinition({ config: {}, appContainers });

describe('complete infrastructure declarations', () => {
  it('shares identical application declarations without acquiring ownership or invalidating review', () => {
    const before = recoveryState.token();
    const resolved = definition(spec(), spec(), spec());
    expect(resolved.containers).toEqual([spec()]);
    expect(recoveryState.token()).toBe(before);
  });

  it.each([
    { image: 'postgres:15' }, { ports: [{ host: 5433, container: 5432 }] },
    { environment: { POSTGRES_PASSWORD: 'different' } },
    { labels: { 'omnitron.managed': 'true', 'omnitron.project': 'other' } },
  ])('rejects conflicting declarations before allocation: %j', change => {
    const first = spec(), other = spec(change);
    expect(() => definition(first, other)).toThrow('Conflicting infrastructure declarations');
    expect(() => definition(other, first)).toThrow('Conflicting infrastructure declarations');
    expect(first).toEqual(spec());
  });

  it('keeps separately named services', () => {
    expect(definition(spec(), spec({ name: 'omni-dev-redis', image: 'redis:7' })).containers.map(c => c.name))
      .toEqual(['omni-dev-postgres', 'omni-dev-redis']);
  });

  it('detaches the source and published definition from the live owner', () => {
    const input = spec(), resolved = definition(input);
    input.environment['POSTGRES_PASSWORD'] = 'changed-before-adoption';
    const owner = new InfrastructureService(createNullLogger(), resolved);
    resolved.containers[0]!.environment['POSTGRES_PASSWORD'] = 'changed-after-adoption';
    owner.getDefinition().containers[0]!.environment['POSTGRES_PASSWORD'] = 'changed-from-query';
    expect(owner.getDesiredContainers()[0]!.environment['POSTGRES_PASSWORD']).toBe('synthetic');
    owner.dispose();
  });
});
