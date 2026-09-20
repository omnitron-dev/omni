/**
 * Whether a deployment has anything to do for one app.
 *
 * A master restarts — an upgrade, a crash, a laptop waking — and its
 * boot-time autostart deploys every remote stack again. That is right in
 * principle: the master is the authority on what a node should run. In
 * practice it meant the same six artifacts were rebuilt, transferred,
 * unpacked, `npm install`ed and the six applications restarted, every time,
 * whether or not a single byte had changed.
 *
 * Measured across one afternoon of this session: four master restarts, four
 * full redeploys, twenty-four application restarts on a node whose files
 * were identical each time — with every restart's downtime visible from the
 * onion.
 *
 * So: three facts decide, and each is measurable rather than assumed.
 *
 *   - the artifact's sha256 against the one the node recorded when it
 *     installed what it has;
 *   - whether the app is running there NOW;
 *   - whether the configuration it would be started with is about to change
 *     — credentials, addresses, the app list — because identical files with
 *     a different environment is a different deployment.
 *
 * `leave` is the only new outcome. Everything else behaves as it did.
 */

export interface RedeployInput {
  /**
   * Whether the files on the node differ from the ones this deployment
   * would ship — `null` when nobody could tell, which is not the same as
   * "they are the same" and is never treated as such.
   */
  readonly artifactChanged: boolean | null;
  /** Whether the node reports this app online right now. */
  readonly online: boolean;
  /** Whether the config this node runs the app with is about to change. */
  readonly configChanged: boolean;
}

export type RedeployDecision =
  /** Ship it: the files differ, or the node cannot say what it has. */
  | { readonly action: 'deploy'; readonly because: string }
  /** Same files; start it because it is down, or because its config moved. */
  | { readonly action: 'restart'; readonly because: string }
  /** Same files, running, same config. Nothing to do, and doing it costs a restart. */
  | { readonly action: 'leave'; readonly because: string };

export function decideRedeploy(input: RedeployInput): RedeployDecision {
  // "We could not tell" is not "it is the same". A node that never recorded
  // a checksum — installed by an older master, or by hand — is deployed to.
  if (input.artifactChanged === null) {
    return { action: 'deploy', because: 'the node has no record of what it installed' };
  }

  if (input.artifactChanged) {
    return { action: 'deploy', because: 'the artifact changed' };
  }

  if (!input.online) {
    return { action: 'restart', because: 'the same artifact is installed and the app is not running' };
  }

  if (input.configChanged) {
    return {
      action: 'restart',
      because: 'the same artifact is installed and the configuration it runs with changed',
    };
  }

  return { action: 'leave', because: 'the same artifact is installed, running, with the same configuration' };
}

/**
 * Whether what the node has is what this deployment would ship.
 *
 * `null` when the answer cannot be had: no record on the node, or an
 * artifact with no checksum of its own. Both are "ask again after
 * shipping it", never "nothing to do".
 */
export function artifactChanged(recorded: string | null, checksum: string | undefined): boolean | null {
  if (!recorded || !checksum) return null;
  return recorded !== checksum;
}

/** Where a node records the checksum of the artifact it installed. */
export const ARTIFACT_CHECKSUM_FILE = '.artifact-sha256';

/**
 * Where a node records the hash of the app definitions it was given.
 *
 * Beside the config rather than derived from it on demand: the body holds
 * every generated credential on that node, and it should cross the wire once,
 * in the direction it has to.
 */
export const NODE_CONFIG_HASH_FILE = '.omnitron-config-sha256';

/**
 * Read that record without turning "there is none" into a failure.
 *
 * `cat` of a missing file exits 1, and an `|| true` would swallow a
 * permission error and an unreachable host with it. This exits 0 for the two
 * states it knows about and leaves every other failure to the SSH layer.
 */
export function readChecksumCommand(remotePath: string, file: string = ARTIFACT_CHECKSUM_FILE): string {
  return `if [ -f ${remotePath}/${file} ]; then cat ${remotePath}/${file}; else echo '__none__'; fi`;
}

/** What `readChecksumCommand` answered, as a checksum or nothing. */
export function parseRecordedChecksum(out: string): string | null {
  const value = out.trim();
  if (!value || value === '__none__') return null;
  // A sha256 and nothing else: a truncated file, or a shell that printed a
  // warning first, must not be compared as though it were one.
  return /^[0-9a-f]{64}$/.test(value) ? value : null;
}
