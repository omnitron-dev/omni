/**
 * Six apps "deployed" to a node that was running none of them.
 *
 * Remote deployment ships an artifact, extracts it, installs dependencies,
 * asks the node's daemon to start the app, and verifies. The last two steps
 * could not fail:
 *
 *     await this.sshExec(target, `omnitron restart ${app} 2>/dev/null || true`);
 *
 * and a `verifyHealth` that returned `void` on every path — a match, a
 * mismatch, a parse failure, an unreachable node — under the comment "Health
 * check is best-effort".
 *
 * Measured on the test node, running the swallowed command by hand:
 *
 *     omnitron restart main  →  Failed: Unknown app: main
 *
 * The node's daemon has no app definitions: its log says `No projects
 * registered` and `omnitron status --json` answers `appsTotal: 0`. Nothing in
 * the deployment tells it about the apps — artifacts land as
 * `{config, dist, package.json}` and a project is "a directory with
 * omnitron.config.ts", which an artifact is not.
 *
 * That gap is a design question and is NOT closed here. What is closed is its
 * invisibility: the `|| true` discarded the only sentence that said so, the
 * verification could not contradict it, and the caller logged
 * `Deployment successful`.
 *
 * These pin the reading of the two answers, which is the part that was wrong.
 */

import { describe, it, expect } from 'vitest';

import { readNodeHealth, readNodeStatus, nodeAppName } from '../../src/project/node-app-health.js';

/** The status shape the node's CLI actually returns — measured, not assumed. */
const nodeStatus = (apps: Array<{ name: string; status: string }>) =>
  JSON.stringify({ ok: true, data: { version: '0.2.0', pid: 1, uptime: 1, appsTotal: apps.length, apps } });

/**
 * The reading `verifyHealth` performs.
 *
 * It used to be a copy of that method's body, living here — which agreed
 * with the original, and would have gone on agreeing with it after the
 * original became wrong. It did: the deployer started asking a node about
 * `daos/deployed/main` while this file went on proving that `main` matched
 * `main`. Now both call the same function.
 */
const readHealth = (raw: string, appName: string, project = 'daos') =>
  readNodeHealth(raw, appName, project);

describe('the node running nothing is not a healthy deployment', () => {
  it('is not online when the node runs no apps at all', () => {
    // The exact answer the test node gave: appsTotal 0, apps [].
    const r = readHealth(nodeStatus([]), 'main');
    expect(r.online).toBe(false);
    expect(r.detail).toContain("none of them is 'daos/deployed/main'");
  });

  it('is not online when the node runs OTHER apps', () => {
    // The dangerous near-miss: a node busy with something reads as a node
    // that is working.
    const r = readHealth(nodeStatus([{ name: 'geo', status: 'online' }]), 'main');
    expect(r.online).toBe(false);
    expect(r.detail).toContain('1 app(s)');
  });

  it('is not online when the app is there and stopped', () => {
    const r = readHealth(nodeStatus([{ name: 'main', status: 'stopped' }]), 'main');
    expect(r.online).toBe(false);
    expect(r.detail).toContain("'stopped'");
  });

  it('is online only when that app says online', () => {
    expect(readHealth(nodeStatus([{ name: 'main', status: 'online' }]), 'main').online).toBe(true);
  });

  it('does not read a non-JSON answer as health', () => {
    // `|| echo "{}"` used to turn every such answer into an empty object, and
    // an empty object into a silent pass.
    for (const raw of ['', 'omnitron: command not found', '{}', 'null']) {
      expect(readHealth(raw, 'main').online, raw || '(empty)').toBe(false);
    }
  });

  it('reads the envelope the node actually sends', () => {
    // The apps live under `data`, not at the top level. The previous version
    // read `parsed.apps`, which is undefined for every real answer — so even
    // a correctly running app could never have been recognised.
    const flat = JSON.stringify({ apps: [{ name: 'main', status: 'online' }] });
    expect(readHealth(flat, 'main').online).toBe(false);
    expect(readHealth(nodeStatus([{ name: 'main', status: 'online' }]), 'main').online).toBe(true);
  });
});

describe('what counts as the node refusing to start an app', () => {
  const refused = (out: string) => /unknown app|failed|not found|no such/i.test(out);

  it('recognises the refusal the node actually gives', () => {
    expect(refused('Restarting main...\nFailed: Unknown app: main')).toBe(true);
    expect(refused('omnitron: command not found')).toBe(true);
    expect(refused('Error: no such app')).toBe(true);
  });

  it('does not call a successful restart a refusal', () => {
    expect(refused('Restarting main...\nmain restarted (pid 4711)')).toBe(false);
    expect(refused('main — online (PID: 1234)')).toBe(false);
  });
});

/**
 * A node names an app by its project and stack; a deployment asks by the
 * app's own name. Compared as equal strings those never match, and the run
 * that put six apps on a node and started all six reported six failures:
 *
 *     the node is running 6 app(s) and none of them is 'main'
 *
 * against `appsTotal: 6, appsOnline: 6` and every port listening. A check
 * that cannot pass is the same defect as one that cannot fail, one sign
 * flipped — and the louder one, because the first failure it reports about a
 * healthy deployment is the last one anybody reads.
 */
