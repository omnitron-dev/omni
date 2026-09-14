/**
 * A slave node was supervised by something that stops when you log out.
 *
 * `omnitron service install` had one mode. On Linux it wrote a systemd USER
 * unit — `~/.config/systemd/user/`, `WantedBy=default.target` — which systemd
 * stops when the account's last session ends. On macOS, a LaunchAgent, which
 * starts at login and not at boot.
 *
 * For a workstation that is right: the daemon is there while you are. For a
 * slave it is the opposite of the role. A slave exists to be reachable when
 * nobody is logged in; a master dials it to check its health and to pull from
 * it, and a slave that stops at logout is a node the console shows as offline
 * with no way to tell it from one that is down.
 *
 * The control for that was a printed line:
 *
 *     log.info('  Tip: `loginctl enable-linger` keeps it running without an
 *              active session.');
 *
 * A tip is not a control. It changes nothing unless a human reads it,
 * remembers it and runs it, and what it prevents shows up hours later on a
 * different machine with nothing linking it back.
 */

import { describe, it, expect } from 'vitest';

import {
  decideScope,
  renderSystemdUnit,
  renderLaunchdPlist,
  unitPathFor,
  type UnitInputs,
} from '../../src/commands/service-units.js';

const inputs = (over: Partial<UnitInputs> = {}): UnitInputs => ({
  scope: 'system',
  execPath: '/opt/omnitron/runtime/bin/node',
  entryPath: '/opt/omnitron/lib/daemon/daemon-entry.js',
  workdir: '/opt/omnitron/lib',
  path: '/usr/local/bin:/usr/bin:/bin',
  stderrLog: '/home/omni/.omnitron/logs/systemd.err.log',
  identity: { user: 'omni', home: '/home/omni' },
  ...over,
});

describe('choosing how a node is supervised', () => {
  it('gives a slave a system scope without being asked', async () => {
    // The role IS the requirement. Making an operator remember a flag for it
    // is the same shape as the tip that preceded this.
    const d = decideScope({ role: 'slave', isRoot: true, lingerEnabled: false, platform: 'linux' });

    expect(d.scope).toBe('system');
    expect(d.refusal).toBeUndefined();
    expect(d.because).toMatch(/reachable with nobody logged in/);
  });

  it('leaves a master where it was', () => {
    const d = decideScope({ role: 'master', isRoot: true, lingerEnabled: false, platform: 'linux' });

    expect(d.scope).toBe('user');
  });

  it('refuses rather than quietly installing something that stops at logout', () => {
    // The whole point. A user unit installed here would report success and
    // then vanish with the session.
    const d = decideScope({ role: 'slave', isRoot: false, lingerEnabled: false, platform: 'linux' });

    expect(d.refusal).toBeTruthy();
    expect(d.refusal).toMatch(/enable-linger|as root/);
  });

  it('accepts a user unit for a slave when lingering is actually on', () => {
    // Verified state, not a printed suggestion: with linger enabled the user
    // unit does survive a logout, so it is a real answer.
    const d = decideScope({ role: 'slave', isRoot: false, lingerEnabled: true, platform: 'linux' });

    expect(d.scope).toBe('user');
    expect(d.refusal).toBeUndefined();
    expect(d.because).toMatch(/linger/);
  });

  it('does not offer lingering on macOS, where it does not exist', () => {
    const d = decideScope({ role: 'slave', isRoot: false, lingerEnabled: true, platform: 'darwin' });

    expect(d.refusal).toMatch(/LaunchDaemon/);
    expect(d.refusal).not.toMatch(/linger/);
  });

  it('honours an explicit request either way', () => {
    expect(decideScope({ requested: 'user', role: 'slave', isRoot: true, lingerEnabled: false, platform: 'linux' }).scope).toBe('user');
    expect(decideScope({ requested: 'system', role: 'master', isRoot: true, lingerEnabled: false, platform: 'linux' }).scope).toBe('system');
  });
});

