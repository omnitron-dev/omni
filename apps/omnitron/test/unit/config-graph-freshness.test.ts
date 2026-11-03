import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEcosystemConfigFile } from '../../src/config/loader.js';

let root: string;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-config-graph #%-'))); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const write = (name: string, value: string) => { const file = path.join(root, name); fs.writeFileSync(file, value); return file; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('fresh ecosystem module graphs', () => {
  it.each(['mjs', 'ts', 'cjs'])('re-evaluates transitive %s imports and new exports without changing the root file', async extension => {
    const esm = extension !== 'cjs';
    const selected = write('selected.' + extension, esm ? "export const selection = 'first';" : "exports.selection = 'first';");
    const intermediate = write('intermediate.' + extension, esm ? `export { selection } from './selected.${extension}';`
      : `module.exports = require('./selected.${extension}');`);
    const file = write('omnitron.config.' + extension, esm ? `import { selection } from './intermediate.${extension}'; export default { apps:[{name:selection,script:'app.js'}] };`
      : `module.exports = { apps:[{name:require('./intermediate.${extension}').selection,script:'app.js'}] };`);
    expect((await loadEcosystemConfigFile(file)).apps[0]?.name).toBe('first');
    fs.writeFileSync(selected, esm ? "export const next = 'second';" : "exports.next = 'second';");
    fs.writeFileSync(intermediate, esm ? `export { next as selection } from './selected.${extension}';`
      : `exports.selection = require('./selected.${extension}').next;`);
    expect((await loadEcosystemConfigFile(file)).apps[0]?.name).toBe('second');
  });
  it('preserves native URLs, createRequire, phase, cwd and the current invoking environment', async () => {
    write('selected.cjs', "module.exports = 'from-cjs';");
    const file = write('omnitron.config.mjs', `import {createRequire} from 'node:module';
      const selection=createRequire(import.meta.url)('./selected.cjs');
      export default async ({phase}) => ({apps:[{name:phase,script:'app.js',env:{selection,url:import.meta.url,cwd:process.cwd(),value:process.env.OMNI_CONFIG_TEST_VALUE}}]});`);
    const previous = process.env['OMNI_CONFIG_TEST_VALUE'];
    try {
      process.env['OMNI_CONFIG_TEST_VALUE'] = 'one';
      const one = (await loadEcosystemConfigFile(file, 'release')).apps[0]!;
      expect(one).toMatchObject({ name: 'release', cwd: root, env: { selection: 'from-cjs', url: pathToFileURL(file).href, cwd: process.cwd(), value: 'one' } });
      process.env['OMNI_CONFIG_TEST_VALUE'] = 'two';
      expect((await loadEcosystemConfigFile(file)).apps[0]).toMatchObject({ name: 'runtime', env: { value: 'two' } });
    } finally { if (previous === undefined) delete process.env['OMNI_CONFIG_TEST_VALUE']; else process.env['OMNI_CONFIG_TEST_VALUE'] = previous; }
  });
  it('preserves optional undefined and own __proto__ data without serialization coercion', async () => {
    const file = write('omnitron.config.mjs', "export default {apps:[{name:'api',script:'app.js',cwd:undefined}],extras:{['__proto__']:'value',optional:undefined}};");
    const config = await loadEcosystemConfigFile(file) as unknown as { extras: Record<string, unknown> };
    expect(Object.hasOwn(config.extras, '__proto__')).toBe(true);
    expect(config.extras['__proto__']).toBe('value');
    expect(Object.hasOwn(config.extras, 'optional')).toBe(true);
  });
  it('retains the named-export configuration form', async () => {
    const file = write('omnitron.config.mjs', "export const apps=[{name:'api',script:'app.js'}];");
    expect((await loadEcosystemConfigFile(file)).apps[0]?.name).toBe('api');
  });
  it.each([
    ['function', '() => 1'], ['instance', 'new Date()'], ['number', 'Infinity'], ['symbol', 'Symbol()'], ['bigint', '1n'],
  ])('refuses a lossy %s instead of silently changing the configuration', async (_name, value) => {
    const file = write('omnitron.config.mjs', `export default {apps:[],extra:${value}};`);
    await expect(loadEcosystemConfigFile(file)).rejects.toThrow(/Ecosystem config.extra/);
  });
  it('refuses cycles and getters without invoking their serializer side effects', async () => {
    const marker = path.join(root, 'getter-called');
    const file = write('omnitron.config.mjs', `import fs from 'node:fs'; export default {apps:[],get extra(){fs.writeFileSync(${JSON.stringify(marker)},'bad');return 1}};`);
    await expect(loadEcosystemConfigFile(file)).rejects.toThrow('cannot be an accessor');
    expect(fs.existsSync(marker)).toBe(false);
    fs.writeFileSync(file, 'const config={apps:[]};config.self=config;export default config;');
    await expect(loadEcosystemConfigFile(file)).rejects.toThrow('contains a cycle');
  });
  it('returns only after the reader exits even if configuration code left a timer', async () => {
    const file = write('omnitron.config.mjs', "setInterval(()=>{},1000);export default {apps:[],readerPid:process.pid};");
    const config = await loadEcosystemConfigFile(file) as unknown as { readerPid: number };
    expect(config.readerPid).not.toBe(process.pid);
    expect(alive(config.readerPid)).toBe(false);
  });
  it('kills and reaps a timed-out reader without retaining its graph or leaking credential output', async () => {
    const pid = path.join(root, 'pid');
    const file = write('omnitron.config.mjs', `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pid)},String(process.pid));
      console.error('postgres://user:super-secret@localhost/api');setInterval(()=>{},1000);await new Promise(()=>{});`);
    const failure = await loadEcosystemConfigFile(file, 'runtime', { timeoutMs: 1500 }).catch(error => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('did not answer within 1.5 s and was killed');
    expect((failure as Error).message).not.toContain('super-secret');
    expect(alive(Number(fs.readFileSync(pid, 'utf8')))).toBe(false);
    fs.writeFileSync(file, 'export default {apps:[]};');
    expect((await loadEcosystemConfigFile(file)).apps).toEqual([]);
  });
  it('bounds noisy configuration output and redacts thrown errors', async () => {
    const file = write('omnitron.config.mjs', "process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000);await new Promise(()=>{});");
    await expect(loadEcosystemConfigFile(file, 'runtime', { timeoutMs: 5000 })).rejects.toThrow('output budget');
    fs.writeFileSync(file, "throw Error('token=private-value');");
    const error = await loadEcosystemConfigFile(file).catch(error => error as Error);
    expect((error as Error).message).toContain('token=***');
    expect((error as Error).cause).not.toHaveProperty('stack', expect.stringContaining('private-value'));
  });
  it('refuses oversized results without retaining a child', async () => {
    const pid = path.join(root, 'result-pid');
    const file = write('omnitron.config.mjs', `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pid)},String(process.pid));
      export default {apps:[],extra:'x'.repeat(17*1024*1024)};`);
    await expect(loadEcosystemConfigFile(file)).rejects.toThrow('16 MiB result budget');
    expect(alive(Number(fs.readFileSync(pid, 'utf8')))).toBe(false);
  });
  it('terminates its pending reader when the invoking parent disappears', async () => {
    const pid = path.join(root, 'orphan-pid');
    const file = write('omnitron.config.mjs', `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pid)},String(process.pid));
      setInterval(()=>{},1000);await new Promise(()=>{});`);
    const require = createRequire(import.meta.url);
    const loader = new URL('../../src/config/loader.ts', import.meta.url).href;
    const parent = spawn(process.execPath, ['--import', pathToFileURL(require.resolve('tsx/esm')).href, '--input-type=module', '-e',
      `const {loadEcosystemConfigFile}=await import(${JSON.stringify(loader)});await loadEcosystemConfigFile(${JSON.stringify(file)});`], { stdio: 'ignore' });
    const exited = new Promise<void>(resolve => parent.once('exit', () => resolve()));
    try {
      for (let count = 0; !fs.existsSync(pid) && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 25));
      expect(fs.existsSync(pid)).toBe(true);
      const reader = Number(fs.readFileSync(pid, 'utf8'));
      parent.kill('SIGTERM'); await exited;
      for (let count = 0; alive(reader) && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 25));
      expect(alive(reader)).toBe(false);
    } finally { if (parent.exitCode === null && parent.signalCode === null) { parent.kill('SIGKILL'); await exited; } }
  });
  it('uses the same fresh child from compiled JavaScript under plain Node', async () => {
    const require = createRequire(import.meta.url);
    const source = path.dirname(fileURLToPath(new URL('../../src/config/loader.ts', import.meta.url)));
    const runtime = path.join(root, 'native');
    fs.mkdirSync(path.join(root, 'node_modules/@omnitron-dev'), { recursive: true });
    fs.symlinkSync(path.resolve(path.dirname(require.resolve('@omnitron-dev/titan')), '..'), path.join(root, 'node_modules/@omnitron-dev/titan'));
    fs.symlinkSync(path.dirname(require.resolve('tsx/package.json')), path.join(root, 'node_modules/tsx'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    await (await import('esbuild')).build({ entryPoints: ['loader.ts', 'loader-child.ts'].map(file => path.join(source, file)),
      outdir: runtime, platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'external' });
    const selected = write('native-selected.ts', "export const selected: string = 'first';");
    const file = write('omnitron.config.ts', "import {selected} from './native-selected.ts';export default {apps:[{name:selected,script:'app.js'}]};");
    const env = { ...process.env }; delete env['NODE_OPTIONS'];
    const script = `import fs from 'node:fs';const {loadEcosystemConfigFile}=await import(${JSON.stringify(pathToFileURL(path.join(runtime, 'loader.js')).href)});
      const first=(await loadEcosystemConfigFile(${JSON.stringify(file)})).apps[0].name;
      fs.writeFileSync(${JSON.stringify(selected)},"export const selected: string = 'second';");
      console.log(JSON.stringify([first,(await loadEcosystemConfigFile(${JSON.stringify(file)})).apps[0].name]));`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env, encoding: 'utf8', timeout: 15000 });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(['first', 'second']);
  });
});