describe('a node names an app the way a node names apps', () => {
  it('recognises the qualified name the node answers with', () => {
    const r = readHealth(nodeStatus([{ name: 'daos/deployed/main', status: 'online' }]), 'main');
    expect(r.online).toBe(true);
  });

  it('still recognises a bare name', () => {
    // A node given bare definitions answers bare, and both spellings are
    // reachable from the same master.
    expect(readHealth(nodeStatus([{ name: 'main', status: 'online' }]), 'main').online).toBe(true);
  });

  it('reads the status of the qualified app, not merely its presence', () => {
    const r = readHealth(nodeStatus([{ name: 'daos/deployed/main', status: 'errored' }]), 'main');
    expect(r.online).toBe(false);
    expect(r.detail).toContain("'errored'");
  });

  it('does not accept the same app name under another project', () => {
    // `acme/deployed/main` is a different application on the same machine.
    // Calling it healthy is exactly the false pass this file exists to stop.
    const r = readHealth(nodeStatus([{ name: 'acme/deployed/main', status: 'online' }]), 'main');
    expect(r.online).toBe(false);
  });

  it('names what the node IS running, so a mismatch is visible', () => {
    // The old sentence gave a count and nothing else, which is how a naming
    // mismatch stayed unread through six deployments.
    const r = readHealth(
      nodeStatus([
        { name: 'daos/deployed/geo', status: 'online' },
        { name: 'daos/deployed/storage', status: 'online' },
      ]),
      'main',
    );
    expect(r.online).toBe(false);
    expect(r.detail).toContain('daos/deployed/geo');
    expect(r.detail).toContain('daos/deployed/storage');
  });

  it('keeps the sentence readable when the node runs many', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `daos/deployed/a${i}`, status: 'online' }));
    const r = readHealth(nodeStatus(many), 'main');

    expect(r.detail).toContain('6 more');
    expect(r.detail.length).toBeLessThan(400);
  });

  it('spells the qualified name one way', () => {
    // The renderer writes the config the node loads, and this reads what the
    // node answers. Two spellings of the same name is the whole defect.
    expect(nodeAppName('daos', 'main')).toBe('daos/deployed/main');
  });
});

/**
 * The same envelope, read by the fleet.
 *
 * `checkRemoteOmnitron` runs this very command over SSH and read `info.pid`
 * — the top level, where nothing is. So a node whose daemon had been up for
 * days, answering it, was listed `○ offline` in `omnitron node list` and in
 * the console, with `omnitron status reported no running daemon` behind it.
 * Measured on the test node while it reported `appsOnline: 6` and every port
 * listening.
 */
describe('a daemon that answers is a daemon that is up', () => {
  const answer = JSON.stringify({
    ok: true,
    data: { version: '0.2.0+local.717933365a79', pid: 426053, uptime: 216097, appsTotal: 6, apps: [] },
  });

  it('reads the daemon through the envelope', () => {
    const s = readNodeStatus(answer)!;

    expect(s.pid).toBe(426053);
    expect(s.version).toBe('0.2.0+local.717933365a79');
    expect(s.uptime).toBe(216097);
  });

  it('reads the envelope and nothing but the envelope', () => {
    // A top-level `pid` is not a node's answer in any version that has
    // shipped. Accepting one would make any JSON object with the right field
    // names read as a healthy daemon — which is how the flat form was read
    // as health in the app check beside this one.
    const s = readNodeStatus(JSON.stringify({ version: '0.1.0', pid: 7, uptime: 1 }))!;

    expect(s.pid).toBeUndefined();
    expect(s.version).toBeUndefined();
  });

  it('reports no daemon for an answer that names none', () => {
    for (const raw of ['{}', '{"ok":true,"data":{}}', 'null']) {
      expect(readNodeStatus(raw)?.pid, raw).toBeUndefined();
    }
  });

  it('tells a non-JSON answer from an empty one', () => {
    // `omnitron: command not found` is a node without omnitron, which is a
    // different state from a node whose daemon is stopped.
    expect(readNodeStatus('omnitron: command not found')).toBeNull();
    expect(readNodeStatus('{}')).not.toBeNull();
  });

  it('keeps a role only when it is one', () => {
    expect(readNodeStatus(JSON.stringify({ data: { pid: 1, role: 'slave' } }))!.role).toBe('slave');
    expect(readNodeStatus(JSON.stringify({ data: { pid: 1, role: 'banana' } }))!.role).toBeUndefined();
  });

  it('gives the apps to whoever asks for them, from the same read', () => {
    // One parse, one envelope, two readers — the split is what let the two
    // disagree about where the answer lives.
    const s = readNodeStatus(
      JSON.stringify({ ok: true, data: { pid: 1, apps: [{ name: 'daos/deployed/main', status: 'online' }] } }),
    )!;

    expect(s.apps).toHaveLength(1);
    expect(s.apps[0]!.name).toBe('daos/deployed/main');
  });
});
