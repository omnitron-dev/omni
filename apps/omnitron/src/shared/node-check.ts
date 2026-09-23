/**
 * What one check of a node's omnitron found — one reading for the uptime
 * strip's aggregate (`NodeHealthRepository.getUptimeBar`, in SQL) and the
 * console's status dot, and the words the checker writes for it to read.
 *
 * A check MEASURED omnitron only when it answered the question: omnitron
 * was running, or the node said it was not. Everything else measured
 * nothing, and says why:
 *
 *   - `not-installed` — the node has no omnitron; nothing there to be down;
 *   - `unreachable`   — no SSH session, so nothing was asked;
 *   - `unread`        — a session, and an answer that could not be read: a
 *                       timeout, output that was not JSON, an exec that
 *                       failed, or the old reader's NULL (migration 009).
 *
 * Both readers counted every error with SSH up as «not running», and matched
 * «not installed» anywhere in the text — so a timeout, whose message echoes
 * the command and the command contains «omnitron: command not found», read
 * as not installed: 19 such rows on the master, 2026-09-15 → 09-22, and the
 * console's dot said «Not installed on this node» after one.
 *
 * Imported by the console through `@omnitron-dev/omnitron/node-check`, so
 * nothing here may need Node.
 */

/** The checker's answer when omnitron's status said no daemon runs. */
export const NOT_RUNNING = 'omnitron status reported no running daemon';

/** The checker's answer, first on the line, when the node has no omnitron. */
export const NOT_INSTALLED = 'omnitron: command not found';

export type OmnitronFinding = 'running' | 'not-running' | 'not-installed' | 'unreachable' | 'unread';

/** The fields of a check this is read from — a history row or a live status. */
export interface OmnitronCheck {
  readonly sshConnected: boolean | null;
  readonly omnitronConnected: boolean | null;
  readonly omnitronError?: string | null;
}

export function omnitronFinding(check: OmnitronCheck): OmnitronFinding {
  if (check.omnitronConnected === true) return 'running';
  const error = check.omnitronError ?? '';
  if (error.startsWith(NOT_INSTALLED)) return 'not-installed';
  if (check.sshConnected === false) return 'unreachable';
  if (check.omnitronConnected === false && error === NOT_RUNNING) return 'not-running';
  return 'unread';
}
