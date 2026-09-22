/**
 * DockerHealthIndicator — Health indicator for Docker daemon and managed containers
 *
 * Checks:
 *   1. Docker daemon is reachable
 *   2. All managed containers are running and healthy
 *
 * Returns 'healthy' when all containers are running, 'degraded' when some are
 * unhealthy, and 'unhealthy' when Docker is unreachable or critical containers are down.
 *
 * Two sources, in order. A reconciler in this process knows the DESIRED set,
 * so a container of it that is not running is a failure. Without one it is
 * Docker that knows what is there — and this used to answer «Infrastructure
 * not provisioned (standalone mode)», `healthy`, on exactly the hosts that
 * have the most running: a node since its restart, until the master next
 * provisions it, and a master whose stacks own their infrastructure. Measured
 * 2026-09-22 on both, each with six apps' worth of containers up.
 */

import { HealthIndicator, type HealthIndicatorResult } from '@omnitron-dev/titan-health';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { ContainerState } from '../infrastructure/types.js';

type Seen = Pick<ContainerState, 'name' | 'status' | 'health'>;

export class DockerHealthIndicator extends HealthIndicator {
  readonly name = 'docker';

  constructor(
    private readonly getInfra: () => InfrastructureService | null,
    /** What Docker says this host's omnitron manages; throws when Docker cannot be asked. */
    private readonly readContainers: () => Promise<Seen[]> = async () => {
      const { listManagedContainers } = await import('../infrastructure/container-runtime.js');
      return listManagedContainers({ orThrow: true });
    },
  ) {
    super();
  }

  async check(): Promise<HealthIndicatorResult> {
    const infra = this.getInfra();
    if (infra) return this.judge(Object.values(infra.getState().services), 'reconciler');

    let seen: Seen[];
    try {
      seen = await this.readContainers();
    } catch (err) {
      return this.unhealthy(`Docker did not answer: ${(err as Error).message}`);
    }
    return this.judge(seen, 'docker');
  }

  private judge(services: Seen[], source: 'reconciler' | 'docker'): HealthIndicatorResult {
    if (services.length === 0) {
      return this.healthy(source === 'docker' ? 'No managed containers on this host' : 'No managed containers');
    }

    const running = services.filter((s) => s.status === 'running');
    const unhealthy = services.filter((s) => s.health === 'unhealthy');
    const down = services.filter((s) => s.status !== 'running');

    const details = {
      source,
      total: services.length,
      running: running.length,
      unhealthy: unhealthy.length,
      down: down.length,
      services: services.map((s) => ({
        name: s.name,
        status: s.status,
        health: s.health ?? 'unknown',
      })),
    };

    if (down.length > 0) {
      const names = down.map((s) => s.name).join(', ');
      // Docker lists what exists, not what is wanted: a stopped container may
      // be one a removed stack left behind. Said, and not called a failure.
      return source === 'reconciler'
        ? this.unhealthy(`${down.length} container(s) not running: ${names}`, details)
        : this.degraded(
            `${down.length} managed container(s) not running: ${names} — no reconciler in this daemon since its start says whether they are wanted`,
            details,
          );
    }

    if (unhealthy.length > 0) {
      return this.degraded(
        `${unhealthy.length} container(s) unhealthy: ${unhealthy.map((s) => s.name).join(', ')}`,
        details
      );
    }

    return this.healthy(
      source === 'docker'
        ? `All ${services.length} managed containers running (read from Docker: no reconciler in this daemon since its start)`
        : `All ${services.length} containers running`,
      details,
    );
  }
}
