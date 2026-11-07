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
  fs.mkdirSync(path.join(root, 'node_modules/@omnitron-dev'));
  fs.symlinkSync(path.resolve(path.dirname(require.resolve('@omnitron-dev/titan')), '..'), path.join(root, 'node_modules/@omnitron-dev/titan'), 'dir');
  await build({ entryPoints: [path.join(source, '../shared/fresh-module-reader.ts')], outdir: path.join(root, 'shared'),
    platform: 'node', target: 'node22', format: 'esm', bundle: false });
  await build({ entryPoints: [path.join(source, '../release/closure-library-path.ts')], outdir: path.join(root, 'release'),
    platform: 'node', target: 'node22', format: 'esm', bundle: false });
  await build({
    entryPoints: ['bootstrap-loader', 'bootstrap-loader-child', 'ts-compiler', 'runtime-package-resolution'].map(name => path.join(source, name + '.ts')),
    outdir: runtime, platform: 'node', target: 'node22', format: 'esm', bundle: false,
  });
});
afterEach(async () => {
  for (const builder of builders.splice(0)) await builder.dispose();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(importOnly = false, libraryDirectory = 'kit') {
  const project = path.join(root, 'project-' + ++sequence);
  const app = path.join(project, 'apps/probe');
  const kit = path.join(project, 'packages', libraryDirectory);
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
  return { project, app, kit, bootstrap, change };
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
    expect(output).toContain('node_modules/%40fixture/built/index.js');
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

  it('reads, builds and watches a project registered through a deeper directory symlink', async () => {
    const f = fixture(true);
    const linked = path.join(root, 'operator/deep/internal/project #1%');
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.symlinkSync(f.project, linked, 'dir');
    const bootstrap = path.join(linked, path.relative(f.project, f.bootstrap));
    const definition = plainRead(bootstrap, true);
    expect(definition.name).toBe('first-prebuilt-runtime-value');
    const builder = new BuildService(true); builders.push(builder);
    const result = await builder.buildApp('linked', bootstrap, definition);
    expect(plainRead(result.bootstrapPath, false).name).toBe(definition.name);
    expect(plainRead(fs.realpathSync(result.bootstrapPath), false).name).toBe(definition.name);
    let changes = 0;
    await builder.watchApp('linked', bootstrap, definition, () => { changes++; });
    f.change('linked-watch');
    await expect.poll(() => changes, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(plainRead(result.bootstrapPath, false).name).toBe('linked-watch-prebuilt-runtime-value');
    expect(plainRead(bootstrap, true).name).toBe('linked-watch-prebuilt-runtime-value');
    expect(fs.readlinkSync(linked)).toBe(f.project);
  }, 45_000);

  it('keeps library-owned compiled dependencies and import conditions after relocating the workspace', async () => {
    const libraryDirectory = 'kit #1%';
    const f = fixture(true, libraryDirectory);
    const dependency = (directory: string, marker: string, version = '1.0.0') => {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: '@fixture/' + path.basename(directory), version, type: 'module',
        exports: { '.': { import: './import.js', require: './require.cjs' } } }));
      fs.writeFileSync(path.join(directory, 'import.js'), `export const marker=${JSON.stringify(marker)}; export const identity={};`);
      fs.writeFileSync(path.join(directory, 'require.cjs'), "throw Error('Wrong require condition');");
    };
    dependency(path.join(f.project, 'node_modules/@fixture/conditional'), 'app-version');
    dependency(path.join(f.kit, 'node_modules/@fixture/conditional'), 'library-version', '2.0.0');
    const manifest = path.join(f.kit, 'package.json');
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')),
      dependencies: { '@fixture/conditional': '2.0.0', '@fixture/private': '1.0.0' } }));
    fs.appendFileSync(path.join(f.kit, 'src/index.ts'), "export { marker as libraryMarker, identity as libraryIdentity } from '@fixture/conditional';\n");
    // Only the library declares this package. It cannot resolve from the app.
    const privateDependency = path.join(f.kit, 'node_modules/@fixture/private');
    dependency(privateDependency, 'library-private');
    fs.appendFileSync(path.join(f.kit, 'src/index.ts'), "export { marker as privateMarker } from '@fixture/private';\n");
    fs.writeFileSync(f.bootstrap, `
import { libraryMarker, libraryIdentity, privateMarker } from '@fixture/kit';
import { marker, identity } from '@fixture/conditional';
import { identity as again } from '@fixture/conditional';
if(identity !== again || identity === libraryIdentity) throw Error('Compiled dependency identity changed');
export default {name:[marker,libraryMarker,privateMarker].join(':'),processes:[{name:'worker',module:'./worker.ts'}]};
`);
    const expected = 'app-version:library-version:library-private';
    expect(plainRead(f.bootstrap, true).name).toBe(expected);
    const builder = new BuildService(true); builders.push(builder);
    const built = await builder.buildApp('relocated', f.bootstrap, plainRead(f.bootstrap, true));
    expect(plainRead(built.bootstrapPath, false).name).toBe(expected);
    const compiled = fs.readFileSync(built.bootstrapPath, 'utf8');
    expect(compiled).not.toContain(f.project);
    expect(compiled).not.toContain('library-version');
    // The dependency layout travels as a unit: there must be no reference to
    // the former absolute installation or a change in selected package version.
    const moved = f.project + '-moved #1%';
    fs.renameSync(f.project, moved);
    fs.unlinkSync(path.join(moved, 'node_modules/@fixture/kit'));
    fs.symlinkSync('../../packages/' + libraryDirectory, path.join(moved, 'node_modules/@fixture/kit'), 'dir');
    const relocate = (file: string) => path.join(moved, path.relative(f.project, file));
    expect(plainRead(relocate(built.bootstrapPath), false).name).toBe(expected);
    expect(plainRead(relocate(f.bootstrap), true).name).toBe(expected);
  }, 45_000);
});
