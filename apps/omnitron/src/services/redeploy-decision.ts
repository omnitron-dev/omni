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

/**
 * Whether the node has to be told to start its stack at all.
 *
 * `decideRedeploy` above decides per app, and it was right — and it was
 * overruled. Measured on 2026-09-22, a deployment with nothing to do:
 *
 *     05:51:20  The node now knows what to run   changed=false
 *               detail: «Stack daos/deployed started — 6/6 apps online»
 *     05:51:26  Left running — this deployment changes nothing for this app  ×6
 *     05:51:40  every app on the node has a new pid
 *
 * The master wrote «left running» about six applications it had restarted
 * twenty seconds earlier, because registering the config ends in an
 * unconditional `omnitron stack start` ON THE NODE, which starts everything
 * the node's config lists. The per-app decision came after, and by then
 * `appsOnline` reported them all up — started by this same deployment — so
 * `leave` was the answer to a question the restart had already settled.
 *
 * The decision has to be taken before the node is told, which is what this
 * is for. It is deliberately coarse: the bulk start is a stack-wide command,
 * so the only thing worth asking of it is whether it has anything to do at
 * all. When one app of six changed, this says `start` and the node restarts
 * six; narrowing that is a per-app start on the node, not a condition here.
 *
 * Every uncertainty answers `start`: `appsOnline` returns an empty set when
 * the node cannot be asked, and an app nobody can vouch for is an app that
 * has to be started.
 */

export interface NodeStackStartInput {
  /** Whether the config body this node runs the apps with is about to change. */
  readonly configChanged: boolean;
  /** The apps this deployment put on the node. */
  readonly apps: readonly string[];
  /** What the node reports online right now — empty when it could not be asked. */
  readonly online: ReadonlySet<string>;
}

export type NodeStackStartDecision =
  | { readonly action: 'start'; readonly because: string }
  | { readonly action: 'leave'; readonly because: string };

export function decideNodeStackStart(input: NodeStackStartInput): NodeStackStartDecision {
  // Nothing landed is not «nothing to do»: the caller has no list to check
  // against, so it cannot know the node is running what it should.
  if (input.apps.length === 0) {
    return { action: 'start', because: 'no app was named, so nothing here can say the node is running them' };
  }

  if (input.configChanged) {
    return { action: 'start', because: 'the configuration these apps run with changed' };
  }

  const down = input.apps.filter((app) => !input.online.has(app));
  if (down.length > 0) {
    return {
      action: 'start',
      because: `${down.length} of ${input.apps.length} are not running on the node: ${down.join(', ')}`,
    };
  }

  return {
    action: 'leave',
    because: `all ${input.apps.length} are running with the configuration they already had`,
  };
}

/**
 * Whether the node's daemon has to be taken down and brought back.
 *
 * Provisioning ends with `omnitron down 2>/dev/null; omnitron up --slave`, and
 * the comment beside it says «or restart if already running» — which is true,
 * and costs every application on that node. `down` stops the daemon and
 * everything under it; `up` boots it and its boot-resume starts them again.
 *
 * Measured on 2026-09-22, and it took three deployments to attribute. A
 * deployment with nothing to do skipped every build, transferred no byte,
 * skipped the node-side `stack start` by `decideNodeStackStart` above — and
 * every pid on the node still changed:
 *
 *     07:25:46  Slave node provisioned
 *     07:25:47  every application on the node starts, 1–3 s later
 *     07:26:15  its stack was not restarted   started=false
 *     07:26:21  Left running — this deployment changes nothing   ×6
 *
 * With the other path closed, the attribution is unambiguous: this is the one
 * that restarts them. The applications came back a second after provisioning
 * and half a minute before the deployment decided to leave them alone.
 *
 * What makes a restart necessary is a change UNDER the daemon — a runtime or
 * an omnitron the host did not have — and `plan.steps` is exactly that list.
 * An empty plan means the host already had everything, and a daemon already
 * running as a slave on an unchanged host has nothing to gain from being
 * killed. Every uncertainty restarts: a node that cannot say what it is
 * running is a node whose daemon gets rebuilt from a known state.
 */

export interface SlaveDaemonInput {
  /** Whether preparing the host changed anything on it. */
  readonly hostChanged: boolean;
  /** What the node says about its own daemon, or null when it would not say. */
  readonly daemon: { readonly running: boolean; readonly role?: 'master' | 'slave' } | null;
}

export type SlaveDaemonDecision =
  | { readonly action: 'restart'; readonly because: string }
  | { readonly action: 'leave'; readonly because: string };

export function decideSlaveDaemonRestart(input: SlaveDaemonInput): SlaveDaemonDecision {
  if (input.hostChanged) {
    return { action: 'restart', because: 'the host was prepared, so something under the daemon changed' };
  }
  if (input.daemon === null) {
    return { action: 'restart', because: 'the node would not say what its daemon is doing' };
  }
  if (!input.daemon.running) {
    return { action: 'restart', because: 'the node daemon is not running' };
  }
  // An explicit `master` is a wrong role and earns the restart. An ABSENT
  // one is not evidence of anything, and demanding `=== 'slave'` made this
  // whole decision unsatisfiable: measured 2026-09-22 against the test node,
  //
  //     because=the node daemon is running as no role it would name
  //     steps=0  role=null  pid=1237622  uptime=273875
  //
  // — a daemon plainly up, on a host that needed nothing, taken down anyway
  // because `omnitron status --json` on that node carries no `role` field at
  // all. A guard keyed on a value nobody writes is a guard that always
  // fires, and this one fired by taking six applications down with it.
  if (input.daemon.role === 'master') {
    return { action: 'restart', because: 'the node daemon is running as a master, not as a slave' };
  }
  return {
    action: 'leave',
    because: input.daemon.role === 'slave'
      ? 'the node daemon is already running as a slave and nothing under it changed'
      : 'the node daemon is running, it does not name a role, and nothing under it changed',
  };
}
