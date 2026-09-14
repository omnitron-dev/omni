/**
 * "The daemon did not answer" said honestly, in one place.
 *
 * Twenty-five command files asked `client.isReachable()` and, on false,
 * printed `Daemon is not running`. That is one of three things the false can
 * mean, and it is the only one whose advice — start it — is right. A daemon
 * mid-boot answers nothing for as long as its apps take to come up, and
 * during that window every command in the CLI told the operator the daemon
 * was down while it was in fact running and about to serve them. Observed
 * twice in one session on the development host; the second time it nearly
 * went into a report as evidence that the stand was dead.
 *
 * `status.ts` got this right, for itself, with its own copy of the pid-file
 * check. The distinction now lives in `DaemonClient.whyUnreachable()` and the
 * wording lives here, so a command needs one call to get both.
 */

import { log } from '@xec-sh/kit';

import type { DaemonAbsence, DaemonClient } from '../daemon/daemon-client.js';
import { emitError, isJsonMode } from './output.js';

/** One line saying what happened, in the operator's terms. */
export function describeAbsence(absence: DaemonAbsence): string {
  switch (absence.kind) {
    case 'stopped':
      return 'Daemon is not running';
    case 'stale':
      return `Daemon is not running — a pid file from PID ${absence.pid} is left over from a crash`;
    case 'silent':
      return `Daemon is running (PID ${absence.pid}) but did not answer within ${Math.round(absence.waitedMs / 1000)}s`;
    case 'unknown':
      return `Could not reach the daemon: ${absence.reason}`;
  }
}

/** What to do about it, when there is something useful to say. */
export function adviseAbsence(absence: DaemonAbsence): string | null {
  switch (absence.kind) {
    case 'stopped':
      return 'Start it with `omnitron up`.';
    case 'stale':
      return 'Start it with `omnitron up` — the stale file is cleaned up on the next start.';
    case 'silent':
      // The common case during a stack boot, and the one where the old
      // message sent the operator to start a daemon that was already there.
      return 'It is most likely busy starting apps. Retry shortly, or `omnitron down` to stop it.';
    case 'unknown':
      return null;
  }
}

/**
 * Report that the daemon is unavailable, with the reason.
 *
 * `context` is appended to the first line for commands that have something
 * specific to add ("cannot perform health check").
 */
export function reportAbsence(absence: DaemonAbsence, context?: string): void {
  const headline = context ? `${describeAbsence(absence)} — ${context}` : describeAbsence(absence);
  if (isJsonMode()) {
    emitError(headline);
    return;
  }
  // A daemon that is running is not an error condition for the operator to
  // fix; it is something to wait out.
  if (absence.kind === 'silent') log.warn(headline);
  else log.error(headline);

  const advice = adviseAbsence(absence);
  if (advice && !isJsonMode()) log.info(advice);
}

/**
 * Reachability with the reporting attached: `true` when the daemon answered,
 * `false` after saying why it did not.
 */
export async function requireDaemon(client: DaemonClient, context?: string): Promise<boolean> {
  const absence = await client.whyUnreachable();
  if (absence === null) return true;
  reportAbsence(absence, context);
  return false;
}
