/**
 * Four master restarts, four full redeploys, twenty-four app restarts, and
 * not one byte different.
 *
 * A master's boot-time autostart deploys every remote stack again, which is
 * right in principle — the master is the authority on what a node runs. In
 * practice it rebuilt six artifacts, transferred them, unpacked them, ran
 * `npm install` for each and restarted all six applications on every master
 * restart, whether or not anything had changed. Measured across one
 * afternoon of this session, with each restart's downtime visible from the
 * onion.
 *
 * Three facts decide, and each is measured rather than assumed: the
 * artifact's sha256 against the one the node recorded when it installed what
 * it has; whether the app is running there NOW; and whether the
 * configuration it would be started with is about to change — identical
 * files with a different environment is a different deployment.
 *
 * The one thing that must never happen here is a skip that was wrong, so
 * every "cannot tell" answers `deploy`.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

import { bundleChecksum } from '../../src/services/bundle-builder.js';
import {
  decideRedeploy,
  artifactChanged,
  parseRecordedChecksum,
  readChecksumCommand,
  ARTIFACT_CHECKSUM_FILE,
  NODE_CONFIG_HASH_FILE,
} from '../../src/services/redeploy-decision.js';

const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('what the node has, against what would be shipped', () => {
  it('is unchanged when the two checksums match', () => {
    expect(artifactChanged(SHA, SHA)).toBe(false);
  });

  it('is changed when they differ', () => {
    expect(artifactChanged(SHA, OTHER)).toBe(true);
  });

  it('is unknown when the node recorded nothing', () => {
    // An older master, or an install done by hand. Not a match.
    expect(artifactChanged(null, SHA)).toBeNull();
  });

  it('is unknown when the artifact has no checksum of its own', () => {
    expect(artifactChanged(SHA, undefined)).toBeNull();
    expect(artifactChanged(SHA, '')).toBeNull();
  });
});

describe('reading the record without inventing one', () => {
  it('reads a checksum the node wrote', () => {
    expect(parseRecordedChecksum(`${SHA}\n`)).toBe(SHA);
  });

  it('treats a missing file as no record', () => {
    expect(parseRecordedChecksum('__none__\n')).toBeNull();
    expect(parseRecordedChecksum('')).toBeNull();
  });

  it('refuses anything that is not a sha256', () => {
    // A truncated file, or a shell that printed a warning first. Comparing
    // that as though it were a checksum is how a skip becomes wrong.
    for (const junk of ['abc', `${SHA}extra`, 'Warning: something\n' + SHA, 'Z'.repeat(64)]) {
      expect(parseRecordedChecksum(junk), junk.slice(0, 20)).toBeNull();
    }
  });

  it('asks in a way that tells absent from unreadable', () => {
    const cmd = readChecksumCommand('/opt/x');

    expect(cmd).toContain(ARTIFACT_CHECKSUM_FILE);
    expect(cmd).toContain('__none__');
    // Not `|| true`: that would swallow a permission error and an
    // unreachable host along with the missing file.
    expect(cmd).not.toContain('|| true');
    expect(cmd).not.toContain('2>/dev/null');
  });

  it('can be pointed at the config hash instead', () => {
    expect(readChecksumCommand('/opt/projects/daos', NODE_CONFIG_HASH_FILE)).toContain(NODE_CONFIG_HASH_FILE);
  });
});

describe('what a deployment does for one app', () => {
  it('leaves an app that is running on the same files with the same config', () => {
    const d = decideRedeploy({ artifactChanged: false, online: true, configChanged: false });

    expect(d.action).toBe('leave');
    expect(d.because).toMatch(/same artifact.*running.*same configuration/);
  });

  it('restarts it when the configuration moved', () => {
    // Same files, different credentials or addresses: a different
    // deployment, and the running process holds the old environment.
    const d = decideRedeploy({ artifactChanged: false, online: true, configChanged: true });

    expect(d.action).toBe('restart');
    expect(d.because).toMatch(/configuration/);
  });

  it('starts it when it is not running, whatever the files say', () => {
    expect(decideRedeploy({ artifactChanged: false, online: false, configChanged: false }).action).toBe('restart');
  });

  it('deploys when the files differ', () => {
    expect(decideRedeploy({ artifactChanged: true, online: true, configChanged: false }).action).toBe('deploy');
  });

  it('deploys when nobody can say whether they differ', () => {
    // The whole safety of this feature: every unknown ships.
    const d = decideRedeploy({ artifactChanged: null, online: true, configChanged: false });

    expect(d.action).toBe('deploy');
    expect(d.because).toMatch(/no record/);
  });

  it('never leaves an app it is not sure about', () => {
    for (const artifact of [true, null] as const) {
      for (const online of [true, false]) {
        for (const configChanged of [true, false]) {
          const d = decideRedeploy({ artifactChanged: artifact, online, configChanged });
          expect(d.action, `${artifact}/${online}/${configChanged}`).not.toBe('leave');
        }
      }
    }
  });
});

/**
 * The two halves in the deployer, read from the source that runs them.
 */
