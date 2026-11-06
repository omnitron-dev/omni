import type { DaemonRole } from '../config/types.js';
import { getEnv } from '../shared/env-config.js';

/** Prepare the control-plane schema before Nexus initializes database consumers. */
export async function prepareDaemonDatabase(
  role: DaemonRole,
  options: { noInfra?: boolean; handoff?: boolean } = {},
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
  if (!options.noInfra && !getEnv().OMNITRON_DATABASE_URL) {
    const { resolveOmnitronPg } = await import('../infrastructure/service-resolver.js');
    const { createContainer, getContainerState, waitForHealthy, ensureImage, removeContainer, createVolume } =
      await import('../infrastructure/container-runtime.js');
    const { ownedContainerId } = await import('../infrastructure/owned-container.js');
    const desired = resolveOmnitronPg();
    const actual = await getContainerState(desired.name, { orThrow: true, fullId: true });
    const id = actual && ownedContainerId(desired, actual);
    if (!actual || actual.status !== 'running' || actual.networkAttached === false) {
      if (id) await removeContainer(id);
      await ensureImage(desired.image);
      for (const volume of desired.volumes) {
        if (!volume.source.startsWith('/')) await createVolume(volume.source);
      }
      await createContainer(desired);
    }
    if (!await waitForHealthy(desired.name, 60_000))
      throw new Error('Omnitron internal database did not become healthy before startup');
  }

  // Propagate failure: a master without its auth, audit and operation journals
  // must not open public listeners or initialize services against partial DDL.
  await runOmnitronMigrations();
}
