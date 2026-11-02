import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { IDaemonConfig } from '../config/types.js';
import type { StopAudience } from './stop-authority.js';
import { electionConfig } from './leader-election.js';

export const CLUSTER_ENROLLMENT_KEY = 'lifecycle:cluster-enrollment:v1';
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** Losing a configuration file or changing an address must not downgrade an enrolled recipient. */
export function clusterEnrollment(config: IDaemonConfig['cluster'], state: Pick<DaemonStateStore, 'kvGetSync' | 'kvUpdateSync'>): StopAudience | null {
  if (config !== undefined && (!config || typeof config.enabled !== 'boolean')) throw new Error('Invalid daemon cluster configuration');
  if (!config?.enabled) {
    if (state.kvGetSync(CLUSTER_ENROLLMENT_KEY, { strict: true }) !== null) throw new Error('This node is enrolled in a cluster; restore its cluster configuration before accepting operations');
    return null;
  }
  if ((config.discovery && config.discovery !== 'postgres') || config.peers !== undefined || config.electionTimeout !== undefined) {
    throw new Error('Cluster coordination requires PostgreSQL; legacy discovery and peer voting are unsupported');
  }
  if (typeof config.clusterId !== 'string' || !identifier.test(config.clusterId) || typeof config.recipientId !== 'string' || !identifier.test(config.recipientId)) {
    throw new Error('Cluster mode requires explicit clusterId and recipientId');
  }
  electionConfig({ clusterId: config.clusterId,
    ...(config.leaseTtlMs !== undefined && { leaseTtlMs: config.leaseTtlMs }),
    ...(config.heartbeatInterval !== undefined && { heartbeatInterval: config.heartbeatInterval }) });
  const audience = { clusterId: config.clusterId, nodeId: config.recipientId };
  return state.kvUpdateSync<StopAudience>(CLUSTER_ENROLLMENT_KEY, previous => {
    if (previous && (previous.clusterId !== audience.clusterId || previous.nodeId !== audience.nodeId)) {
      throw new Error('Cluster enrollment changed; reconcile the previous recipient identity first');
    }
    return audience;
  });
}

/** No fallback to the local development database. External authority traffic requires verified TLS. */
export function clusterDatabaseUrl(source: string | undefined): string {
  let url: URL;
  try { url = new URL(source ?? ''); } catch { throw new Error('Cluster mode requires OMNITRON_CLUSTER_DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) throw new Error('Invalid cluster authority database URL');
  if ([...url.searchParams.keys()].some(key => !['sslmode','sslrootcert'].includes(key)) ||
      url.searchParams.getAll('sslmode').length > 1 || url.searchParams.getAll('sslrootcert').length > 1) throw new Error('Unsupported cluster authority connection parameters');
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Remote cluster authority requires sslmode=verify-full');
  }
  return url.href;
}
