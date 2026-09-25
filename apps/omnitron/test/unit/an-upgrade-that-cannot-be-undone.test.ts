/**
 * Installing a new omnitron over the one that is serving.
 *
 * The obvious layout is one directory: unpack there, `npm install` there,
 * done. It fails in the way that costs most. An `npm install` that dies
 * halfway — a registry timeout, a disk filling, a killed ssh — has already
 * replaced part of `node_modules`, so the daemon that was working is now a
 * daemon that cannot start, on a machine somewhere else, with no previous
 * copy to go back to.
 *
 * So: a version is unpacked and installed BESIDE the running one, verified
 * there by running it, and only then does a symlink move. One `ln -sfn`,
 * which is a `rename(2)` and therefore atomic. Going back is the same
 * command pointed at the previous directory.
 *
 * These pin the properties that make that true, and each of them is a way
 * the layout can be built that looks right and is not.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  installSteps,
  activateSteps,
  pruneSteps,
  versionDir,
  type InstallLayout,
} from '../../src/services/bundle-builder.js';

const layout: InstallLayout = { prefix: '/opt/omnitron', version: '0.2.0+local.abc123.202609141900' };
const script = (steps: readonly { command: string }[]) => steps.map((s) => s.command).join('\n');

describe('installing beside what is running', () => {
  it('unpacks into a directory named for the version', () => {
    expect(versionDir(layout)).toBe('/opt/omnitron/versions/0.2.0+local.abc123.202609141900');
  });

  it('never touches the live copy while installing', () => {
    // The property the whole layout exists for. Nothing in the install
    // sequence may name `current`, because anything that does is a change to
    // what is serving before the new copy has been shown to work.
    const commands = script(installSteps(layout, '/tmp/bundle.tar.gz'));

    expect(commands).not.toContain('/opt/omnitron/current');
  });

  it('clears a directory an interrupted attempt left behind', () => {
    // `npm install` over a half-unpacked tree reconciles against whatever is
    // there, and what comes out is not this version — it is a mixture, which
    // then passes the version check because `package.json` unpacked first.
    expect(script(installSteps(layout, '/tmp/b.tgz'))).toContain('rm -rf');
  });

  it('runs the new copy before anything points at it', () => {
    const steps = installSteps(layout, '/tmp/b.tgz');
    const check = steps.find((s) => s.what.includes('runs'));

    expect(check).toBeTruthy();
    // By absolute path into the version directory — not `omnitron --version`,
    // which would run whatever `current` points at and pass whatever happens.
    expect(check!.command).toContain(`${versionDir(layout)}/dist/cli/omnitron.js`);
    expect(check!.command).not.toMatch(/^\s*omnitron /);
  });

  it('makes the entry point executable before anything runs it', () => {
    // Measured 2026-09-23: a dist compiled by plain `tsc --outDir` had
    // `dist/cli/omnitron.js` at 0644, and the upgrade of daos-test stopped at
    // the check below with «Permission denied», the node unchanged. The mode
    // is set on the node, where it is needed, whatever the builder left.
    const steps = installSteps(layout, '/tmp/b.tgz');
    const chmod = steps.findIndex((s) => /chmod 755 .*\/dist\/cli\/omnitron\.js/.test(s.command));
    const check = steps.findIndex((s) => s.what.includes('runs'));

    expect(chmod, 'no step makes the entry point executable').toBeGreaterThan(-1);
    expect(chmod).toBeLessThan(check);
    expect(steps[chmod]!.command).toContain(versionDir(layout));
  });

  it('checks last, after the install it is checking', () => {
    const steps = installSteps(layout, '/tmp/b.tgz');

    expect(steps[steps.length - 1]!.what).toContain('runs');
  });

  it('gives npm a deadline long enough to finish', () => {
    // A registry install of 150 packages over a slow link is minutes. A
    // timeout shorter than the work turns a healthy install into a failed
    // one, and leaves the version directory half-populated.
    const install = installSteps(layout, '/tmp/b.tgz').find((s) => s.what.includes('dependencies'))!;

    expect(install.timeoutMs).toBeGreaterThanOrEqual(600_000);
  });
});

describe('making a version live', () => {
  it('is a separate step, so stopping before it changes nothing', () => {
    // Install and activate are different decisions. A run that transfers,
    // installs and verifies but does not activate has cost disk and nothing
    // else.
    const installed = script(installSteps(layout, '/tmp/b.tgz'));
    const activated = script(activateSteps(layout));

    expect(installed).not.toContain('ln -sfn');
    expect(activated).toContain('ln -sfn');
  });

  it('replaces the current symlink rather than following it', () => {
    // Without `-n`, `ln -sf target current` where `current` is already a
    // symlink TO A DIRECTORY creates `current/<target-basename>` inside it.
    // The second upgrade is where that shows up, not the first.
    const commands = script(activateSteps(layout));

    expect(commands).toContain('ln -sfn');
    expect(commands).not.toMatch(/ln -sf[^n]/);
  });

  it('makes the name on PATH resolve to the new copy', () => {
    // The node found this one. `<prefix>/bin` is on nobody's PATH, so after
    // `current` moved, a bare `omnitron` still resolved to whatever was there
    // before — on the test host, a registry install in another directory. The
    // activation restarted THAT, and reported the old copy's missing
    // dependency as the new version failing to come up.
    const commands = script(activateSteps(layout));

    expect(commands).toContain('/usr/local/bin/omnitron');
    expect(commands).toContain('/opt/omnitron/current/dist/cli/omnitron.js');
  });

  it('does not replace a real binary somebody else put on PATH', () => {
    // Same guard as everywhere else this code links: over nothing, or over a
    // symlink, which is what an earlier install of ours leaves behind.
    const commands = script(activateSteps(layout));

    // The path is shell-quoted, so the assertion matches the shape rather
    // than a literal that would go stale the moment quoting changes.
    expect(commands).toMatch(/\[ ! -e '\/usr\/local\/bin\/omnitron' \] \|\| \[ -L '\/usr\/local\/bin\/omnitron' \]/);
  });

  it('points the CLI at current, not at a version', () => {
    // If `bin/omnitron` named a version directly, every upgrade would have to
    // rewrite it, and a rollback that moved `current` would leave the CLI
    // running the version that was rolled back.
    const commands = script(activateSteps(layout));

    expect(commands).toContain('/opt/omnitron/current/dist/cli/omnitron.js');
    expect(commands).not.toContain(`${versionDir(layout)}/dist/cli/omnitron.js`);
  });
});

describe('retention', () => {
  it('never removes what is running', () => {
    // A retention that reasons about age must not be the thing that deletes
    // the live copy. A rollback needs its target to still be there.
    const commands = script(pruneSteps(layout, 3));

    expect(commands).toContain('readlink');
    expect(commands).toContain('CURRENT');
  });

  it('keeps the number asked for', () => {
    expect(script(pruneSteps(layout, 5))).toContain('keep=5');
  });

  it('keeps the most recent BUILDS, not the names that sort last', () => {
    // The names put the sha before the stamp, so sorting them sorts shas. On
    // daos/test, 2026-09-25, three upgrades in one morning kept the running
    // version and three from 22–23 September, and deleted the two a rollback
    // would have wanted. The very same names, the command run for real.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
    try {
      const names = [
        '0.2.0+local.f5dec792c4a3.202609221401',
        '0.2.0+local.fc0a1d6f3c3c.202609231545',
        '0.2.0+local.fc0a1d6f3c3c.202609231701',
        '0.2.0+local.311bddb1e8d2.202609250830',
        '0.2.0+local.de454a80a3bd.202609251029',
        '0.2.0+local.a0ca22683705.202609251111',
      ];
      for (const n of names) fs.mkdirSync(path.join(root, 'versions', n), { recursive: true });
      fs.symlinkSync(path.join(root, 'versions', names[5]!), path.join(root, 'current'));

      execFileSync('bash', ['-c', script(pruneSteps({ prefix: root, version: names[5]! }, 3))]);

      expect(fs.readdirSync(path.join(root, 'versions')).sort()).toEqual(
        [names[3]!, names[4]!, names[5]!].sort()
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does nothing when there are no versions yet', () => {
    // A first install has no `versions` directory, and a prune that fails
    // there would fail the install that follows it.
    expect(script(pruneSteps(layout, 3))).toContain('|| exit 0');
  });
});

describe('quoting', () => {
  it('quotes a version that contains shell characters', () => {
    // `+` is in every local version by construction, and a version is a
    // directory name interpolated into a remote shell command.
    const odd: InstallLayout = { prefix: "/opt/om'nitron", version: "0.2.0+local.a'b.1" };

    for (const step of [...installSteps(odd, '/tmp/b.tgz'), ...activateSteps(odd)]) {
      expect(step.command, step.what).toContain("'\\''");
    }
  });
});
