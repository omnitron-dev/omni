/**
 * A node that kept the first definition it was given.
 *
 * A node's daemon builds its InfrastructureService on the first
 * `provisionStack` and reuses it for every later one — a second would be a
 * second janitor and a second health monitor over one set of containers. But
 * the stack's definition was a constructor argument, and the reused service
 * kept the first call's: a later deployment that dropped a `disabled`,
 * enabled a service or changed an image reached the host services (they read
 * each call's own) and not the containers, until something restarted the
 * daemon. Found 2026-09-25 while enabling Nominatim on daos/test, where the
 * change is exactly a `disabled: true` dropped from `omnitron.stacks.json`.
 *
 * Held here with a real InfrastructureService, only its docker pass stubbed:
 * one service across calls, and each call's definition is what it reconciles.
 */
import { describe, expect, it, vi } from 'vitest';

import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';
import { InfrastructureRpcService } from '../../src/services/infrastructure.rpc-service.js';

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => quiet() }) as never;

const tiles = (image: string) => ({ ports: { http: 80 }, env: {}, docker: { image } });

describe('a node asked twice', () => {
  it('reconciles what the second call declares, on the service the first call built', async () => {
    let hosted: InfrastructureService | null = null;
    const host = vi.fn((config: never, declared: never, registry: never, overrides: never) => {
      hosted = new InfrastructureService(quiet(), config, declared, registry, overrides, false);
      vi.spyOn(hosted, 'provision').mockResolvedValue({ services: {}, ready: true } as never);
      return hosted;
    });
    const node = new InfrastructureRpcService(() => hosted, host as never);
    const desired = () =>
      (hosted as unknown as { desiredContainers: ResolvedContainer[] }).desiredContainers.map((c) => `${c.name} ${c.image}`);

    // The stack as daos/test declared it: the service there, and disabled.
    await node.provisionStack({
      project: 'daos',
      stack: 'test',
      config: { services: { tiles: tiles('tiles:1') } },
      overrides: { tiles: { disabled: true } },
    } as never);
    expect(desired()).toEqual([]);
    const first = hosted;

    // The next deployment drops the `disabled` and moves the image.
    await node.provisionStack({
      project: 'daos',
      stack: 'test',
      config: { services: { tiles: tiles('tiles:2') } },
      overrides: {},
    } as never);

    expect(host).toHaveBeenCalledTimes(1);
    expect(hosted).toBe(first);
    expect(desired()).toEqual(['daos-test-tiles tiles:2']);
    expect(hosted!.getNormalizedServices()['tiles']).toMatchObject({ docker: { image: 'tiles:2' } });
  });
});
