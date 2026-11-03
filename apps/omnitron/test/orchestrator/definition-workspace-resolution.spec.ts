import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuildService } from '../../src/orchestrator/build-service.js';
import type { IAppDefinition } from '../../src/config/types.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-definition-workspace-'));
const runtime = path.join(root, 'runtime');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/orchestrator');
const builders: BuildService[] = [];
let sequence = 0;

beforeAll(async () => {
  fs.mkdirSync(runtime);
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  // The child is a compiled reader with no TypeScript preload or Vitest.
  const require = createRequire(import.meta.url);
  fs.symlinkSync(path.dirname(require.resolve('esbuild/package.json')), path.join(root, 'node_modules/esbuild'), 'dir');
  await build({
    entryPoints: ['bootstrap-loader', 'bootstrap-loader-child', 'ts-compiler', 'runtime-package-resolution'].map(name => path.join(source, name + '.ts')),
    outdir: runtime, platform: 'node', target: 'node22', format: 'esm', bundle: false,
  });
});
afterEach(async () => {
  for (const builder of builders.splice(0)) await builder.dispose();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(importOnly = false) {
  const project = path.join(root, 'project-' + ++sequence);
  const app = path.join(project, 'apps/probe');
  const kit = path.join(project, 'packages/kit');
  const built = path.join(project, 'node_modules/@fixture/built');
  for (const directory of [path.join(app, 'src'), path.join(kit, 'src'), built]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: '@fixture/kit', type: 'module',
    exports: { '.': importOnly ? { import: './src/index.ts' } : './src/index.ts' } }));
  fs.symlinkSync(kit, path.join(project, 'node_modules/@fixture/kit'), 'dir');
  fs.writeFileSync(path.join(kit, 'src/index.ts'), "export { current } from './worker.js';\n");
  fs.writeFileSync(path.join(built, 'package.json'), JSON.stringify({ name: '@fixture/built', type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(built, 'index.js'), "export const marker = 'prebuilt-runtime-value';\n");
  const change = (value: string) => fs.writeFileSync(path.join(kit, 'src/worker.ts'), `
function Tagged<T extends new (...args: any[]) => any>(target: T): T { return target; }
@Tagged
class Worker { constructor(public readonly value: string) {} }
export const current = new Worker(${JSON.stringify(value)});
`);
  change('first');
  const bootstrap = path.join(app, 'src/bootstrap.ts');
  fs.writeFileSync(bootstrap, `import { current } from '@fixture/kit';
import { marker } from '@fixture/built';
export default { name: current.value + '-' + marker, processes: [{ name: 'worker', module: './worker.ts' }] };
`);
  fs.writeFileSync(path.join(app, 'src/worker.ts'), "export { current as default } from '@fixture/kit';\n");
  return { project, app, bootstrap, change };
}

function plainRead(bootstrap: string, fresh: boolean) {
  const script = fresh
    ? `const { loadBootstrapConfig } = await import(${JSON.stringify(pathToFileURL(path.join(runtime, 'bootstrap-loader.js')).href)}); console.log(JSON.stringify(await loadBootstrapConfig(${JSON.stringify(bootstrap)}, { devMode: true, freshModuleGraph: true })));`
    : `console.log(JSON.stringify((await import(${JSON.stringify(pathToFileURL(bootstrap).href)})).default));`;
  const env = { ...process.env };
  delete env['NODE_OPTIONS'];
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, env, encoding: 'utf8', timeout: 20_000,
  });
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  return JSON.parse(result.stdout.trim()) as IAppDefinition;
}

describe('one workspace source policy for definitions and worker builds', () => {
  it.each([false, true])('reads .js specifiers and decorators with a plain Node fresh reader (import-only=%s)', (importOnly) => {
    const f = fixture(importOnly);
    expect(plainRead(f.bootstrap, true).name).toBe('first-prebuilt-runtime-value');
    // Observe a dependency edit even when bootstrap.ts did not change.
    f.change('second');
    expect(plainRead(f.bootstrap, true).name).toBe('second-prebuilt-runtime-value');
  }, 45_000);

  it('keeps compiled packages external and rebuilds watched workspace source dependencies', async () => {
    const f = fixture(true);
    const definition = plainRead(f.bootstrap, true);
    const builder = new BuildService(true);
    builders.push(builder);
    const result = await builder.buildApp('probe', f.bootstrap, definition);
    expect(plainRead(result.bootstrapPath, false).name).toBe(definition.name);
    const output = fs.readFileSync(result.bootstrapPath, 'utf8');
    expect(output).toContain('@fixture/built');
    expect(output).not.toContain('prebuilt-runtime-value');
    expect(output).not.toContain('@fixture/kit');
    // watch() starts asynchronously. Remove the preceding build outputs and
    // wait for the watch context's initial outputs before editing a dependency.
    const outputs = [result.bootstrapPath, ...result.modulePaths.values()];
    for (const file of outputs) fs.unlinkSync(file);
    let changes = 0;
    await builder.watchApp('probe', f.bootstrap, definition, () => { changes++; });
    await expect.poll(() => outputs.every(file => fs.existsSync(file)), { timeout: 10_000 }).toBe(true);
    expect(plainRead(result.bootstrapPath, false).name).toBe(definition.name);
    f.change('watched');
    await expect.poll(() => changes, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(plainRead(result.bootstrapPath, false).name).toBe('watched-prebuilt-runtime-value');
    expect(plainRead(f.bootstrap, true).name).toBe('watched-prebuilt-runtime-value');
  }, 45_000);
});
