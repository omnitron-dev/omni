import { describe, expect, it, vi } from 'vitest';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';
import { ORCHESTRATOR_TOKEN } from '../../src/shared/tokens.js';
import type { IEcosystemConfig } from '../../src/config/types.js';

function attach(daemon: OmnitronDaemon) {
  const orchestrator = {
    setWatchMode: vi.fn(async () => {}),
    getWatchedApps: () => [{ name: 'project/dev/api', directory: '/srv/api/src', generation: 'generation-1', definitionRevision: 0 }],
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
    await expect(daemon.enableWatch(['project/dev/api'])).resolves.toEqual(orchestrator.getWatchedApps());
    expect(orchestrator.setWatchMode).toHaveBeenCalledWith(true, ['project/dev/api']);
  });
  it('refuses missing configuration before stopping an existing watcher', async () => {
    const daemon = new OmnitronDaemon();
    const orchestrator = attach(daemon);
    await expect(daemon.enableWatch()).rejects.toThrow('configuration is unavailable');
    expect(orchestrator.setWatchMode).not.toHaveBeenCalled();
  });
});