describe('the systemd unit', () => {
  it('is wanted by the machine, not by a session', () => {
    // `default.target` in a SYSTEM unit is a unit that never starts at boot —
    // the same file in the wrong directory, silently inert.
    expect(renderSystemdUnit(inputs({ scope: 'system' }))).toContain('WantedBy=multi-user.target');
    expect(renderSystemdUnit(inputs({ scope: 'user', identity: undefined }))).toContain('WantedBy=default.target');
  });

  it('runs as the account that owns the state, never as root', () => {
    // Root installs the unit; root does not run the daemon. The daemon's unix
    // socket IS its local authentication check, so a root-run daemon with a
    // socket in a shared path redefines "can reach the socket" from "the
    // owner" to "anyone on the box".
    const unit = renderSystemdUnit(inputs({ scope: 'system' }));

    expect(unit).toContain('User=omni');
    expect(unit).toContain('Group=omni');
  });

  it('states HOME, because that is where ~/.omnitron resolves', () => {
    // The socket, the state database and the secrets all live under
    // `os.homedir()`. systemd derives it from `User=` only in recent versions.
    expect(renderSystemdUnit(inputs({ scope: 'system' }))).toContain('Environment=HOME=/home/omni');
  });

  it('carries no identity in a user unit, where it is already the user', () => {
    const unit = renderSystemdUnit(inputs({ scope: 'user', identity: undefined }));

    expect(unit).not.toContain('User=');
    expect(unit).not.toContain('Environment=HOME=');
  });

  it('refuses to render a system unit with nobody to run as', () => {
    // Rather than emitting one without `User=`, which systemd runs as root.
    expect(() => renderSystemdUnit(inputs({ scope: 'system', identity: undefined }))).toThrow(/account/);
  });

  it('loads the TypeScript loader the package now ships', () => {
    // Project configs are TypeScript. `tsx` was a devDependency until
    // 2026-09-14, so on a node installed from the registry this ExecStart
    // could not resolve its own loader — measured there as
    // ERR_MODULE_NOT_FOUND.
    expect(renderSystemdUnit(inputs())).toContain('--import tsx/esm');
  });
});

describe('the launchd job', () => {
  it('names the account for a LaunchDaemon, which otherwise runs as root', () => {
    const plist = renderLaunchdPlist(inputs({ scope: 'system' }));

    expect(plist).toContain('<key>UserName</key>');
    expect(plist).toContain('<string>omni</string>');
    expect(plist).toContain('<key>HOME</key>');
  });

  it('leaves a LaunchAgent as the user it already is', () => {
    const plist = renderLaunchdPlist(inputs({ scope: 'user', identity: undefined }));

    expect(plist).not.toContain('<key>UserName</key>');
  });

  it('escapes what it interpolates into XML', () => {
    const plist = renderLaunchdPlist(inputs({ workdir: '/opt/a&b<c>' }));

    expect(plist).toContain('/opt/a&amp;b&lt;c&gt;');
    expect(plist).not.toContain('<c>');
  });
});

describe('where the definition goes', () => {
  it('puts a system unit where the machine reads it', () => {
    expect(unitPathFor('linux', 'system', '/home/omni')).toBe('/etc/systemd/system/omnitron-daemon.service');
    expect(unitPathFor('darwin', 'system', '/Users/omni')).toBe('/Library/LaunchDaemons/dev.omnitron.daemon.plist');
  });

  it('puts a user unit under the account', () => {
    expect(unitPathFor('linux', 'user', '/home/omni')).toBe('/home/omni/.config/systemd/user/omnitron-daemon.service');
    expect(unitPathFor('darwin', 'user', '/Users/omni')).toBe('/Users/omni/Library/LaunchAgents/dev.omnitron.daemon.plist');
  });

  it('never puts the two in the same place', () => {
    // They are removed by path when a scope changes; one path for both would
    // leave two supervisors racing for one unix socket.
    for (const platform of ['linux', 'darwin'] as const) {
      expect(unitPathFor(platform, 'system', '/home/o')).not.toBe(unitPathFor(platform, 'user', '/home/o'));
    }
  });
});
