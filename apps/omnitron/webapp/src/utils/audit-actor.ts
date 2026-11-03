/** Human-readable identity kinds without changing the recorded principal. */

/** The account the daemon grants its unix socket, where the CLI arrives. */
export const LOCAL_CALLER = 'omnitron-local';

/** A generated id, where eight characters tell rows apart. */
const GENERATED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

export interface ActorWords {
  readonly text: string;
  readonly title: string;
  readonly kind: 'local' | 'user' | 'service' | 'system' | 'unknown';
}

export function actorWords(actorId: string | null, actorType: string): ActorWords {
  if (actorId === LOCAL_CALLER && actorType === 'user') {
    return {
      text: 'Local client',
      title:
        "omnitron-local: CLI or a local tool through the daemon's owner-only Unix socket; this record does not identify a person or a specific tool",
      kind: 'local',
    };
  }
  if (actorId) {
    const label = GENERATED_ID.test(actorId) ? `${actorId.slice(0, 8)}…` : actorId;
    return {
      text: `${actorType === 'user' ? 'User' : actorType === 'service' ? 'Service' : actorType}: ${label}`,
      title: `${actorType}: ${actorId}`,
      kind: actorType === 'user' || actorType === 'service' || actorType === 'system' ? actorType : 'unknown',
    };
  }
  if (actorType === 'service') {
    return {
      text: 'Service',
      title: 'Service identity recorded by the control plane; no account identifier was recorded',
      kind: 'service',
    };
  }
  if (actorType === 'system') {
    return {
      text: 'System',
      title:
        'Daemon system identity; no calling account was recorded. Historical records do not identify a specific initiator.',
      kind: 'system',
    };
  }
  return { text: actorType || 'Unknown', title: actorType || 'No actor kind recorded', kind: 'unknown' };
}
