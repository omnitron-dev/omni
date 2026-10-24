import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildService } from '../../src/orchestrator/build-service.js';
const roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
function fakeEngine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-disposal-')); roots.push(root);
  const source = path.join(root, 'source.ts'); fs.writeFileSync(source, 'export default 1;');
  let onEnd!: (result: unknown) => void;
  const contexts: Array<{ watch: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
  const engine = { context: vi.fn(async (options: any) => {
    const ctx = { watch: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
    contexts.push(ctx);
    options.plugins.find((p: any) => p.name === 'rebuild-notify').setup({ onEnd: (fn: typeof onEnd) => { onEnd = fn; } });
    return ctx;
  }) };
  return { engine, contexts, source, output: path.join(root, 'out.js'), stale: () => onEnd({ errors: [{ location: { file: source, line: 999 } }] }) };
}
describe('esbuild watcher ownership', () => {
  it('does not resurrect a disposed context from a scheduled self-heal', async () => {
    const f = fakeEngine(), service = new BuildService(true);
    const handle = await (service as any).createWatchContext(f.engine, f.source, f.output, vi.fn());
    f.stale(); await handle.dispose();
    await new Promise((r) => setImmediate(r));
    expect(f.engine.context).toHaveBeenCalledTimes(1);
    expect(f.contexts[0]!.dispose).toHaveBeenCalled();
  });
  it('waits for an in-flight self-heal and prevents the replacement from watching', async () => {
    const f = fakeEngine(), service = new BuildService(true);
    const handle = await (service as any).createWatchContext(f.engine, f.source, f.output, vi.fn());
    let release!: () => void;
    f.contexts[0]!.dispose.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    f.stale(); await new Promise((r) => setImmediate(r));
    let stopped = false;
    const stopping = handle.dispose().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    release(); await stopping;
    expect(f.engine.context).toHaveBeenCalledTimes(1);
  });
  it('disposes a context whose initial watch activation fails', async () => {
    const f = fakeEngine(), service = new BuildService(true);
    const original = f.engine.context.getMockImplementation()!;
    f.engine.context.mockImplementation(async (options) => {
      const ctx = await original(options); ctx.watch.mockRejectedValueOnce(new Error('watch refused')); return ctx;
    });
    await expect((service as any).createWatchContext(f.engine, f.source, f.output, vi.fn())).rejects.toThrow('watch refused');
    expect(f.contexts[0]!.dispose).toHaveBeenCalledTimes(1);
  });
});
