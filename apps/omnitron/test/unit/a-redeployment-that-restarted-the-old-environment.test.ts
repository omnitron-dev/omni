/**
 * A redeployment that restarted the old environment.
 *
 * A deployment writes a node's config — every app's environment — and then
 * registers the project with `omnitron project add`. After the first
 * deployment that answered «Project 'daos' already registered» (four times in
 * two days, measured), the deployer's step failed on the exit code, and the
 * node never read what it had just been given. Then the app was restarted by
 * name, and a restart starts from the entry the handle captured at the FIRST
 * start. Measured on daos/test, 2026-09-23: paysys came back pointed at the
 * bitcoin daemon's previous address (192.168.100.2:8332, refused) with the
 * new one — loopback — sitting in the node's config file; a daemon restart
 * brought it up on the new one in a second.
 *
 * Now a project added again at its own path is read again, the apps its
 * running local stacks supervise are given the definition that config now
 * describes, and a restart starts from that.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { ProjectService } from '../../src/services/project.service.js';

const OLD = { name: 'daos/deployed/paysys', script: 'x', env: { BITCOIN_RPC_URL: 'http://192.168.100.2:8332' } };
const NEW = { name: 'daos/deployed/paysys', script: 'x', env: { BITCOIN_RPC_URL: 'http://127.0.0.1:8332' } };

describe('a restart starts from the definition the app was last given', () => {
  it('restarts on the new environment after a redefinition', async () => {
    const handle = new AppHandle(OLD as never, 'bootstrap');
    const self = {
      handles: new Map([[OLD.name, handle]]),
      devMode: false,
      stopApp: vi.fn(async () => undefined),
      startApp: vi.fn(async (entry: unknown) => entry),
    };
    handle.redefine(NEW as never);

    await (OrchestratorService.prototype as any).restartAppNow.call(self, OLD.name);

    expect(self.startApp).toHaveBeenCalledWith(NEW);
  });

  it('refuses a definition for another app', () => {
    const handle = new AppHandle(OLD as never, 'bootstrap');
    expect(() => handle.redefine({ ...NEW, name: 'daos/deployed/main' } as never)).toThrow(/cannot redefine/);
    expect(handle.entry).toBe(OLD);
  });

  it('answers false for an app it does not supervise', () => {
    const self = { handles: new Map(), resolveAppName: () => undefined };
    expect(OrchestratorService.prototype.redefineApp.call(self as never, 'nope', NEW as never)).toBe(false);
  });
});

describe('a project added again at its own path is read again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reread-'));

  function service(stackStates: Array<[string, { stack: string; status: string }]>) {
    const redefined: Array<{ name: string; env: unknown }> = [];
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registry: {
        get: (name: string) => (name === 'daos' ? { name: 'daos', path: dir, registeredAt: '2026-09-20T00:00:00Z' } : undefined),
        add: vi.fn(() => {
          throw new Error("Project 'daos' already registered. Use 'omnitron project remove daos' first.");
        }),
        list: () => [],
      },
      configRegistry: new Map([['daos', { config: { stale: true } }]]),
      loadProjectConfig: vi.fn(async function (this: any) {
        // Fresh only if the cache was dropped first.
        return this.configRegistry.has('daos') ? { stale: true } : { stale: false };
      }),
      resolveStacks: (config: { stale: boolean }) => ({
        deployed: { type: 'local', apps: 'all', __stale: config.stale },
        test: { type: 'remote', apps: 'all' },
      }),
      stackStates: new Map(stackStates.map(([key, st]) => [key, { project: 'daos', config: {}, startedAt: 1, infraService: null, ...st }])),
      loadAppDefinitions: vi.fn(async () => new Map()),
      resolveStackApps: () => [{ name: 'paysys', script: 'x' }],
      stackEntryBuilder: (_p: string, stack: string, stackConfig: { __stale?: boolean }) => (entry: { name: string }) => ({
        ...entry,
        name: `daos/${stack}/${entry.name}`,
        env: stackConfig.__stale ? OLD.env : NEW.env,
      }),
      orchestrator: {
        redefineApp: (name: string, entry: { env: unknown }) => {
          redefined.push({ name, env: entry.env });
          return true;
        },
      },
      toProjectInfo: (p: { name: string; path: string }) => ({ name: p.name, path: p.path }),
      emit: vi.fn(),
    });
    return { svc, redefined };
  }

  it('reads the config again and redefines the apps of its running local stacks', async () => {
    const { svc, redefined } = service([
      ['daos/deployed', { stack: 'deployed', status: 'running' }],
      ['daos/test', { stack: 'test', status: 'running' }],
    ]);

    const info = await svc.addProject('daos', dir);

    expect(svc.registry.add).not.toHaveBeenCalled();
    expect(info.reread).toEqual({ redefined: 1 });
    // The fresh config — the cache was dropped before the read — and the
    // local stack only: a remote stack's apps are redefined on their node.
    expect(redefined).toEqual([{ name: 'daos/deployed/paysys', env: NEW.env }]);
  });

  it('leaves a stopped stack alone', async () => {
    const { svc, redefined } = service([['daos/deployed', { stack: 'deployed', status: 'stopped' }]]);
    await svc.addProject('daos', dir);
    expect(redefined).toEqual([]);
  });

  it('still refuses the name at another path — that is another project', async () => {
    const { svc } = service([]);
    await expect(svc.addProject('daos', path.join(dir, 'elsewhere'))).rejects.toThrow(/already registered/);
  });
});
