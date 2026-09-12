/**
 * The name `omnitron list` prints has to be a name `omnitron start` accepts.
 *
 * `list` reports canonical handle keys — `acme/dev/payments` — because that is
 * what the orchestrator registers a project-scoped app under. `startApp`
 * looked the name up with `config.apps.find(a => a.name === data.name)`, and
 * the ecosystem config holds BARE names. So the only name an operator can see
 * is the one name the command rejects, with "App with id acme/dev/payments not
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
    project: 'downstream',
    stacks: { dev: {} },
    apps: [
      { name: 'main', bootstrap: './apps/main/src/bootstrap.ts' },
      { name: 'payments', bootstrap: './apps/payments/src/bootstrap.ts' },
    ],
  } as unknown as IEcosystemConfig;
}

/**
 * `registry` is what the orchestrator already supervises, keyed by canonical
 * name — a project stack's handles, which this daemon's config never declared.
 * It defaults to empty, because that is the state every assertion below about
 * refusing an unknown name depends on: `getApp` must answer `undefined` for a
 * name nothing has registered. The fake used to return a live-looking object
 * for EVERY name, so it could not tell "registered" from "invented" and would
 * have called any miss a hit.
 */
function serviceWith(config: IEcosystemConfig, registry: Record<string, string> = {}) {
  const started: string[] = [];
  // The orchestrator owns the processes — that is the boundary. Its name
  // resolution is production's, reproduced here only as far as this test
  // needs: a handle exists under the canonical key.
  const resolve = (name: string): string | undefined => {
    if (registry[name]) return name;
    // Production resolves by path SEGMENT (`resolveAppName`), never by string
    // suffix — which is what keeps `.../notpayments` from reaching `payments`.
    const seg = name.split('/').pop();
    return Object.keys(registry).find((k) => k.split('/').pop() === seg);
  };
  const orchestrator: any = {
    startApp: async (entry: { name: string }) => {
      started.push(entry.name);
      // A started app is a registered app; `startApp` reads it back through
      // `getApp` immediately afterwards.
      registry[entry.name] = 'online';
    },
    getApp: (name: string) => {
      const key = resolve(name);
      return key ? { name: key, status: registry[key], pid: 1 } : undefined;
    },
    startKnownApp: async (name: string) => {
      const key = resolve(name);
      if (!key) return undefined;
      started.push(key);
      registry[key] = 'online';
      return { name: key };
    },
  };
  const svc = new DaemonRpcService(orchestrator, {} as any, {} as any, config, {} as any);
  return { svc, started, registry };
}

describe('startApp — the name an operator can see', () => {
  let ctx: ReturnType<typeof serviceWith>;
  beforeEach(() => {
    ctx = serviceWith(ecosystem());
  });

  it('accepts the canonical name that `list` prints', async () => {
    await expect(ctx.svc.startApp({ name: 'acme/dev/payments' })).resolves.toBeTruthy();
    // Started the right one, not merely "something".
    expect(ctx.started).toHaveLength(1);
    expect(ctx.started[0]).toContain('payments');
    expect(ctx.started[0]).not.toContain('main');
  });

  it('still accepts the bare name the config declares', async () => {
    // The other half has to survive: `omnitron start payments` is what the
    // scaffolded single-project setup has always used.
    await expect(ctx.svc.startApp({ name: 'payments' })).resolves.toBeTruthy();
    expect(ctx.started).toHaveLength(1);
    expect(ctx.started[0]).toContain('payments');
  });

  it('still refuses a name that is in no config', async () => {
    // Resolving by last segment must not turn every miss into a hit.
    await expect(ctx.svc.startApp({ name: 'acme/dev/nosuchapp' })).rejects.toThrow(/not found|nosuchapp/i);
    expect(ctx.started).toHaveLength(0);
  });

  it('refuses a project name the daemon cannot register, rather than registering it wrong', async () => {
    // The half the first fix left undone, observed live on the stand.
    // Accepting `acme/dev/storage` is only half the job: `namespaceEntry`
    // promotes the handle key from the daemon's OWN config, and a daemon
    // supervising registered PROJECTS has no `project` of its own — so the
    // promotion is a no-op and the app registers under the bare `storage`,
    // beside the canonical entry the stack owns.
    //
    // That is worse than the original refusal. Before, the command failed and
    // nothing happened; after, it reports success and the state store gains a
    // duplicate in classic mode. Refusing with the command that does work is
    // the honest answer — `stack start` owns project apps.
    const config = ecosystem();
    delete (config as { project?: string }).project;
    const ctx = serviceWith(config);

    await expect(ctx.svc.startApp({ name: 'acme/dev/payments' })).rejects.toThrow(/stack start/i);
    expect(ctx.started).toHaveLength(0);
  });

  it('does not match a different app that shares a suffix', async () => {
    // `payments` must not be reachable as `.../notpayments` — a suffix match on
    // the raw string rather than on the path segment would do exactly that.
    await expect(ctx.svc.startApp({ name: 'acme/dev/notpayments' })).rejects.toThrow();
    expect(ctx.started).toHaveLength(0);
  });

  describe('an app the daemon supervises but never declared', () => {
    // The stand's daemon has no apps of its own: the six downstream backends are
    // registered by a project stack. `ls` prints them, `stop` and `restart`
    // take them, and `start` answered "not found" — met live on 2026-09-13
    // while bringing storage back up after stopping it to measure something.
    const bare = () => ({ project: undefined, stacks: {}, apps: [] } as unknown as IEcosystemConfig);

    it('starts a registered app the config knows nothing about', async () => {
      const ctx = serviceWith(bare(), { 'acme/dev/storage': 'stopped' });

      await expect(ctx.svc.startApp({ name: 'acme/dev/storage' })).resolves.toBeTruthy();
      expect(ctx.started, 'the registry fallback never started it').toEqual(['acme/dev/storage']);
    });

    it('is idempotent on one that is already up', async () => {
      const ctx = serviceWith(bare(), { 'acme/dev/storage': 'online' });

      const info = await ctx.svc.startApp({ name: 'acme/dev/storage' });
      expect(info.status).toBe('online');
      expect(ctx.started, 'start on a running app spawned a second one').toHaveLength(0);
    });

    it('still refuses a name that is neither declared nor registered', async () => {
      const ctx = serviceWith(bare(), { 'acme/dev/storage': 'stopped' });

      await expect(ctx.svc.startApp({ name: 'acme/dev/ghost' })).rejects.toThrow(/ghost/i);
      expect(ctx.started).toHaveLength(0);
    });

    it('names the command that does work when the app is project-scoped', async () => {
      // The guidance `startApp` already carried was unreachable for exactly
      // this shape: it sits after `findConfiguredApp`, and a project-scoped
      // name the daemon never declared has no entry to find, so the bare
      // `notFound` fired first.
      const ctx = serviceWith(bare());

      await expect(ctx.svc.startApp({ name: 'acme/dev/ghost' })).rejects.toThrow(
        /omnitron stack start acme dev/i,
      );
    });
  });
});