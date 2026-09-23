/**
 * The OS supervisor definitions omnitron writes, as pure functions.
 *
 * Separated from `service.ts` so the units can be rendered and read without
 * a machine: every input is an argument, nothing here consults `process` or
 * the filesystem. The command layer supplies the facts.
 *
 * The distinction this file exists for is SCOPE.
 *
 * A `user` service belongs to the account that installed it. On macOS that is
 * a LaunchAgent, on Linux a systemd user unit, and on both it is tied to a
 * login session: the unit says `WantedBy=default.target`, and when the last
 * session for that user ends, systemd stops it. For a workstation that is
 * exactly right — the daemon is there while you are.
 *
 * A slave node is the opposite case. Its entire purpose is to be reachable
 * when nobody is logged in, so a supervision mode whose default is "stops at
 * logout" does not implement the role. `serviceInstall` had only that mode,
 * and printed `Tip: loginctl enable-linger …` beside it. A printed tip is not
 * a control: it changes nothing unless a human reads it, remembers, and runs
 * it, and the failure it prevents shows up hours later as a node that was
 * installed and is gone.
 *
 * So `system` scope: `/etc/systemd/system` and `WantedBy=multi-user.target`
 * on Linux, `/Library/LaunchDaemons` on macOS. Both start at boot with no
 * session involved.
 *
 * Root installs the unit; root does not run the daemon. The unit carries
 * `User=` naming the account that owns `~/.omnitron`, because the daemon's
 * unix socket IS its local authentication check — the whole local trust model
 * is "whoever can open the socket is the owner". A daemon running as root
 * with a socket anywhere shared redefines that silently, from "the owner" to
 * "anyone on the box".
 */

/** Who supervises the daemon, and from where. */
export type ServiceScope = 'user' | 'system';

export interface ServiceIdentity {
  /** Account the daemon runs as. Never root for a system unit. */
  readonly user: string;
  /** That account's home, so `~/.omnitron` resolves to the right place. */
  readonly home: string;
}

export interface UnitInputs {
  readonly scope: ServiceScope;
  /** Absolute path to the node binary. */
  readonly execPath: string;
  /** Absolute path to `daemon-entry.js`. */
  readonly entryPath: string;
  /** Working directory for the supervised daemon. */
  readonly workdir: string;
  /** PATH the service is given — supervisors provide almost none. */
  readonly path: string;
  /** Where stderr is kept. */
  readonly stderrLog: string;
  /** Only meaningful for `system` scope. */
  readonly identity?: ServiceIdentity | undefined;
}

export const LAUNCHD_LABEL = 'dev.omnitron.daemon';
export const SYSTEMD_UNIT = 'omnitron-daemon.service';

