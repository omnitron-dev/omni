import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { installSteps, installPreflightCommand, versionDir } from '../../src/services/bundle-builder.js';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';

const roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'immutable-bundle-'))); roots.push(root);
  const source = path.join(root, 'source'), bin = path.join(root, 'bin'), prefix = path.join(root, 'host');
  const version = '0.3.0+local.abcdef.202610251600';
  fs.mkdirSync(path.join(source, 'dist/cli'), { recursive: true }); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'fixture', version }));
  fs.writeFileSync(path.join(source, 'BUNDLE.json'), JSON.stringify({ version, commit: 'a'.repeat(40) }));
  fs.writeFileSync(path.join(source, 'dist/cli/omnitron.js'), '#!/bin/sh\nprintf "%s\\n" "'+version+'"\n'.replaceAll('\\n', '\n'));
  // A real child process mutates only its staged dependency tree; no network.
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nprintf x >> "$INSTALL_COUNTER"\nprintf "%s" "$1" > "$INSTALL_COUNTER.mode"\nmkdir -p node_modules\nprintf dependency > node_modules/value\nif [ "$ALTER_LOCK" = yes ]; then printf changed > package-lock.json; fi\nif [ "$ABSOLUTE_LINK" = yes ]; then ln -s "$PWD/node_modules/value" node_modules/absolute; fi\nif [ "$FAIL_INSTALL" = yes ]; then exit 17; fi\n'.replaceAll('\\n', '\n'), { mode: 0o755 });
  const archive = path.join(root, 'bundle.tgz');
  const pack = () => execFileSync('tar', ['-czf', archive, '-C', source, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  pack();
  const layout = { prefix, version }, dir = versionDir(layout), counter = path.join(root, 'installs');
  const run = (env = {}) => {
    const hash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    return execFileSync('sh', ['-c', installSteps(layout, archive, hash)[0]!.command], {
      env: { ...process.env, PATH: bin+':'+process.env.PATH, INSTALL_COUNTER: counter, ...env },
      encoding: 'utf8', timeout: 15000, stdio: ['ignore','pipe','pipe'],
    });
  };
  return { root, source, archive, prefix, layout, dir, counter, pack, run };
}
describe('immutable native bundle installation', () => {
  it('installs a prepared dependency lock with ci and preserves it in the installed receipt', () => {
    const f = fixture();
    const lock = JSON.stringify({ name: 'fixture', version: f.layout.version, lockfileVersion: 3, packages: {} });
    fs.writeFileSync(path.join(f.source, 'package-lock.json'), lock); f.pack();
    f.run();
    expect(fs.readFileSync(f.counter + '.mode', 'utf8')).toBe('ci');
    expect(fs.readFileSync(path.join(f.dir, 'package-lock.json'), 'utf8')).toBe(lock);
    const receipt = JSON.parse(fs.readFileSync(path.join(f.dir, '.omnitron-install.json'), 'utf8'));
    expect(receipt.entries['package-lock.json'].sha256).toBe(createHash('sha256').update(lock).digest('hex'));
  });
  it('refuses a modified lock before publishing the candidate or changing the serving version', () => {
    const f = fixture(), old = path.join(f.prefix, 'versions', '0.2.0');
    fs.mkdirSync(old, { recursive: true }); fs.symlinkSync(old, path.join(f.prefix, 'current'));
    fs.writeFileSync(path.join(f.source, 'package-lock.json'), '{}'); f.pack();
    expect(() => f.run({ ALTER_LOCK: 'yes' })).toThrow(/Dependency lock changed/);
    expect(fs.existsSync(f.dir)).toBe(false);
    expect(fs.realpathSync(path.join(f.prefix, 'current'))).toBe(old);
  });
  it('publishes only a completely installed sibling and reuses it without reinstalling the current version', () => {
    const f = fixture(); expect(f.run().trim()).toBe(f.layout.version);
    fs.symlinkSync(f.dir, path.join(f.prefix, 'current'));
    const before = fs.statSync(f.dir).ino;
    expect(f.run().trim()).toBe(f.layout.version);
    expect(fs.statSync(f.dir).ino).toBe(before);
    expect(fs.readFileSync(f.counter, 'utf8')).toBe('x');
    expect(fs.readFileSync(f.counter + '.mode', 'utf8')).toBe('install');
    expect(fs.realpathSync(path.join(f.prefix, 'current'))).toBe(f.dir);
    const receipt=JSON.parse(fs.readFileSync(path.join(f.dir,'.omnitron-install.json'),'utf8'));
    expect(receipt.entries['node_modules/value'].sha256).toBe(createHash('sha256').update('dependency').digest('hex'));
  });
  it('leaves a failed install unpublished and retries in a different sibling', () => {
    const f=fixture();expect(()=>f.run({FAIL_INSTALL:'yes'})).toThrow();
    expect(fs.existsSync(f.dir)).toBe(false);
    const failed=fs.readdirSync(path.join(f.prefix,'versions'));expect(failed).toHaveLength(1);
    expect(f.run().trim()).toBe(f.layout.version);
    expect(fs.existsSync(path.join(f.prefix,'versions',failed[0]!))).toBe(true);
    expect(fs.readFileSync(f.counter,'utf8')).toBe('xx');
  });
  it('refuses an absolute dependency symlink that would break after sibling promotion', () => {
    const f = fixture();
    expect(() => f.run({ ABSOLUTE_LINK: 'yes' })).toThrow(/symlink must remain relative/);
    expect(fs.existsSync(f.dir)).toBe(false);
    const stage = fs.readdirSync(path.join(f.prefix, 'versions'))[0]!;
    expect(fs.lstatSync(path.join(f.prefix, 'versions', stage, 'node_modules/absolute')).isSymbolicLink()).toBe(true);
  });
  it('leaves the serving version intact if the new CLI does not match its manifest', () => {
    const f = fixture(), old = path.join(f.prefix, 'versions', '0.2.0');
    fs.mkdirSync(old, { recursive: true }); fs.writeFileSync(path.join(old, 'keep'), 'serving bytes');
    fs.symlinkSync(old, path.join(f.prefix, 'current'));
    fs.writeFileSync(path.join(f.source, 'dist/cli/omnitron.js'), '#!/bin/sh\necho 0.0.0\n'); f.pack();
    expect(() => f.run()).toThrow(/CLI version mismatch/);
    expect(fs.existsSync(f.dir)).toBe(false);
    expect(fs.realpathSync(path.join(f.prefix, 'current'))).toBe(old);
    expect(fs.readFileSync(path.join(old, 'keep'), 'utf8')).toBe('serving bytes');
  });
  it('refuses a different archive under an existing version without modifying current bytes', () => {
    const f=fixture();f.run();fs.symlinkSync(f.dir,path.join(f.prefix,'current'));
    fs.writeFileSync(path.join(f.source,'extra'),'changed');f.pack();
    expect(()=>f.run()).toThrow(/identity conflicts/);
    expect(fs.existsSync(path.join(f.dir,'extra'))).toBe(false);
    expect(fs.readFileSync(f.counter,'utf8')).toBe('x');
  });
  it('refuses a corrupted physical dependency instead of repairing a version in place', () => {
    const f=fixture();f.run();fs.writeFileSync(path.join(f.dir,'node_modules/value'),'corrupt');
    expect(()=>f.run()).toThrow(/content differs/);
    expect(fs.readFileSync(path.join(f.dir,'node_modules/value'),'utf8')).toBe('corrupt');
    expect(fs.readFileSync(f.counter,'utf8')).toBe('x');
  });
  it.each(['directory','dangling-link','alias'])('refuses an existing %s without touching it', kind => {
    const f=fixture();fs.mkdirSync(path.dirname(f.dir),{recursive:true});
    if(kind==='directory')fs.mkdirSync(f.dir);
    else fs.symlinkSync(kind==='alias'?f.source:path.join(f.root,'missing'),f.dir);
    expect(()=>f.run()).toThrow();expect(fs.lstatSync(f.dir)).toBeTruthy();
    expect(fs.existsSync(f.counter)).toBe(false);
  });
  it('refuses an aliased parent before making installation directories', () => {
    const f=fixture(), alias=path.join(f.root,'alias');fs.symlinkSync(f.source,alias);
    expect(()=>execFileSync('sh',['-c',installPreflightCommand({prefix:alias+'/host',version:f.layout.version})],{stdio:'pipe'})).toThrow(/Noncanonical/);
    expect(fs.existsSync(path.join(f.source,'host'))).toBe(false);
  });
  it('refuses archive links before extraction or dependency install', () => {
    const f=fixture();fs.symlinkSync('/etc/passwd',path.join(f.source,'escape'));f.pack();
    expect(()=>f.run()).toThrow(/regular files and directories/);expect(fs.existsSync(f.counter)).toBe(false);
  });
  it.each(['../escape','..','/tmp/escape','0.3.0/../x','0.3.0+foo..bar',"0.3.0+foo'bar"])(
    'refuses version %s before remote operations', async version => {
      const execution={ssh:vi.fn(),uploadFile:vi.fn()};
      const deployer=new RemoteDeployer({info:vi.fn(),error:vi.fn()} as any,execution as any);
      expect(await deployer.installBundle({host:'test.invalid'},'/not-read',version)).toBe(false);
      expect(execution.ssh).not.toHaveBeenCalled();expect(execution.uploadFile).not.toHaveBeenCalled();
    });
});
