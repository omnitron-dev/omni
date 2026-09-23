/**
 * Who an audit row names, in words.
 *
 * Since 02815620 the daemon records a call from the CLI or an MCP tool as the
 * account `omnitron-local` — the context it grants every connection on its
 * owner-only unix socket (`daemon.ts`) — and keeps `system` for the daemon
 * acting on its own. The audit page cut every id longer than twelve
 * characters to eight, so the CLI read «omnitron…», and explained `system` as
 * «a local call over the unix socket», which it no longer is.
 */

/** The account the daemon grants its unix socket, where the CLI arrives. */
export const LOCAL_CALLER = 'omnitron-local';

/** A generated id, where eight characters tell rows apart. */
const GENERATED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

export interface ActorWords {
  readonly text: string;
  readonly title: string;
  /** An id, set in monospace; otherwise a kind of caller. */
  readonly id: boolean;
}

export function actorWords(actorId: string | null, actorType: string): ActorWords {
  if (actorId === LOCAL_CALLER) {
    return {
      text: LOCAL_CALLER,
      title:
        "The CLI or an MCP tool on this machine, over the daemon's owner-only unix socket — the trust is the socket's permissions, not a session",
      id: true,
    };
  }
  if (actorId) {
    return { text: GENERATED_ID.test(actorId) ? `${actorId.slice(0, 8)}…` : actorId, title: actorId, id: true };
  }
  if (actorType === 'service') {
    return { text: 'service', title: 'Another omnitron acting as the control plane — service_role, no account behind it', id: false };
  }
  if (actorType === 'system') {
    return {
      text: 'system',
      title: 'The daemon acting on its own — a boot autostart, the enabled-stacks reconciler. Nobody asked.',
      id: false,
    };
  }
  return { text: actorType, title: actorType, id: false };
}
