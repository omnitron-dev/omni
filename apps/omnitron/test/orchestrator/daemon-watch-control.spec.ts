import { describe, expect, it, vi } from 'vitest';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
function fixture() {
  const logger: any = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
  logger.child = () => logger;
  const orchestrator = new OrchestratorService(logger, {} as never, {} as never, process.cwd());
  const daemon = new OmnitronDaemon() as any;
  daemon.app = { container: { resolveAsync: vi.fn(async () => orchestrator) } };
  return { daemon, orchestrator, logger };
}
describe('daemon watch control', () => {
  it.each([{ watch: true, noWatch: true }, { watch: false }, undefined])('does not arm watching with options %j', async (options) => {
    const { daemon, orchestrator, logger } = fixture();
    await daemon.startFileWatcher({ apps: [] }, options, logger);
    expect(orchestrator.devMode).toBe(false);
    expect(await daemon.getWatchStatus()).toMatchObject({ enabled: false, watching: false, apps: [] });
  });
  it('reports esbuild watches, and awaits disposal through the native disable control', async () => {
    const { daemon, orchestrator, logger } = fixture();
    await daemon.startFileWatcher({ apps: [] }, { watch: true }, logger);
    expect(orchestrator.devMode).toBe(true);
    let watching = true;
    vi.spyOn(orchestrator, 'getBuildWatchedApps').mockImplementation(() => watching ? [{ name: 'registered/local/worker', directory: '/project' }] : []);
    expect(await daemon.getWatchStatus()).toMatchObject({ enabled: true, watching: true, apps: [{ name: 'registered/local/worker', directory: '/project' }] });
    let finish!: () => void;
    const mode = vi.spyOn(orchestrator, 'setWatchMode').mockImplementation(() => new Promise((r) => { finish = () => { watching = false; r(); }; }));
    let done = false;
    const stopped = daemon.disableWatch().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(mode).toHaveBeenCalledWith(false);
    finish(); await stopped;
    expect(await daemon.getWatchStatus()).toMatchObject({ enabled: false, watching: false });
  });
  it('applies ecosystem watch changes only to the matching source', async () => {
    const { daemon, orchestrator } = fixture();
    const handle = new AppHandle({ name: 'lab/local/worker', bootstrap: '/lab/worker.ts' }, 'bootstrap');
    (orchestrator as any).handles.set(handle.name, handle);
    await daemon.applyWatchConfig({ apps: [{ name: 'worker', bootstrap: '/other/worker.ts', watch: false }] });
    expect(handle.entry.watch).toBeUndefined();
    await daemon.applyWatchConfig({ apps: [{ name: 'worker', bootstrap: '/lab/worker.ts', watch: false }] });
    expect(handle.entry.watch).toBe(false);
  });
});
