/**
 * DockerHealthIndicator — Health indicator for Docker daemon and managed containers
 *
 * Checks:
 *   1. Docker daemon is reachable
 *   2. All managed containers are running and healthy
 *
 * Returns 'healthy' when all containers are running, 'degraded' when some are
 * unhealthy, and 'unhealthy' when Docker is unreachable or critical containers are down.
 */

import { HealthIndicator, type HealthIndicatorResult } from '@omnitron-dev/titan-health';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';

export class DockerHealthIndicator extends HealthIndicator {
  readonly name = 'docker';

  constructor(private readonly getInfra: () => InfrastructureService | null) {
    super();
  }

  async check(): Promise<HealthIndicatorResult> {
    const infra = this.getInfra();
    if (!infra) {
      return this.healthy('Infrastructure not provisioned (standalone mode)');
    }

    const state = infra.getState();
    const services = Object.values(state.services);

    if (services.length === 0) {
      return this.healthy('No managed containers');
    }

    const running = services.filter((s) => s.status === 'running');
    const unhealthy = services.filter((s) => s.health === 'unhealthy');
    const down = services.filter((s) => s.status !== 'running');

    const details = {
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
      return this.unhealthy(
        `${down.length} container(s) not running: ${down.map((s) => s.name).join(', ')}`,
        details
      );
    }

    if (unhealthy.length > 0) {
      return this.degraded(
        `${unhealthy.length} container(s) unhealthy: ${unhealthy.map((s) => s.name).join(', ')}`,
        details
      );
    }

    return this.healthy(`All ${services.length} containers running`, details);
  }
}
