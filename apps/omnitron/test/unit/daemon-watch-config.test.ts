import { describe, expect, it, vi } from 'vitest';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';
import { ORCHESTRATOR_TOKEN } from '../../src/shared/tokens.js';
import type { IEcosystemConfig } from '../../src/config/types.js';

const { configurations } = vi.hoisted(() => ({ configurations: [] as unknown[] }));
vi.mock('../../src/orchestrator/file-watcher.js', () => ({
  FileWatcher: class {
    constructor(_logger: unknown, _orchestrator: unknown, config: unknown) {
      configurations.push(config);
    }
    start() {}
    stop() {}
    applyConfig() {}
    getWatchedApps() {
      return [];
    }
  },
}));

function attach(daemon: OmnitronDaemon) {
  const orchestrator = {
    setWatchMode: vi.fn(async () => {}),
    getBuildWatchedApps: () => [{ name: 'project/dev/api', directory: '/srv/api/src' }],
  };
  Object.assign(daemon, {
    app: {
      container: {
        resolveAsync: async (token: unknown) => (token === ORCHESTRATOR_TOKEN ? orchestrator : { logger: {} }),
      },
    },
  });
  return orchestrator;
}

describe('watch configuration belongs to the running daemon', () => {
  it('uses the last accepted configuration when CWD has no ecosystem file', async () => {
    const daemon = new OmnitronDaemon();
    const config = { apps: [] } as unknown as IEcosystemConfig;
    await daemon.applyWatchConfig(config);
    const orchestrator = attach(daemon);
    await expect(daemon.enableWatch(['project/dev/api'])).resolves.toEqual(orchestrator.getBuildWatchedApps());
    expect(configurations.at(-1)).toBe(config);
    expect(orchestrator.setWatchMode).toHaveBeenCalledWith(true, ['project/dev/api']);
  });
  it('refuses missing configuration before stopping an existing watcher', async () => {
    const daemon = new OmnitronDaemon();
    attach(daemon);
    const stop = vi.fn();
    Object.assign(daemon, { fileWatcher: { stop } });
    await expect(daemon.enableWatch()).rejects.toThrow('configuration is unavailable');
    expect(stop).not.toHaveBeenCalled();
  });
});
