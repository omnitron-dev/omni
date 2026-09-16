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

/** The status shape the node's CLI actually returns — measured, not assumed. */
const nodeStatus = (apps: Array<{ name: string; status: string }>) =>
  JSON.stringify({ ok: true, data: { version: '0.2.0', pid: 1, uptime: 1, appsTotal: apps.length, apps } });

/**
 * The reading `verifyHealth` performs, extracted so it can be tested without
 * an SSH session. Kept identical in shape to the method.
 */
function readHealth(raw: string, appName: string): { online: boolean; detail: string } {
  let parsed: { data?: { apps?: Array<{ name?: string; status?: string }> } };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { online: false, detail: `the node's status was not JSON: ${raw.trim().slice(0, 120)}` };
  }
  const apps = parsed?.data?.apps ?? [];
  const app = apps.find((a) => a.name === appName);
  if (!app) return { online: false, detail: `the node is running ${apps.length} app(s) and none of them is '${appName}'` };
  return app.status === 'online'
    ? { online: true, detail: 'online' }
    : { online: false, detail: `the node reports it as '${app.status ?? 'unknown'}'` };
}

describe('the node running nothing is not a healthy deployment', () => {
  it('is not online when the node runs no apps at all', () => {
    // The exact answer the test node gave: appsTotal 0, apps [].
    const r = readHealth(nodeStatus([]), 'main');
    expect(r.online).toBe(false);
    expect(r.detail).toContain("none of them is 'main'");
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
