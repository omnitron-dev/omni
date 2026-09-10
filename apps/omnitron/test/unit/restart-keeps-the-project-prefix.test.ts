/**
 * `restart` used to start the WRONG app, under the wrong name.
 *
 * The sibling of the bug `start-app-name-resolution.test.ts` covers, on the
 * other command. `restartAppCoalesced` falls through to `startApp` when there
 * is no live handle — an operator expects `omnitron restart foo` to work after
 * a crash — and it finds the config entry by comparing last path segments, so
 * a request for `acme/dev/payments` matches an entry named `payments`. It then
 * handed that entry to `startApp` UNCHANGED, and the app came back registered
 * as `payments`.
 *
 * `ensureNamespacedEntry` cannot rescue it: a config entry without
 * OMNITRON_PROJECT / OMNITRON_STACK in its env is deliberately left alone.
 *
 * What that costs. `ProjectService.toStackInfo` filters handles on the
 * `${project}/${stack}/` prefix, so the app disappears from the project view
 * while still running, and the next `omnitron restart acme/dev/<app>` finds no
 * handle and falls through here again — the name never comes back on its own.
 *
 * Seen on the dev stand on 2026-09-10: three backends lost their prefix across
 * a restart while the ones that still had a live handle kept theirs, which is
 * exactly the asymmetry this branch predicts.
 *
 * Then the sharper half of the same bug. Matching on the last segment reaches
 * ACROSS PROJECTS, and the names collide in practice: omnitron's own
 * `omnitron.config.ts` declares `main`, `payments`, `messaging`, `storage`,
 * `pricing` — the same five names a downstream stack uses. `omnitron restart
 * acme/dev/payments` matched omnitron's sample entry and launched
 * `apps/payments/src/main.ts` relative to the DAEMON's cwd. It died with
 * ERR_MODULE_NOT_FOUND on a path in neither repository, and the backend stayed
 * down while the command reported a restart.
 *
 * Starting the wrong app is worse than refusing. The operator is told their
 * service is coming back, and the log that says otherwise is the one they are
 * not reading yet.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'reflect-metadata';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

const silent = {
  info() {}, debug() {}, warn() {}, error() {}, trace() {}, fatal() {},
  child() { return silent; },
} as any;

/** The config as it is on disk: bare names, one entry per app. */
function build() {
  const orch = new OrchestratorService(silent, {} as any, {} as any, process.cwd());
  (orch as any).config = {
    // A project config: `project` is what tells the orchestrator these entries
    // are its own to start. The daemon's own config has no such field, and
    // that is the distinction the refusal below turns on.
    project: 'downstream',
    apps: [
      { name: 'main', bootstrap: './apps/main/src/bootstrap.ts' },
      { name: 'payments', bootstrap: './apps/payments/src/bootstrap.ts' },
    ],
  };

  const started: Array<{ name: string }> = [];
  (orch as any).startApp = async (entry: { name: string }) => {
    started.push({ ...entry });
    return { name: entry.name } as any;
  };
  return { orch: orch as any, started };
}

describe('restart with no live handle', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('starts the app under the name the operator asked for', async () => {
    await ctx.orch.restartApp('acme/dev/payments');

    expect(ctx.started).toHaveLength(1);
    expect(ctx.started[0]!.name, 'the app came back without its project prefix').toBe(
      'acme/dev/payments',
    );
  });

  it('starts the right app, not merely something', async () => {
    await ctx.orch.restartApp('acme/dev/payments');
    expect(ctx.started[0]!.name).not.toContain('main');
  });

  it('leaves a bare request bare', async () => {
    // `omnitron restart payments` in a single-project setup must not invent a
    // prefix that no stack owns.
    await ctx.orch.restartApp('payments');
    expect(ctx.started[0]!.name).toBe('payments');
  });

  it('does not rewrite an entry that is already namespaced', async () => {
    // An entry qualified under a DIFFERENT project is operator intent — a
    // cross-project administrative run — and must survive untouched.
    ctx.orch.config = { project: 'downstream', apps: [{ name: 'other/prod/payments', bootstrap: './b.ts' }] };

    await ctx.orch.restartApp('acme/dev/payments');

    expect(ctx.started[0]!.name).toBe('other/prod/payments');
  });

  it('still refuses an app no config declares', async () => {
    await expect(ctx.orch.restartApp('acme/dev/nosuchapp')).rejects.toThrow(/Unknown app/i);
    expect(ctx.started).toHaveLength(0);
  });

  it('refuses a project name when the config is the daemon\'s own', async () => {
    // The stand case, and the sharp one. omnitron's `omnitron.config.ts`
    // declares `payments` too, so matching on the last segment launched THAT
    // entry — `apps/payments/src/main.ts`, resolved against the daemon's cwd —
    // and left the real backend down while reporting a restart.
    ctx.orch.config = {
      // no `project`: this daemon supervises registered projects and owns none
      apps: [{ name: 'payments', script: './apps/payments/src/main.ts' }],
    };

    await expect(ctx.orch.restartApp('acme/dev/payments')).rejects.toThrow(/stack start/i);
    expect(ctx.started, 'it started someone else\'s app').toHaveLength(0);
  });

  it('names the command that does work', async () => {
    // A refusal that does not say what to do instead sends the operator to
    // the bare name, which is how the wrong app got started in the first place.
    ctx.orch.config = { apps: [{ name: 'payments', script: './x.ts' }] };

    await expect(ctx.orch.restartApp('acme/dev/payments')).rejects.toThrow(
      /omnitron stack start acme dev/,
    );
  });
});
