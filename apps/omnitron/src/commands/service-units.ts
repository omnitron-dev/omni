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
    .map((a) => (a.includes(' ') ? `"${a}"` : a))
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
    `WorkingDirectory=${inputs.workdir}`,
  ];

  if (system && id) {
    // The daemon does not run as root. See the note at the top of this file:
    // its unix socket is the authentication check.
    lines.push(`User=${id.user}`, `Group=${id.user}`);
    // systemd derives HOME from the account for `User=`, but only in recent
    // versions and only when PAM is not in play. `os.homedir()` decides where
    // `~/.omnitron` is — the socket, the state database, the secrets — so it
    // is stated rather than inferred.
    lines.push(`Environment=HOME=${id.home}`);
  }

  lines.push(
    `Environment=OMNITRON_CWD=${inputs.workdir}`,
    `Environment=PATH=${inputs.path}`,
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

/** A launchd job — LaunchAgent for `user` scope, LaunchDaemon for `system`. */
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
