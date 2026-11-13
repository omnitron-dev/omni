import type { DaemonRole } from '../config/types.js';
import { getEnv } from '../shared/env-config.js';

/** Prepare the control-plane schema before Nexus initializes database consumers. */
export async function prepareDaemonDatabase(
  role: DaemonRole,
  options: { noInfra?: boolean; handoff?: boolean; retainedDatabase?: string | null } = {},
): Promise<void> {
  if (role === 'slave') return;

  const { assertOmnitronMigrationsCurrent, runOmnitronMigrations } = await import('../database/migration-runner.js');
  if (options.handoff) {
    // A replacement may only read the schema prepared for both directions of
    // the transition. Do this before resolving providers or claiming the owner.
    await assertOmnitronMigrationsCurrent();
    return;
  }

  // --no-infra suppresses Docker provisioning, not the master's schema.
  // An explicitly supplied database belongs to its operator, not our Docker
  // allocator; never create or recreate a local container for that address.
  if (options.retainedDatabase !== undefined) {
    const managed = !options.noInfra && !getEnv().OMNITRON_DATABASE_URL;
    if (managed !== (options.retainedDatabase !== null)) throw Error('Control-plane database ownership changed since local update review');
  }
  if (!options.noInfra && !getEnv().OMNITRON_DATABASE_URL) {
    const { resolveOmnitronPg } = await import('../infrastructure/service-resolver.js');
    const { createContainer, waitForHealthy, startContainer } =
      await import('../infrastructure/container-runtime.js');
    const { inspectControlPlaneDatabase, moveControlPlaneDatabase } = await import('./control-plane-database.js');
    const desired = resolveOmnitronPg();
    let plan = await inspectControlPlaneDatabase(desired);
    if (options.retainedDatabase !== undefined && (plan.action !== 'retain' || plan.id !== options.retainedDatabase))
      throw Error('The local update requires the same running control-plane PostgreSQL container');
    if (plan.action === 'create' || plan.action === 'start' || plan.action === 'wait') {
      const id = plan.action === 'create' ? await createContainer(desired) : plan.id;
      if (plan.action === 'start') await startContainer(id);
      if (!await waitForHealthy(id, 60_000)) throw Error('Omnitron internal database did not become healthy before startup');
      plan = await inspectControlPlaneDatabase(desired);
      if (!('id' in plan) || !plan.id.startsWith(id)) throw Error('Control-plane database identity changed while waiting for readiness');
    }
    if (plan.action === 'move-network') await moveControlPlaneDatabase(desired, plan.move);
    else if (plan.action !== 'retain') throw Error('Control-plane PostgreSQL requires review: ' +
      (plan.action === 'hold' ? plan.reason : plan.action));
  }

  // Propagate failure: a master without its auth, audit and operation journals
  // must not open public listeners or initialize services against partial DDL.
  await runOmnitronMigrations();
}
