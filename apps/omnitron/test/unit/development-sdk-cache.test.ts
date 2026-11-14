import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { inspectSdk, watchSdk, type DevelopmentSdkProfile } from '../../bin/sdk.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const turbo = path.join(path.dirname(require.resolve('turbo/package.json')), 'bin/turbo');

it('invalidates real Turbo tasks when linked SDK declarations change, even inside gitignored state', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-cache-')));
  const source = path.join(root, 'sdk'), consumer = path.join(root, 'consumer');
  const pkg = path.join(source, 'packages/probe'), state = path.join(consumer, '.omnitron/dev-sdk');
  const controller = new AbortController();
  let watcher: Promise<void> | undefined;
  let watchFailure: unknown;
  const until = async (read: () => Promise<string | undefined>) => {
    const end = Date.now() + 45_000;
    while (Date.now() < end) {
      if (watchFailure) throw watchFailure;
      const value = await read();
      if (value) return value;
      await delay(50);
    }
    throw Error('SDK did not publish a successful build checkpoint');
  };
  const checkpoint = async () => {
    try { return JSON.parse(await fs.readFile(path.join(state, 'built.json'), 'utf8')).hashes['@omnitron-dev/probe']; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  try {
    for (const directory of [source, consumer]) {
      await fs.mkdir(directory, { recursive: true });
      await exec('git', ['init', '--quiet', directory]);
      await fs.writeFile(path.join(directory, '.gitignore'), 'node_modules/\n.omnitron/\n.turbo/\ndist/\n');
      await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({
        name: path.basename(directory), private: true, packageManager: 'pnpm@12.16.1', scripts: { build: 'node --version' },
      }));
      await fs.writeFile(path.join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
      await fs.writeFile(path.join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\nimporters:\n  .: {}\n  packages/probe: {}\n  packages/other: {}\n');
      await fs.writeFile(path.join(directory, 'turbo.json'), JSON.stringify({
        globalDependencies: ['.omnitron/dev-sdk/*.json'], tasks: { build: { outputs: ['dist/**'] }, '//#build': {} },
      }));
      await fs.mkdir(path.join(directory, 'node_modules/.bin'), { recursive: true });
      await fs.symlink(turbo, path.join(directory, 'node_modules/.bin/turbo'));
    }
    await fs.mkdir(path.join(pkg, 'src'), { recursive: true });
    await fs.mkdir(state, { recursive: true });
    await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({
      name: '@omnitron-dev/probe', version: '1.0.0', type: 'module', scripts: { build: 'node build.js' },
    }));
    await fs.writeFile(path.join(pkg, 'build.js'), `import fs from 'node:fs/promises';
await fs.mkdir('dist',{recursive:true});
await fs.copyFile('src/index.ts','dist/index.d.ts');
await fs.writeFile('dist/index.js','export const value=1;\\n');\n`);
    await fs.writeFile(path.join(pkg, 'src/index.ts'), 'export declare const value: number;\n');
    const other = path.join(source, 'packages/other');
    await fs.cp(pkg, other, { recursive: true });
    const manifest = JSON.parse(await fs.readFile(path.join(other, 'package.json'), 'utf8'));
    await fs.writeFile(path.join(other, 'package.json'), JSON.stringify({ ...manifest, name: '@omnitron-dev/other' }));
    const profile: DevelopmentSdkProfile = { schema: 1, root: consumer, source,
      links: { '@omnitron-dev/probe': pkg, '@omnitron-dev/other': other } };
    await fs.writeFile(path.join(state, 'active.json'), JSON.stringify(profile));
    await fs.writeFile(path.join(state, 'install.json'), JSON.stringify(profile));
    const taskHash = async () => {
      const { stdout } = await exec(process.execPath, [turbo, 'run', '//#build', '--dry=json'], { cwd: consumer });
      const value = JSON.parse(stdout).tasks[0].hash;
      expect(value).toMatch(/^[a-f0-9]+$/);
      return value;
    };
    const before = await taskHash();
    watcher = watchSdk(profile, undefined, controller.signal).catch((error: unknown) => { watchFailure = error; });
    const first = await until(checkpoint);
    const initial = JSON.parse(await fs.readFile(path.join(state, 'built.json'), 'utf8'));
    const afterFirst = await taskHash();
    expect(afterFirst).not.toBe(before);
    const javascript = await fs.readFile(path.join(pkg, 'dist/index.js'), 'utf8');
    await fs.writeFile(path.join(pkg, 'src/index.ts'), 'export declare const value: 1;\n');
    await until(async () => { const next = await checkpoint(); return next !== first ? next : undefined; });
    expect(await fs.readFile(path.join(pkg, 'dist/index.js'), 'utf8')).toBe(javascript);
    expect(await taskHash()).not.toBe(afterFirst);
    controller.abort(); await watcher;
    const updated = JSON.parse(await fs.readFile(path.join(state, 'built.json'), 'utf8'));
    expect(updated.inputs['@omnitron-dev/other']).toEqual(initial.inputs['@omnitron-dev/other']);
    expect(updated.inputs['@omnitron-dev/probe']).not.toEqual(initial.inputs['@omnitron-dev/probe']);
    expect((await inspectSdk(consumer)).build).toEqual({ status: 'current',
      packages: ['@omnitron-dev/other', '@omnitron-dev/probe'] });
  } finally {
    controller.abort();
    await watcher;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 90_000);
