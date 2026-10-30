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
import type { InfrastructureHealthContext } from './infrastructure-health.js';

type Seen = Pick<ContainerState, 'name' | 'status' | 'health' | 'project' | 'stack'>;

export class DockerHealthIndicator extends HealthIndicator {
  readonly name = 'docker';

  constructor(
    private readonly getInfra: () => InfrastructureService | null,
    /** What Docker says this host's omnitron manages; throws when Docker cannot be asked. */
    private readonly readContainers: () => Promise<Seen[]> = async () => {
      const { listManagedContainers } = await import('../infrastructure/container-runtime.js');
      return listManagedContainers({ orThrow: true });
    },
    private readonly getContext?: () => InfrastructureHealthContext,
  ) {
    super();
  }

  async check(): Promise<HealthIndicatorResult> {
    const infra = this.getInfra();
    if (infra && !this.getContext) return this.judge(Object.values(infra.getState().services), 'reconciler');

    let seen: Seen[];
    try {
      seen = await this.readContainers();
    } catch (err) {
      return this.unhealthy(`Docker did not answer: ${(err as Error).message}`);
    }
    if (!this.getContext) return this.judge(seen, 'docker');
    let context: InfrastructureHealthContext;
    try { context = this.getContext(); }
    catch { return this.degraded('Docker answered, but local stack intent could not be read. Check project configuration and daemon logs.'); }
    const required = new Set([...context.requiredContainers, ...(infra?.getDesiredServices().map(s => s.name) ?? [])]);
    const scopes = new Map(context.stacks.map(s => [`${s.project}/${s.stack}`, s.intent]));
    const inventories = new Map(context.stacks.filter(s => s.containers !== undefined).map(s => [`${s.project}/${s.stack}`, new Set(s.containers)]));
    const failures: string[] = [];
    const warnings: string[] = context.unresolvedStacks.map(s => `${s}: enabled infrastructure has not been reconciled; inspect stack startup logs`);
    const inactive: string[] = [];
    const retired: string[] = [];
    for (const name of required) {
      if (!seen.some(s => s.name === name)) failures.push(`${name}: required container is missing; inspect stack provisioning`);
    }
    for (const service of seen) {
      const intent = required.has(service.name) ? 'running' : scopes.get(`${service.project}/${service.stack}`) ?? 'unknown';
      const inventory = inventories.get(`${service.project}/${service.stack}`);
      const noLongerDeclared = !required.has(service.name) && inventory !== undefined && !inventory.has(service.name);
      if (service.status !== 'running') {
        if (noLongerDeclared && ['exited', 'created'].includes(service.status)) {
          retired.push(service.name);
        } else if (intent === 'inactive' && ['exited', 'created'].includes(service.status)) {
          inactive.push(service.name);
        } else {
          const message = `${service.name}: ${service.status}; ${intent === 'running' ? 'required by an active stack, inspect container logs' : 'desired state is not established, inspect stack ownership'}`;
          (intent === 'running' ? failures : warnings).push(message);
        }
      } else if (service.health === 'unhealthy' || service.health === 'starting') {
        warnings.push(`${service.name}: healthcheck ${service.health}; inspect its probe output`);
      } else if (noLongerDeclared) {
        warnings.push(`${service.name}: running outside the stack's current reconciler inventory; review the retired service before cleanup`);
      }
    }
    const details = { source: 'docker+desired-state', total: seen.length, running: seen.filter(s => s.status === 'running').length,
      inactive, retired, failures, warnings, services: seen.map(s => ({ ...s, intent: required.has(s.name) ? 'running' : scopes.get(`${s.project}/${s.stack}`) ?? 'unknown' })) };
    const message = [...failures, ...warnings].join('; ');
    if (failures.length) return this.unhealthy(message, details);
    if (warnings.length) return this.degraded(message, details);
    return this.healthy(`${details.running} managed containers running${inactive.length ? `; ${inactive.length} intentionally stopped in disabled local stacks: ${inactive.join(', ')}` : ''}${retired.length ? `; ${retired.length} stopped containers no longer declared by their stack: ${retired.join(', ')}` : ''}.`, details);
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