/** Where the definition file lives, for a scope and a home directory. */
export function unitPathFor(platform: NodeJS.Platform, scope: ServiceScope, home: string): string {
  if (platform === 'darwin') {
    return scope === 'system'
      ? `/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist`
      : `${home}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
  }
  return scope === 'system'
    ? `/etc/systemd/system/${SYSTEMD_UNIT}`
    : `${home}/.config/systemd/user/${SYSTEMD_UNIT}`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A value as systemd will read it.
 *
 * Two things a unit file does to a value that look like nothing:
 *
 * **`%` is a specifier, not a character.** systemd expands `%h`, `%i`, `%n`
 * and the rest everywhere — `ExecStart=`, `Environment=`,
 * `WorkingDirectory=`. Measured on a live Ubuntu host, 2026-09-14:
 *
 *     WorkingDirectory=/tmp/a%hb   →  /tmp/a/rootb
 *     Environment=X=/opt/a%hb      →  X=/opt/a/rootb
 *     Environment=X=/opt/a%%hb     →  X=/opt/a%hb
 *
 * It does not fail; it substitutes. `%%` is the literal.
 *
 * ## What `systemd-analyze verify` proves, and what it does not
 *
 * It said nothing about the unit above. Not a warning — the substitution is
 * not an error to systemd, it is the feature working.
 *
 * So a clean `verify` means the syntax parses and the files it names exist.
 * It does NOT mean a value arrives the way it was written, and reading it
 * that way is how these two defects survived a check that had already been
 * run against this renderer and reported no findings.
 *
 * The question "did the value survive" has its own command:
 *
 *     systemctl show <unit> -p Environment -p WorkingDirectory -p ExecStart
 *
 * which prints what systemd actually holds. Both of the rules below were
 * confirmed with it, and the one correction to them — that
 * `WorkingDirectory=` must NOT be quoted — came from it too.
 *
 * **Whitespace splits.** `Environment=` takes a LIST of assignments separated
 * by spaces, so a value with one in it is read as an assignment plus
 * rubbish — measured on the same host:
 *
 *     Environment=X=/opt/a b/c     →  X=/opt/a
 *                                     "Invalid environment assignment, ignoring: b/c"
 *     Environment="X=/opt/a b/c"   →  X=/opt/a b/c
 *
 * The quotes go around the WHOLE assignment, which is why this function
 * returns the value and `environmentLine` below composes the line: quoting
 * only the right-hand side is a different thing to systemd.
 *
 * Raised by a colleague from the documentation, who could not test it —
 * macOS has no systemd — and asked for the measurement. Both predictions
 * held.
 */
export function escapeSpecifiers(value: string): string {
  return value.replace(/%/g, '%%');
}

/**
 * A value for a directive that parses its argument as a LIST — `ExecStart=`'s
 * command line, where whitespace separates arguments.
 *
 * Not every directive does. `WorkingDirectory=` takes one path and reads
 * quotes as part of it; measured on the same host, quoting it produced
 *
 *     WorkingDirectory= path is not absolute: "/opt/my omnitron"
 *     omni-escape-probe.service: Unit configuration has fatal error
 *
 * — a unit that will not start, from a fix for a value that did not need one.
 * The escaping rule is per directive, and applying one rule to all of them
 * trades a quiet defect for a loud one.
 */
export function unitValue(value: string): string {
  const escaped = escapeSpecifiers(value);
  return /\s/.test(escaped) ? `"${escaped}"` : escaped;
}

/** One `Environment=` line, quoted as a whole assignment when it needs to be. */
export function environmentLine(name: string, value: string): string {
  const assignment = `${name}=${value.replace(/%/g, '%%')}`;
  return `Environment=${/\s/.test(assignment) ? `"${assignment}"` : assignment}`;
}

/**
 * A systemd unit.
 *
 * `--import tsx/esm` is in the ExecStart because project configs are
 * TypeScript. That loader is a declared runtime dependency of the package —
 * it was a devDependency until 2026-09-14, which npm does not install, so a
 * node prepared from the registry got a unit whose ExecStart could not
 * resolve its own loader. Measured there: ERR_MODULE_NOT_FOUND.
 */
export function renderSystemdUnit(inputs: UnitInputs): string {
  const exec = [inputs.execPath, '--import', 'tsx/esm', inputs.entryPath]
    .map(unitValue)
    .join(' ');

  const system = inputs.scope === 'system';
  if (system && !inputs.identity) {
    throw new Error('A system unit must name the account it runs as.');
  }
  const id = inputs.identity;

  const lines = [
    '[Unit]',
    'Description=Omnitron daemon — process supervisor and control plane',
    'After=network.target docker.service',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${exec}`,
    // Escaped, not quoted: this directive takes a single path and would
    // read the quotes as part of it.
    `WorkingDirectory=${escapeSpecifiers(inputs.workdir)}`,
  ];

  if (system && id) {
    // The daemon does not run as root. See the note at the top of this file:
    // its unix socket is the authentication check.
    lines.push(`User=${id.user}`, `Group=${id.user}`);
    // HOME is stated, not inferred, and the reason is HOW it breaks rather
    // than which systemd version derives it.
    //
    // `os.homedir()` decides where `~/.omnitron` is: the socket, the state
    // database, the secrets. Get it wrong and nothing fails — the daemon
    // creates a SECOND one and runs happily, while every client dials a
    // socket that is not there. A silent divergence, for the value the local
    // trust boundary is drawn around.
    //
    // PAM does not participate here: a service opens a PAM session only with
    // `PAMName=`, and this unit does not set one. If somebody adds it, this
    // decision needs revisiting — PAM can set HOME itself.
    lines.push(environmentLine('HOME', id.home));
  }

  lines.push(
    environmentLine('OMNITRON_CWD', inputs.workdir),
    environmentLine('PATH', inputs.path),
    'Restart=on-failure',
    'RestartSec=10',
    'TimeoutStopSec=30',
    '',
    '[Install]',
    // A user unit is wanted by the session; a system unit by the machine.
    // `default.target` in a system unit is a unit that never starts at boot.
    system ? 'WantedBy=multi-user.target' : 'WantedBy=default.target',
    '',
  );

  return lines.join('\n');
}

