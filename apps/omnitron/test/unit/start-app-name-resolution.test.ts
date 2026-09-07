/**
 * The name `omnitron list` prints has to be a name `omnitron start` accepts.
 *
 * `list` reports canonical handle keys — `daos/dev/paysys` — because that is
 * what the orchestrator registers a project-scoped app under. `startApp`
 * looked the name up with `config.apps.find(a => a.name === data.name)`, and
 * the ecosystem config holds BARE names. So the only name an operator can see
 * is the one name the command rejects, with "App with id daos/dev/paysys not
 * found" — an error that says the app does not exist while the row above it
 * says it does.
 *
 * Met on 2026-09-07 while bringing a crashed app back up. The operator's next
 * move is the short name, and that is worse than a failure: it starts a
 * DIFFERENT entry — the config's bare-named one, in classic mode — and the
 * project-scoped handle is gone from the persisted state afterwards.
 *
 * Every other entry point already resolves. `getApp`, `stopApp`, `restartApp`
 * and `reloadApp` all go through `orchestrator.resolveAppName`, which matches
 * on the last `/`-segment and throws on ambiguity. `startApp` is the one that
 * compares strings.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'reflect-metadata';

import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import type { IEcosystemConfig } from '../../src/config/types.js';

/** The config as it is on disk: bare names, one entry per app. */
function ecosystem(): IEcosystemConfig {
  return {
    project: 'daos',
    stacks: { dev: {} },
    apps: [
      { name: 'main', bootstrap: './apps/main/src/bootstrap.ts' },
      { name: 'paysys', bootstrap: './apps/paysys/src/bootstrap.ts' },
    ],
  } as unknown as IEcosystemConfig;
}

function serviceWith(config: IEcosystemConfig) {
  const started: string[] = [];
  // The orchestrator owns the processes — that is the boundary. Its name
  // resolution is production's, reproduced here only as far as this test
  // needs: a handle exists under the canonical key.
  const orchestrator: any = {
    startApp: async (entry: { name: string }) => {
      started.push(entry.name);
    },
    getApp: (name: string) => ({ name, status: 'online', pid: 1 }),
  };
  const svc = new DaemonRpcService(orchestrator, {} as any, {} as any, config, {} as any);
  return { svc, started };
}

describe('startApp — the name an operator can see', () => {
  let ctx: ReturnType<typeof serviceWith>;
  beforeEach(() => {
    ctx = serviceWith(ecosystem());
  });

  it('accepts the canonical name that `list` prints', async () => {
    await expect(ctx.svc.startApp({ name: 'daos/dev/paysys' })).resolves.toBeTruthy();
    // Started the right one, not merely "something".
    expect(ctx.started).toHaveLength(1);
    expect(ctx.started[0]).toContain('paysys');
    expect(ctx.started[0]).not.toContain('main');
  });

  it('still accepts the bare name the config declares', async () => {
    // The other half has to survive: `omnitron start paysys` is what the
    // scaffolded single-project setup has always used.
    await expect(ctx.svc.startApp({ name: 'paysys' })).resolves.toBeTruthy();
    expect(ctx.started).toHaveLength(1);
    expect(ctx.started[0]).toContain('paysys');
  });

  it('still refuses a name that is in no config', async () => {
    // Resolving by last segment must not turn every miss into a hit.
    await expect(ctx.svc.startApp({ name: 'daos/dev/nosuchapp' })).rejects.toThrow(/not found|nosuchapp/i);
    expect(ctx.started).toHaveLength(0);
  });

  it('does not match a different app that shares a suffix', async () => {
    // `paysys` must not be reachable as `.../notpaysys` — a suffix match on
    // the raw string rather than on the path segment would do exactly that.
    await expect(ctx.svc.startApp({ name: 'daos/dev/notpaysys' })).rejects.toThrow();
    expect(ctx.started).toHaveLength(0);
  });
});
