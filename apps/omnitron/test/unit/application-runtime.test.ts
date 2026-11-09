import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationBootstrapRuntime } from '../../src/orchestrator/application-runtime.js';

let root: string;
let bootstrap: string;
let fallback: string;

function write(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function install(directory: string, name: string, entry = 'dist/index.js'): string {
  write(path.join(directory, 'package.json'), JSON.stringify({
    name: `@omnitron-dev/${name}`, version: '0.0.0', type: 'module', exports: `./${entry}`,
  }));
  // Runtime selection must only resolve files, never import application code.
  write(path.join(directory, entry), 'throw Error("Package entry was executed while selecting an adapter");');
  if (name === 'omnitron') {
    write(path.join(directory, path.dirname(entry), 'orchestrator/bootstrap-process.js'), 'export {};');
  }
  return directory;
}

function link(from: string, name: string, directory: string): void {
  const target = path.join(from, 'node_modules/@omnitron-dev', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.symlinkSync(directory, target, 'junction');
}

function graph(name: string) {
  const titan = install(path.join(root, name, 'titan'), 'titan');
  const adapter = install(path.join(root, name, 'omnitron'), 'omnitron');
  link(adapter, 'titan', titan);
  return { titan, adapter, entry: path.join(adapter, 'dist/orchestrator/bootstrap-process.js') };
}

function select(current: ReturnType<typeof graph>): void {
  const app = path.dirname(bootstrap);
  link(app, 'omnitron', current.adapter);
  link(app, 'titan', current.titan);
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-runtime #%-')));
  bootstrap = path.join(root, 'application/bootstrap.js');
  fallback = path.join(root, 'owner/bootstrap-process.js');
  write(bootstrap, 'export {};');
  write(fallback, 'export {};');
  // The source reader needs tsx, but synthetic installed packages must not
  // resolve through this repository's TypeScript workspace aliases.
  const tsconfig = path.join(root, 'tsconfig.json');
  write(tsconfig, '{"compilerOptions":{}}');
  vi.stubEnv('TSX_TSCONFIG_PATH', tsconfig);
  vi.stubEnv('NODE_PATH', '');
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe('current application runtime selection', () => {
  it('follows an installed SDK upgrade and rollback in the same resident owner', async () => {
    const first = graph('first');
    const second = graph('second');
    select(first);
    // A resident owner has already resolved this bootstrap's package tree.
    createRequire(bootstrap).resolve('@omnitron-dev/omnitron');
    createRequire(bootstrap).resolve('@omnitron-dev/titan');
    expect(await applicationBootstrapRuntime(bootstrap, fallback)).toBe(first.entry);
    select(second);
    expect(await applicationBootstrapRuntime(bootstrap, fallback)).toBe(second.entry);
    select(first);
    expect(await applicationBootstrapRuntime(bootstrap, fallback)).toBe(first.entry);
  });

  it('observes replaced exports at the same physical package directory', async () => {
    const current = graph('in-place');
    select(current);
    expect(await applicationBootstrapRuntime(bootstrap, fallback)).toBe(current.entry);
    install(current.adapter, 'omnitron', 'lib/index.js');
    expect(await applicationBootstrapRuntime(bootstrap, fallback))
      .toBe(path.join(current.adapter, 'lib/orchestrator/bootstrap-process.js'));
  });

  it('refuses different Titan identities after an incomplete dependency update', async () => {
    const first = graph('first');
    const second = graph('second');
    select(first);
    link(path.dirname(bootstrap), 'titan', second.titan);
    await expect(applicationBootstrapRuntime(bootstrap, fallback)).rejects.toThrow('different Titan instances');
  });

  it('allows the owner adapter only when an absent application adapter shares its Titan', async () => {
    const titan = install(path.join(root, 'shared-titan'), 'titan');
    link(path.dirname(bootstrap), 'titan', titan);
    link(path.dirname(fallback), 'titan', titan);
    expect(await applicationBootstrapRuntime(bootstrap, fallback)).toBe(fallback);
    const different = install(path.join(root, 'other-titan'), 'titan');
    link(path.dirname(bootstrap), 'titan', different);
    await expect(applicationBootstrapRuntime(bootstrap, fallback)).rejects.toThrow('different Titan runtime');
  });

  it('preserves plain bootstrap files in coupled mode and refuses incomplete SDK installations', async () => {
    await expect(applicationBootstrapRuntime(bootstrap, fallback, true)).resolves.toBe(fallback);
    await expect(applicationBootstrapRuntime(bootstrap, fallback)).rejects.toThrow('Titan runtime');
    write(path.join(path.dirname(bootstrap), 'package.json'), JSON.stringify({ dependencies: { '@omnitron-dev/titan': '^1' } }));
    await expect(applicationBootstrapRuntime(bootstrap, fallback, true)).rejects.toThrow('declares a missing');
    const current = graph('incomplete');
    select(current);
    fs.rmSync(current.titan, { recursive: true });
    await expect(applicationBootstrapRuntime(bootstrap, fallback, true)).rejects.toThrow('cannot be resolved');
  });

  it.each(['missing-entry', 'unexported-entry', 'dangling-link'])('does not replace a broken %s application adapter with the owner', async kind => {
    const current = graph('broken');
    select(current);
    link(path.dirname(fallback), 'titan', current.titan);
    if (kind === 'missing-entry') fs.rmSync(path.join(current.adapter, 'dist/index.js'));
    else if (kind === 'dangling-link') fs.rmSync(current.adapter, { recursive: true });
    else write(path.join(current.adapter, 'package.json'), JSON.stringify({ name: '@omnitron-dev/omnitron', exports: {} }));
    await expect(applicationBootstrapRuntime(bootstrap, fallback)).rejects.toThrow('cannot be resolved');
  });

  it('refuses an installed package without its compiled adapter', async () => {
    const current = graph('incomplete');
    select(current);
    fs.rmSync(current.entry);
    await expect(applicationBootstrapRuntime(bootstrap, fallback)).rejects.toThrow('no compiled bootstrap adapter');
  });

  it('uses the same upgrade and rollback path from compiled JavaScript under plain Node', async () => {
    const first = graph('first');
    const second = graph('second');
    select(first);
    const request = createRequire(import.meta.url);
    link(root, 'titan', path.resolve(path.dirname(request.resolve('@omnitron-dev/titan')), '..'));
    write(path.join(root, 'package.json'), '{"type":"module"}');
    const output = path.join(root, 'reader');
    const source = fileURLToPath(new URL('../../src/orchestrator/', import.meta.url));
    await (await import('esbuild')).build({
      entryPoints: ['application-runtime.ts', 'application-runtime-child.ts'].map(file => path.join(source, file)),
      outdir: output, platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'external',
    });
    const script = `import fs from 'node:fs'; import path from 'node:path'; import {createRequire} from 'node:module';
      import {applicationBootstrapRuntime} from ${JSON.stringify(pathToFileURL(path.join(output, 'application-runtime.js')).href)};
      const bootstrap=${JSON.stringify(bootstrap)}, fallback=${JSON.stringify(fallback)};
      createRequire(bootstrap).resolve('@omnitron-dev/omnitron');
      const result=[await applicationBootstrapRuntime(bootstrap,fallback)];
      for (const graph of ${JSON.stringify([second, first])}) {
        for (const [name,target] of [['omnitron',graph.adapter],['titan',graph.titan]]) {
          const link=path.join(path.dirname(bootstrap),'node_modules/@omnitron-dev',name);
          fs.unlinkSync(link);fs.symlinkSync(target,link,'junction');
        }
        result.push(await applicationBootstrapRuntime(bootstrap,fallback));
      }
      console.log(JSON.stringify(result));`;
    const env = { ...process.env };
    delete env['NODE_OPTIONS'];
    delete env['NODE_PATH'];
    delete env['TSX_TSCONFIG_PATH'];
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, env, encoding: 'utf8', timeout: 15_000,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([first.entry, second.entry, first.entry]);
  });
});
