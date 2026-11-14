import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildService } from '../../src/orchestrator/build-service.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import type { IAppDefinition } from '../../src/config/types.js';

const execute = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-build-refresh-'));
  cleanups.push(async () => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(root, 'node_modules'));
  const dependency = path.join(root, 'node_modules', 'fixture-dependency');
  const install = (version: number) => {
    const directory = path.join(root, `dependency-${version}`);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module","exports":"./index.js"}');
    fs.writeFileSync(path.join(directory, 'index.js'), `export const value = ${version};`);
    if (fs.existsSync(dependency)) fs.unlinkSync(dependency);
    fs.symlinkSync(directory, dependency, 'dir');
    return directory;
  };
  const old = install(1);
  const bootstrap = path.join(root, 'bootstrap.ts');
  const worker = path.join(root, 'worker.ts');
  const definition: IAppDefinition = {
    name: 'probe',
    version: '1',
    processes: [{ name: 'worker', module: './worker.ts' }],
  };
  fs.writeFileSync(
    bootstrap,
    `export { value } from 'fixture-dependency'; export default ${JSON.stringify(definition)};`
  );
  fs.writeFileSync(worker, "export { value } from 'fixture-dependency';");
  const builder = new BuildService(true);
  cleanups.push(() => builder.dispose());
  const repair = () => {
    install(2);
    fs.rmSync(old, { recursive: true });
  };
  const read = async (file: string) =>
    Number(
      (
        await execute(process.execPath, [
          '--input-type=module',
          '-e',
          `import(${JSON.stringify(pathToFileURL(file).href)}).then(module => console.log(module.value))`,
        ])
      ).stdout.trim()
    );
  return { root, bootstrap, worker, definition, builder, repair, read };
}

describe('source launch freshness', () => {
  it('re-resolves replaced dependency targets for every entry before a reused launch', async () => {
    const f = fixture();
    const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const owner = new OrchestratorService(logger, {} as never, {} as never, f.root);
    owner.devMode = true;
    const internal = owner as any;
    internal.buildService = f.builder;
    const entry = { name: 'probe', bootstrap: f.bootstrap };
    internal.handles.set(entry.name, new AppHandle(entry, 'bootstrap'));
    await internal.prepareBootstrapBuild(entry, f.bootstrap, f.definition);
    await f.builder.rebuildApp(entry.name); // Establish the initial watch baseline.
    const initial = internal.buildResults.get(entry.name);
    expect(await f.read(initial.bootstrapPath)).toBe(1);
    expect(await f.read(initial.modulePaths.get('worker'))).toBe(1);
    f.repair();
    expect(f.builder.canReuseBuild(initial, f.bootstrap, f.definition)).toBe(true);
    await internal.prepareBootstrapBuild(entry, f.bootstrap, f.definition);
    expect(internal.buildResults.get(entry.name)).toBe(initial);
    expect(await f.read(initial.bootstrapPath)).toBe(2);
    expect(await f.read(initial.modulePaths.get('worker'))).toBe(2);
  });

  it('does not schedule a duplicate restart for an explicitly refreshed dependency', async () => {
    const f = fixture();
    await f.builder.buildApp('probe', f.bootstrap, f.definition);
    const changed = vi.fn();
    await f.builder.watchApp('probe', f.bootstrap, f.definition, changed);
    await f.builder.rebuildApp('probe');
    f.repair();
    await f.builder.rebuildApp('probe');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(changed).not.toHaveBeenCalled();
    fs.writeFileSync(f.worker, 'export const value = 3;');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce(), { timeout: 5000 });
  });

  it('refuses a fresh launch when rebuilding the current source fails', async () => {
    const f = fixture();
    await f.builder.buildApp('probe', f.bootstrap, f.definition);
    await f.builder.watchApp('probe', f.bootstrap, f.definition, vi.fn());
    await f.builder.rebuildApp('probe');
    fs.writeFileSync(f.worker, 'export const value = ;');
    await expect(f.builder.rebuildApp('probe')).rejects.toThrow(/Source rebuild failed/);
  });

  it('retains an automatic edit on a refreshed entry while another entry is still rebuilding', async () => {
    const f = fixture();
    const contexts: Array<{ emit: (text: string) => void; complete: () => void }> = [];
    const engine = {
      context: async (options: any) => {
        let onEnd!: (result: { errors: unknown[] }) => void;
        options.plugins
          .find((plugin: any) => plugin.name === 'rebuild-notify')
          .setup({
            onEnd: (callback: typeof onEnd) => {
              onEnd = callback;
            },
          });
        let complete!: () => void;
        const pending = new Promise<void>((resolve) => {
          complete = resolve;
        });
        const emit = (text: string) => {
          fs.writeFileSync(options.outfile, text);
          onEnd({ errors: [] });
        };
        contexts.push({ emit, complete });
        return {
          watch: async () => emit('initial'),
          rebuild: async () => {
            await pending;
            emit('explicit');
          },
          dispose: async () => {},
        };
      },
    };
    (f.builder as any).esbuildHandle = { use: (run: (engine: unknown) => unknown) => run(engine) };
    const changed = vi.fn();
    await f.builder.watchApp('probe', f.bootstrap, f.definition, changed);
    let refreshed = false;
    const pending = f.builder.rebuildApp('probe').then(() => {
      refreshed = true;
    });
    contexts[0]!.complete();
    await new Promise((resolve) => setImmediate(resolve));
    expect(refreshed).toBe(false);
    vi.useFakeTimers();
    contexts[0]!.emit('a later automatic edit');
    await vi.advanceTimersByTimeAsync(750);
    expect(changed).toHaveBeenCalledOnce();
    expect(refreshed).toBe(false);
    contexts[1]!.complete();
    await pending;
    await vi.advanceTimersByTimeAsync(1000);
    expect(changed).toHaveBeenCalledOnce();
  });
});
