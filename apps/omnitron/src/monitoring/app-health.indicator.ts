/**
 * AppHealthIndicator — Health indicator for managed Titan applications
 *
 * Checks the status of all managed apps via the orchestrator.
 * Returns 'healthy' when all apps are online, 'degraded' when some are
 * crashed/errored, and 'unhealthy' when critical apps are down.
 */

import { HealthIndicator, type HealthIndicatorResult } from '@omnitron-dev/titan-health';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';

export class AppHealthIndicator extends HealthIndicator {
  readonly name = 'apps';

  constructor(private readonly orchestrator: OrchestratorService) {
    super();
  }

  async check(): Promise<HealthIndicatorResult> {
    const apps = this.orchestrator.list();

    if (apps.length === 0) {
      return this.healthy('No managed applications');
    }

    const online = apps.filter((a) => a.status === 'online');
    const crashed = apps.filter((a) => a.status === 'crashed' || a.status === 'errored');
    const critical = crashed.filter((a) => a.critical);

    const details = {
      total: apps.length,
      online: online.length,
      crashed: crashed.length,
      criticalDown: critical.length,
      apps: apps.map((a) => ({
        name: a.name,
        status: a.status,
        critical: a.critical,
        restarts: a.restarts,
      })),
    };

    if (critical.length > 0) {
      return this.unhealthy(
        `Critical app(s) down: ${critical.map((a) => a.name).join(', ')}`,
        details
      );
    }

    if (crashed.length > 0) {
      return this.degraded(
        `${crashed.length} app(s) crashed: ${crashed.map((a) => a.name).join(', ')}`,
        details
      );
    }

    return this.healthy(`All ${apps.length} apps online`, details);
  }
}
