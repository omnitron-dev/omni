import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishConsole, stampConsole } from './console-publication.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dest = path.join(root, 'served');
  const build = name => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', `${name}-12345678.js`), `import('./lazy-${name}-12345678.js')`);
    fs.writeFileSync(path.join(dir, 'assets', `lazy-${name}-12345678.js`), `export default '${name}'`);
    fs.writeFileSync(path.join(dir, 'index.html'), `<head><script type="module" src="/assets/${name}-12345678.js"></script></head>`);
    stampConsole(dir); return dir;
  };
  return { root, dest, build };
}

test('publishes into the same mounted directory and preserves lazy chunks across updates', t => {
  const { dest, build } = fixture(t);
  publishConsole(build('first'), dest);
  const inode = fs.statSync(dest).ino;
  const next = publishConsole(build('next'), dest);
  assert.equal(fs.statSync(dest).ino, inode);
  assert.match(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), /next-12345678/);
  assert.equal(fs.readFileSync(path.join(dest, 'assets/lazy-first-12345678.js'), 'utf8'), "export default 'first'");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'console-version.json'))).version, next.version);
});

test('refuses an immutable URL collision before changing the live HTML', t => {
  const { dest, build } = fixture(t); const first = build('first'); publishConsole(first, dest);
  const before = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(first, 'assets/first-12345678.js'), 'changed without renaming');
  assert.throws(() => publishConsole(first, dest), /Immutable Console URL changed/);
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), before);
});

test('a failed HTML switch leaves the old page usable and publication can resume', t => {
  const { dest, build } = fixture(t);
  publishConsole(build('working'), dest);
  const next = build('next');
  const before = fs.readFileSync(path.join(dest, 'index.html'));
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === path.join(dest, 'index.html')) throw Object.assign(new Error('simulated I/O failure'), { code: 'EIO' });
    return rename(from, to);
  };
  try { assert.throws(() => publishConsole(next, dest), /simulated I\/O failure/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(path.join(dest, 'index.html')), before);
  assert.ok(fs.existsSync(path.join(dest, 'assets/lazy-working-12345678.js')));
  assert.equal(fs.existsSync(dest + '.publish-lock'), false);
  publishConsole(next, dest);
  assert.match(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), /next-12345678/);
  assert.ok(fs.existsSync(path.join(dest, 'assets/lazy-working-12345678.js')));
});

test('retains a grace period and the newest builds; prunes only owned, unchanged files', t => {
  const { dest, build } = fixture(t);
  for (const name of ['one', 'two', 'three']) publishConsole(build(name), dest, { now: 1000, keep: 2, graceMs: 5000 });
  assert.ok(fs.existsSync(path.join(dest, 'assets/one-12345678.js')));
  fs.writeFileSync(path.join(dest, 'assets/unmanaged.js'), 'keep');
  fs.writeFileSync(path.join(dest, 'assets/lazy-one-12345678.js'), 'externally changed');
  const result = publishConsole(build('four'), dest, { now: 7000, keep: 2, graceMs: 5000 });
  assert.equal(result.generations, 2);
  assert.equal(fs.existsSync(path.join(dest, 'assets/one-12345678.js')), false);
  assert.ok(fs.existsSync(path.join(dest, 'assets/three-12345678.js')));
  assert.ok(fs.existsSync(path.join(dest, 'assets/unmanaged.js')));
  assert.equal(fs.readFileSync(path.join(dest, 'assets/lazy-one-12345678.js'), 'utf8'), 'externally changed');
});

test('supports pre-ledger deployments and never steals a publication lock', t => {
  const { dest, build } = fixture(t);
  fs.cpSync(build('legacy'), dest, { recursive: true });
  const next = build('next');
  fs.mkdirSync(dest + '.publish-lock');
  assert.throws(() => publishConsole(next, dest), /locked/);
  fs.rmdirSync(dest + '.publish-lock');
  publishConsole(next, dest);
  assert.ok(fs.existsSync(path.join(dest, 'assets/lazy-legacy-12345678.js')));
});

test('refuses incomplete output and source symlinks while the live build remains usable', t => {
  const { dest, build } = fixture(t); publishConsole(build('working'), dest);
  const invalid = build('incomplete');
  fs.unlinkSync(path.join(invalid, 'assets/incomplete-12345678.js'));
  assert.throws(() => publishConsole(invalid, dest), /missing assets/);
  const linked = build('linked');
  fs.symlinkSync('/etc/passwd', path.join(linked, 'assets/extra.js'));
  assert.throws(() => publishConsole(linked, dest), /Not a regular file/);
  assert.match(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), /working-12345678/);
});
