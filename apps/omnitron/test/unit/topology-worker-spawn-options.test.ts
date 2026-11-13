import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ProcessManager, ProcessStatus, type ISpawnOptions } from '@omnitron-dev/titan-pm';
import { defineEcosystem } from '../../src/config/define-ecosystem.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

it.each(['error', 'trace', 'verbose', undefined])(
  'delivers the application RPC deadline and declared log level %s to every native worker', async level => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'topology-spawn-')));
    const bootstrap = path.join(root, 'src', 'bootstrap.mjs');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const pm = new ProcessManager(logger as never, { livenessSweepIntervalMs: 0 });
    const launches: ISpawnOptions[] = [];
    Object.assign(pm, { spawner: { async spawn(_module: unknown, options: ISpawnOptions) {
      launches.push(options);
      return { id: options.processId, status: ProcessStatus.RUNNING, isAlive: () => true,
        proxy: { __processId: options.processId }, terminate: vi.fn() };
    } } });
    const owner = new OrchestratorService(logger as never, pm, {} as never, root);
    Object.assign(owner, { bootstrapRuntime: async () => bootstrap, ensureBootReconciled: vi.fn(),
      ensureMetricsPolling: vi.fn(), persistState: vi.fn(), startPostOnlineCooldown: vi.fn() });
    try {
      await fs.mkdir(path.join(root, 'src'));
      await fs.mkdir(path.join(root, 'config'));
      await fs.writeFile(path.join(root, 'config/default.json'), JSON.stringify({ logger: { level } }));
      await fs.writeFile(bootstrap, 'export default ' + JSON.stringify({ name: 'demo', version: '1',
        processes: [{ name: 'api', module: './worker.mjs', health: { enabled: false } },
          { name: 'jobs', module: './worker.mjs', instances: 2, health: { enabled: false } }] }));
      await fs.writeFile(path.join(root, 'src/worker.mjs'), 'export default class Worker {}');

      const handle = await owner.startApp({ name: 'demo', cwd: root, bootstrap, watch: false,
        env: { OMNITRON_STACK: 'test' } }, defineEcosystem({ apps: [] }));
      expect(handle.status).toBe('online');
      expect(launches.map(options => options.dependencies?.['processName']).sort()).toEqual(['api', 'jobs', 'jobs']);
      for (const options of launches) {
        expect(options.requestTimeout).toBe(120_000);
        expect(options.logLevel).toBe(level === 'verbose' ? undefined : level);
      }
      if (level === 'verbose') expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ level }), expect.stringContaining('children keep the default'));
      handle.markStopping();
      await handle.supervisor?.stop();
    } finally {
      await pm.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  }
);
