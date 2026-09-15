/**
 * Whether provisioning actually provisioned anything.
 *
 * `provision()` set `state.ready = true` and logged "Infrastructure
 * provisioned and healthy" as the last two statements of its `try`,
 * unconditionally. Every service reconciles inside a `Promise.all` whose
 * per-service `catch` records `status: 'exited'` and continues, so a run in
 * which every container failed ended exactly like a run in which all of them
 * came up.
 *
 * `omnitron infra up` then printed
 *
 *     Infrastructure ready:
 *
 * as a heading, before looking at anything, and listed whatever
 * `state.services` happened to hold. An empty object printed the heading and
 * nothing else — and an empty enumeration of problems reads as "no
 * problems". Observed three times in one shift on a host under memory
 * pressure, with `daos-dev-postgres` and `daos-dev-redis` absent from
 * `docker ps -a` entirely at the moment it said so.
 *
 * The cost is separate from the cause. A control plane that reports health
 * when the database is gone sends whoever reads it to look at their own
 * change: one colleague reverted a correct fix after reading
 * `Module "TitanRedisModule" failed to initialize`, because the line above it
 * said the infrastructure was fine. The full error said
 * `Redis client "default" connection timed out`.
 *
 * Three states have to be distinguishable, and two of them looked identical
 * because both produced an empty list of complaints:
 *
 *   - declared, present, running;
 *   - declared, present, not running — an error to show;
 *   - declared and MISSING — nothing even tried, which is the one that
 *     looks like success.
 */

import type { ContainerState, ContainerStatus } from './types.js';

export interface ServiceOutcome {
  name: string;
  image: string | undefined;
  status: ContainerStatus | 'missing';
  error: string | undefined;
}

export interface ProvisioningOutcome {
  /** True only when everything declared is present and running. */
  ready: boolean;
  /** Nothing was declared — not the same as everything being fine. */
  empty: boolean;
  running: ServiceOutcome[];
  /** Present and not running, or running and reporting unhealthy. */
  failed: ServiceOutcome[];
  /** Declared, and absent from the state entirely. */
  missing: ServiceOutcome[];
}

/**
 * A container that is running is not necessarily working.
 *
 * Docker's own health probe is the only thing here that has looked inside,
 * so `unhealthy` outranks `running`. `starting` does not: a container in its
 * first probe window is not yet a failure, and calling it one would make
 * every provisioning run fail for the seconds before the first check.
 */
function isUp(state: ContainerState): boolean {
  return state.status === 'running' && state.health !== 'unhealthy';
}

export function summariseProvisioning(
  desired: readonly { name: string; image?: string | undefined }[],
  services: Readonly<Record<string, ContainerState>>,
): ProvisioningOutcome {
  const running: ServiceOutcome[] = [];
  const failed: ServiceOutcome[] = [];
  const missing: ServiceOutcome[] = [];

  const seen = new Set<string>();

  for (const want of desired) {
    seen.add(want.name);
    const state = services[want.name];
    if (!state) {
      // The state that reads as success. Nothing tried, so nothing failed,
      // so there is nothing in any list of problems.
      missing.push({ name: want.name, image: want.image, status: 'missing', error: undefined });
      continue;
    }
    (isUp(state) ? running : failed).push({
      name: state.name,
      image: state.image,
      status: state.status,
      error: state.error ?? (state.health === 'unhealthy' ? 'container reports unhealthy' : undefined),
    });
  }

  // Services provisioned outside the declared set — omnitron's own Postgres
  // is one — count against readiness when they are down. They were left out
  // of this decision entirely, and a master with no control-plane database
  // is not a healthy master.
  for (const [name, state] of Object.entries(services)) {
    if (seen.has(name)) continue;
    (isUp(state) ? running : failed).push({
      name: state.name ?? name,
      image: state.image,
      status: state.status,
      error: state.error ?? (state.health === 'unhealthy' ? 'container reports unhealthy' : undefined),
    });
  }

  const empty = desired.length === 0 && Object.keys(services).length === 0;

  return {
    ready: !empty && failed.length === 0 && missing.length === 0,
    empty,
    running,
    failed,
    missing,
  };
}

/** One line saying what happened, for a log that has to be readable alone. */
export function describeProvisioning(outcome: ProvisioningOutcome): string {
  if (outcome.empty) return 'Infrastructure: nothing is declared, so nothing was provisioned';
  if (outcome.ready) return `Infrastructure provisioned and healthy (${outcome.running.length} services)`;

  const parts: string[] = [];
  if (outcome.missing.length > 0) parts.push(`${outcome.missing.length} missing (${outcome.missing.map((s) => s.name).join(', ')})`);
  if (outcome.failed.length > 0) parts.push(`${outcome.failed.length} not running (${outcome.failed.map((s) => s.name).join(', ')})`);
  return `Infrastructure is NOT ready — ${parts.join('; ')}`;
}