describe('the deployment wires both halves', () => {
  const deployer = stripComments(
    fs.readFileSync(path.join(here, '../../src/services/remote-deployer.service.ts'), 'utf8'),
  );

  it('asks the node what it has before transferring', () => {
    const at = deployer.indexOf('readChecksumCommand(shellEscape(remotePath))');
    const transfer = deployer.indexOf('await this.scpTransfer(');

    expect(at, 'the record is read').toBeGreaterThan(-1);
    expect(transfer).toBeGreaterThan(at);
  });

  it('writes the record only after the install succeeded', () => {
    // A record that outlives a failed unpack lets the NEXT run skip a
    // transfer the node needs.
    const install = deployer.indexOf('npm install --omit=dev');
    const record = deployer.indexOf(`${'$'}{remotePath}/${'$'}{ARTIFACT_CHECKSUM_FILE}`);

    expect(record).toBeGreaterThan(install);
  });

  it('lets an operator force a transfer anyway', () => {
    expect(deployer).toMatch(/options\?\.force !== true/);
  });

  it('asks the node once what is running, not once per app', () => {
    const at = deployer.indexOf('private async appsOnline(');
    expect(at, 'the helper exists').toBeGreaterThan(-1);

    const loop = deployer.indexOf('for (const entry of landed) {', deployer.indexOf('const runningNow ='));
    expect(deployer.indexOf('const runningNow =')).toBeLessThan(loop);
  });

  it('restarts everything when it cannot tell what is running', () => {
    const at = deployer.indexOf('private async appsOnline(');
    const body = deployer.slice(at, deployer.indexOf('\n  }', at));

    expect(body).toMatch(/return new Set\(\)/);
    expect(body).toMatch(/every app will be restarted/);
  });

  it('treats an unknown config as changed', () => {
    // The catch in `registerNodeApps`: not knowing whether the definitions
    // moved must not read as "they did not".
    const at = deployer.indexOf('private async registerNodeApps(');
    const body = deployer.slice(at, deployer.indexOf('\n  /**', at + 2000));

    expect(body).toMatch(/return \{ changed: true \}/);
  });
});

/**
 * The skip above can only ever fire if two builds of the same sources agree
 * on what they built — and they did not.
 *
 * `ArtifactBuilder` hashed the `.tar.gz` it had just written. A gzip member
 * carries the compression time in its header, four bytes at offset 4, and
 * `tar -czf` fills them in from the clock. Measured here on one unchanged
 * directory, packed twice two seconds apart:
 *
 *   1ef749846e6b164034aad3ad65d2c4e337b0dd33aba0343c2221a14345665529
 *   5457d4ab06ed91e82f3c865b7d36e51785397b8cef59f32101e8171f6eee9e6f
 *   header: 1f8b 0800 7016 b06a   vs   1f8b 0800 7216 b06a
 *
 * The tar entries carry their own mtimes besides, and a bundle is copied
 * into a fresh staging tree on every build, so every file in it is new.
 * An artifact's sha256 was therefore a different number each time it was
 * computed, `artifactChanged` answered `true` forever, and the deployment
 * that "stops shipping what the node already has" shipped everything, every
 * time — a feature that cannot fire is the same as one that is not there.
 *
 * So the identity is taken from the bundle, before it is packed: the files
 * that will travel, their paths, and nothing about this machine or this
 * minute.
 */
describe('an artifact is identified by what it ships, not when it was packed', () => {
  const tree = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-bundle-id-'));
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    return dir;
  };

  const sample = { 'package.json': '{"name":"app"}', 'dist/index.js': 'run()\n', 'config/default.json': '{}' };

  it('gives two copies of the same files the same name', async () => {
    const a = tree(sample);
    const b = tree(sample);
    // A year apart, which is what a rebuild does to every file in a staging
    // tree it has just created.
    const old = new Date('2020-01-01T00:00:00Z');
    for (const rel of Object.keys(sample)) fs.utimesSync(path.join(b, rel), old, old);

    expect(await bundleChecksum(a)).toBe(await bundleChecksum(b));
  });

  it('is a sha256, so it can be recorded and compared as one', async () => {
    expect(await bundleChecksum(tree(sample))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when one byte of one file changes', async () => {
    const before = await bundleChecksum(tree(sample));
    const after = await bundleChecksum(tree({ ...sample, 'dist/index.js': 'run() \n' }));

    expect(after).not.toBe(before);
  });

  it('changes when a file moves, though every byte is still there', async () => {
    const before = await bundleChecksum(tree(sample));
    const after = await bundleChecksum(
      tree({ 'package.json': sample['package.json'], 'dist/main.js': sample['dist/index.js'], 'config/default.json': '{}' }),
    );

    expect(after).not.toBe(before);
  });

  it('changes when a file that was not executable becomes executable', async () => {
    const dir = tree({ ...sample, 'dist/entry.sh': '#!/bin/sh\n' });
    const before = await bundleChecksum(dir);
    fs.chmodSync(path.join(dir, 'dist/entry.sh'), 0o755);

    expect(await bundleChecksum(dir)).not.toBe(before);
  });

  it('reads a symlink as where it points, and does not follow it out of the bundle', async () => {
    const dir = tree(sample);
    fs.symlinkSync('/etc/passwd', path.join(dir, 'dist/link'));
    const before = await bundleChecksum(dir);

    fs.unlinkSync(path.join(dir, 'dist/link'));
    fs.symlinkSync('/etc/hosts', path.join(dir, 'dist/link'));

    expect(await bundleChecksum(dir)).not.toBe(before);
  });

  it('is what the artifact carries', () => {
    // The wiring: whatever `buildApp` reports as the artifact's checksum has
    // to be this number, or the skip is comparing something else again.
    const builder = stripComments(
      fs.readFileSync(path.join(here, '../../src/project/artifact-builder.ts'), 'utf8'),
    );

    expect(builder).toMatch(/const checksum = await this\.createTarball\(/);
    expect(builder).toMatch(/bundleChecksum/);
    expect(builder).not.toMatch(/computeChecksum\(artifactPath\)/);
  });
});
