import { afterEach, expect, it } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  rmSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  immutableAssetsRoot,
  immutableAssetsScript,
  type StaticAssetOwner,
  type StaticAssetSource,
  type StaticAssetReceipt,
} from '../../src/services/static-carry-forward.js';
const owner = { project: 'site', stack: 'production', app: 'api' };
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'immutable-assets-')));
  roots.push(root);
  return { root, store: join(root, 'store') };
}
function source(root: string, name: string, files: Record<string, string>): StaticAssetSource {
  const directory = join(root, name);
  mkdirSync(directory);
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), bytes);
  }
  return {
    root: directory,
    files: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, hash(bytes)])),
  };
}
function command(f: ReturnType<typeof fixture>, sources: StaticAssetSource[], identity: StaticAssetOwner = owner) {
  const request = join(f.root, 'request-' + Math.random() + '.json');
  writeFileSync(request, JSON.stringify({ owner: identity, sources }));
  return 'umask 077\n' + immutableAssetsScript(request, f.store);
}
function publish(
  f: ReturnType<typeof fixture>,
  sources: StaticAssetSource[],
  identity: StaticAssetOwner = owner
): StaticAssetReceipt {
  return JSON.parse(
    execFileSync('sh', ['-c', command(f, sources, identity)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  );
}
it('keeps three release generations, rollback and retries without touching original inodes', () => {
  const f = fixture(),
    sources = ['a', 'b', 'c'].map((name) =>
      source(f.root, name, { ['chunk-' + name + '.js']: 'export default ' + JSON.stringify(name) })
    );
  const originals = sources.map((s) => ({
    bytes: readFileSync(join(s.root, Object.keys(s.files)[0]!)),
    inode: statSync(join(s.root, Object.keys(s.files)[0]!)).ino,
  }));
  publish(f, [sources[0]!]);
  publish(f, [sources[1]!]);
  const complete = publish(f, [sources[2]!]);
  expect(complete.files).toBe(3);
  expect(statSync(complete.assetsRoot).mode & 0o777).toBe(0o755);
  expect(complete.added).toBe(1);
  const rollback = publish(f, [sources[0]!]);
  expect(rollback).toMatchObject({ files: 3, added: 0, reused: 1, manifestSha256: complete.manifestSha256 });
  expect(publish(f, sources)).toMatchObject({ files: 3, added: 0, reused: 3, manifestSha256: complete.manifestSha256 });
  sources.forEach((s, index) => {
    const name = Object.keys(s.files)[0]!;
    expect(readFileSync(join(s.root, name))).toEqual(originals[index]!.bytes);
    expect(statSync(join(s.root, name)).ino).toBe(originals[index]!.inode);
    expect(statSync(join(complete.assetsRoot, name)).ino).not.toBe(originals[index]!.inode);
    expect(statSync(join(complete.assetsRoot, name)).mode & 0o777).toBe(0o444);
    expect(readFileSync(join(complete.assetsRoot, name))).toEqual(originals[index]!.bytes);
  });
  expect(readdirSync(complete.assetsRoot).sort()).toEqual(['chunk-a.js', 'chunk-b.js', 'chunk-c.js']);
});
it('refuses a changed URL before adding any other new asset or changing the receipt', () => {
  const f = fixture(),
    old = source(f.root, 'old', { 'same.js': 'old' }),
    initial = publish(f, [old]);
  const next = source(f.root, 'next', { 'a-new.js': 'new', 'same.js': 'changed' });
  expect(() => publish(f, [next])).toThrow(/URL collision/);
  expect(readdirSync(initial.assetsRoot)).toEqual(['same.js']);
  expect(publish(f, [old]).manifestSha256).toBe(initial.manifestSha256);
  expect(readFileSync(join(initial.assetsRoot, 'same.js'), 'utf8')).toBe('old');
});
it.each(['missing', 'extra', 'digest', 'symlink', 'parent-symlink', 'traversal'])(
  'fails closed for %s source evidence',
  (fault) => {
    const f = fixture(),
      old = source(f.root, 'old', { 'old.js': 'old' }),
      initial = publish(f, [old]);
    const next = source(f.root, 'next', { 'next.js': 'next' });
    if (fault === 'missing') rmSync(join(next.root, 'next.js'));
    if (fault === 'extra') writeFileSync(join(next.root, 'unlisted.js'), 'unlisted');
    if (fault === 'digest') writeFileSync(join(next.root, 'next.js'), 'tampered');
    if (fault === 'symlink') {
      rmSync(join(next.root, 'next.js'));
      symlinkSync(join(old.root, 'old.js'), join(next.root, 'next.js'));
    }
    if (fault === 'parent-symlink') {
      symlinkSync(next.root, join(f.root, 'alias'));
      next.root = join(f.root, 'alias');
    }
    if (fault === 'traversal') next.files['../old/old.js'] = hash('old');
    expect(() => publish(f, [next])).toThrow();
    expect(readdirSync(initial.assetsRoot)).toEqual(['old.js']);
    expect(publish(f, [old]).manifestSha256).toBe(initial.manifestSha256);
  }
);
it('does not expose another owner or accept an aliased pool ancestor', () => {
  const f = fixture(),
    a = source(f.root, 'a', { 'same.js': 'owner-a' }),
    b = source(f.root, 'b', { 'same.js': 'owner-b' });
  const first = publish(f, [a]),
    second = publish(f, [b], { ...owner, project: 'other' });
  expect(first.assetsRoot).not.toBe(second.assetsRoot);
  expect(readFileSync(join(first.assetsRoot, 'same.js'), 'utf8')).toBe('owner-a');
  expect(readFileSync(join(second.assetsRoot, 'same.js'), 'utf8')).toBe('owner-b');
  const bad = fixture();
  mkdirSync(join(bad.root, 'elsewhere'));
  symlinkSync(join(bad.root, 'elsewhere'), bad.store);
  expect(() => publish(bad, [a])).toThrow(/symlink/);
  expect(readdirSync(join(bad.root, 'elsewhere'))).toEqual([]);
  expect(() => immutableAssetsRoot({ ...owner, project: '../other' })).toThrow();
});
it('recovers the original interrupted batch before admitting a different next release', () => {
  const f = fixture(),
    old = source(f.root, 'old', { 'old.js': 'old' }),
    initial = publish(f, [old]);
  const next = source(f.root, 'next', { 'a.js': 'a', 'b.js': 'b' });
  // Kill the real native program immediately after its first atomic public rename.
  const hook = join(f.root, 'interrupt.cjs');
  writeFileSync(
    hook,
    `const fs=require('node:fs'),rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(b.endsWith('/public/a.js'))process.exit(73)};`
  );
  expect(() =>
    execFileSync('sh', ['-c', command(f, [next])], {
      env: { ...process.env, NODE_OPTIONS: '--require=' + hook },
      stdio: 'pipe',
    })
  ).toThrow();
  expect(readFileSync(join(initial.assetsRoot, 'a.js'), 'utf8')).toBe('a');
  expect(existsSync(join(initial.assetsRoot, 'b.js'))).toBe(false);
  const future = source(f.root, 'future', { 'c.js': 'c' });
  writeFileSync(join(next.root, 'b.js'), 'tampered');
  expect(() => publish(f, [future])).toThrow(/source digest differs/);
  expect(existsSync(join(initial.assetsRoot, 'c.js'))).toBe(false);
  writeFileSync(join(next.root, 'b.js'), 'b');
  const resumed = publish(f, [future]);
  expect(resumed).toMatchObject({ added: 1, reused: 0, files: 4 });
  expect(readFileSync(join(initial.assetsRoot, 'b.js'), 'utf8')).toBe('b');
  expect(publish(f, [next])).toMatchObject({ added: 0, reused: 2, manifestSha256: resumed.manifestSha256 });
  expect(existsSync(join(dirname(initial.assetsRoot), 'pending.json'))).toBe(false);
});
it('refuses tampered retained assets instead of blessing them during a retry', () => {
  const f = fixture(),
    a = source(f.root, 'a', { 'same.js': 'valid' }),
    first = publish(f, [a]);
  chmodSync(join(first.assetsRoot, 'same.js'), 0o644);
  writeFileSync(join(first.assetsRoot, 'same.js'), 'tampered');
  expect(() => publish(f, [a])).toThrow(/retained asset integrity/);
});
it('executes the old HTTP ESM lazy graph after three releases and rollback; the release-only server is red', async () => {
  const f = fixture();
  const builds = ['A', 'B', 'C'].map((name) =>
    source(f.root, name, {
      ['entry-' + name + '.js']: `export const load=()=>import('./lazy-${name}.js');`,
      ['lazy-' + name + '.js']: `import {value} from './shared-${name}.js';export const result=value+' lazy';`,
      ['shared-' + name + '.js']: `export const value=${JSON.stringify(name)};`,
    })
  );
  let serving = builds[0]!.root;
  const server = createServer((request, response) => {
    const name = new URL(request.url!, 'http://local').pathname.slice('/assets/'.length);
    try {
      const bytes = readFileSync(join(serving, name));
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(bytes);
    } catch {
      response.writeHead(404, { 'cache-control': 'no-store' });
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port,
    entryUrl = `http://127.0.0.1:${port}/assets/entry-A.js`;
  try {
    const loadedBeforeDeployment = await (await fetch(entryUrl)).text();
    const browser = `const vm=require('node:vm');const cache=new Map();async function load(url,source){if(cache.has(url))return cache.get(url);if(source===undefined){const r=await fetch(url);if(!r.ok||!r.headers.get('content-type').includes('javascript'))throw Error('Module HTTP '+r.status);source=await r.text();}const m=new vm.SourceTextModule(source,{identifier:url,importModuleDynamically:async(s,ref)=>{const child=await load(new URL(s,ref.identifier).href);if(child.status==='linked')await child.evaluate();return child;}});cache.set(url,m);await m.link((s,ref)=>load(new URL(s,ref.identifier).href));return m;}load(process.argv[1],process.argv[2]).then(async(m)=>{await m.evaluate();console.log((await m.namespace.load()).result)}).catch(e=>{console.error(e.message);process.exitCode=1});`;
    const execute = () =>
      promisify(execFile)(process.execPath, [
        '--experimental-vm-modules',
        '-e',
        browser,
        entryUrl,
        loadedBeforeDeployment,
      ]);
    serving = builds[2]!.root;
    await expect(execute()).rejects.toThrow(/Module HTTP 404/);
    for (const build of builds) serving = publish(f, [build]).assetsRoot;
    expect((await execute()).stdout.trim()).toBe('A lazy');
    serving = publish(f, [builds[0]!]).assetsRoot;
    expect((await execute()).stdout.trim()).toBe('A lazy');
    expect(await (await fetch(`http://127.0.0.1:${port}/assets/shared-C.js`)).text()).toBe('export const value="C";');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

it('does not overwrite a destination introduced after preflight', () => {
  const f = fixture(),
    old = source(f.root, 'old', { 'old.js': 'old' }),
    initial = publish(f, [old]);
  const next = source(f.root, 'next', { 'new.js': 'new' });
  const hook = join(f.root, 'race.cjs');
  writeFileSync(
    hook,
    `const fs=require('node:fs'),path=require('node:path'),rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(b.endsWith('/pending.json'))fs.writeFileSync(path.join(path.dirname(b),'public/new.js'),'foreign',{flag:'wx'});};`
  );
  expect(() =>
    execFileSync('sh', ['-c', command(f, [next])], {
      env: { ...process.env, NODE_OPTIONS: '--require=' + hook },
      stdio: 'pipe',
    })
  ).toThrow(/destination appeared/);
  expect(readFileSync(join(initial.assetsRoot, 'new.js'), 'utf8')).toBe('foreign');
  expect(readFileSync(join(initial.assetsRoot, 'old.js'), 'utf8')).toBe('old');
});

it('revalidates the completed pool after its publication acknowledgement is lost', () => {
  const f = fixture(),
    next = source(f.root, 'next', { 'a.js': 'a', 'b.js': 'b' });
  const hook = join(f.root, 'lost-ack.cjs');
  writeFileSync(
    hook,
    `const fs=require('node:fs'),rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(b.endsWith('/manifest.json'))process.exit(74)};`
  );
  expect(() =>
    execFileSync('sh', ['-c', command(f, [next])], {
      env: { ...process.env, NODE_OPTIONS: '--require=' + hook },
      stdio: 'pipe',
    })
  ).toThrow();
  rmSync(next.root, { recursive: true });
  const future = source(f.root, 'future', { 'c.js': 'c' });
  expect(publish(f, [future])).toMatchObject({ files: 3, added: 1, reused: 0 });
});
