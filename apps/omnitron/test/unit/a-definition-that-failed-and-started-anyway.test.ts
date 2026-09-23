/**
 * A definition that failed to load, and an app started anyway.
 *
 * When an app's definition could not be loaded, the orchestrator logged
 * «Could not load bootstrap config for topology — using single-process mode»
 * at warn and started the app in that mode — a shape no titan app is written
 * for, since every definition declares its topology. Measured 2026-09-23:
 * paysys and messaging started so, and died on DI and module-path errors
 * while the cause sat one line up. A definition that does not load now
 * refuses the start with its reason.
 */
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

describe('an app whose definition does not load', () => {
  it('is refused with the reason, not started in a mode it was never written for', async () => {
    const self = { devMode: false, cwd: '/nonexistent', logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } };
    const handle = { markStarting: vi.fn() };
    const launch = (OrchestratorService.prototype as any).launchBootstrapMode;

    await expect(
      launch.call(self, { name: 'daos/dev/paysys', bootstrap: '/nonexistent/src/bootstrap.ts' }, handle, {}),
    ).rejects.toThrow(/Could not load daos\/dev\/paysys's definition/);
    expect(self.logger.warn).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/single-process mode/));
  });
});