/**
 * A launchd job — LaunchAgent for `user` scope, LaunchDaemon for `system`.
 *
 * `ProcessType` is `Interactive`. Without the key a job is `Standard`, which
 * launchd.plist(5) describes as «light resource limits» on CPU and I/O —
 * while anything started from a terminal has none. On a machine that also
 * compiles, the control plane is the first thing the scheduler starves: on
 * 2026-09-23 the dev master logged 139 stalls in 40 min at load 120 (another
 * project's `rustc` and Python jobs), every one `off-cpu` — 1 to 4.6 s of a
 * daemon that answered nothing, at 0 to 93 ms of CPU — and its mesh
 * connection to the test node dropped under them. `Interactive` runs a job
 * with the limits of an app, which is to say none. Not `Adaptive`: that moves
 * a job between classes by its XPC transactions, and this daemon has none.
 */
export function renderLaunchdPlist(inputs: UnitInputs): string {
  const args = [inputs.execPath, '--import', 'tsx/esm', inputs.entryPath];
  const argsXml = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n');

  const system = inputs.scope === 'system';
  if (system && !inputs.identity) {
    throw new Error('A system unit must name the account it runs as.');
  }
  const id = inputs.identity;

  // A LaunchDaemon runs as root unless told otherwise, which is the same
  // hazard the systemd branch avoids with `User=`.
  const identityKeys = system && id
    ? `  <key>UserName</key>\n  <string>${xmlEscape(id.user)}</string>\n`
    : '';
  const homeEnv = system && id ? `    <key>HOME</key>\n    <string>${xmlEscape(id.home)}</string>\n` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
${identityKeys}  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(inputs.workdir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${homeEnv}    <key>OMNITRON_CWD</key>
    <string>${xmlEscape(inputs.workdir)}</string>
    <key>PATH</key>
    <string>${xmlEscape(inputs.path)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ExitTimeOut</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(inputs.stderrLog)}</string>
</dict>
</plist>
`;
}

// =============================================================================
// Choosing a scope
// =============================================================================

export interface ScopeDecision {
  readonly scope: ServiceScope;
  /** Why, in the operator's terms. */
  readonly because: string;
  /** Set when the requested scope cannot be installed, and what to do. */
  readonly refusal?: string;
}

export interface ScopeInputs {
  /** What the operator asked for, if anything. */
  readonly requested?: ServiceScope | undefined;
  /** The daemon's role — a slave must survive a logout. */
  readonly role?: string | undefined;
  /** Whether this process can write to the system unit directory. */
  readonly isRoot: boolean;
  /** Whether the account's user services survive its last session ending. */
  readonly lingerEnabled: boolean;
  readonly platform: NodeJS.Platform;
}

/**
 * Decide which supervision scope to install, or refuse and say why.
 *
 * The refusal is the point. Installing a user unit on a slave because root
 * was unavailable produces something that looks installed, reports installed,
 * and stops the moment the operator logs out — a failure that arrives later
 * and elsewhere, with nothing linking it back to this decision.
 */
export function decideScope(inputs: ScopeInputs): ScopeDecision {
  const wantsSystem = inputs.requested === 'system' || (inputs.requested == null && inputs.role === 'slave');

  if (!wantsSystem) {
    return {
      scope: 'user',
      because:
        inputs.requested === 'user'
          ? 'requested'
          : 'this daemon is a master, and a master is supervised for the account that runs it',
    };
  }

  if (inputs.isRoot) {
    return {
      scope: 'system',
      because:
        inputs.role === 'slave' && inputs.requested == null
          ? 'this daemon is a slave, and a slave must be reachable with nobody logged in'
          : 'requested',
    };
  }

  // Not root. A user unit still survives a logout IF linger is on for the
  // account — so it is an answer, but only once that has been verified true.
  if (inputs.platform === 'linux' && inputs.lingerEnabled) {
    return {
      scope: 'user',
      because: 'not root, but lingering is enabled for this account, so a user unit survives logout',
    };
  }

  return {
    scope: 'user',
    because: 'not root',
    refusal:
      inputs.platform === 'linux'
        ? 'A slave must stay up with nobody logged in. Install as root for a system unit, or enable lingering ' +
          'for this account (`sudo loginctl enable-linger $USER`) and run this again.'
        : 'A slave must stay up with nobody logged in. Install as root so the job can be a LaunchDaemon.',
  };
}
