import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFixtureUnitFiles, assertFixtureUnitFilesOwned, removeFixtureUnitFiles,
  authorizeFixtureUnitWrite, authorizeFixtureGuardianReplacement } from './fixture-unit-files.mjs';
import { reserveDaemonPorts } from './fixture-ports.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-unit-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return ['owner', 'backend'].map(mode => ({ mode, file: path.join(root, mode + '.service'),
    job: 'fixture-' + mode, contents: '[Unit]\nDescription=synthetic fixture\n' }));
}

test('second unit verification failure leaves both owned files available for cleanup before native launch', async t => {
  const definitions = await fixture(t), owned = [];
  let verifications = 0, launches = 0, closed = 0;
  const held = new Set();
  const reservation = await reserveDaemonPorts(0, { httpPort: 45501, ports: [] }, () => {
    let bound;
    return { once() {}, listen(port, _host, ready) { bound = port; held.add(port); queueMicrotask(ready); },
      address() { return { port: bound }; }, unref() { return this; },
      close(done) { assert.ok(held.delete(bound)); closed++; queueMicrotask(done); } };
  });
  try {
    await assert.rejects(async () => {
      await createFixtureUnitFiles(definitions, owned, async () => {
        if (++verifications === 2) throw new Error('synthetic second verify failure');
      });
      launches++;
    }, /second verify failure/);
    assert.equal(owned.length, 2);
    assert.equal(launches, 0);
  } finally {
    await reservation.release();
    await removeFixtureUnitFiles(owned);
  }
  assert.equal(held.size, 0);
  assert.equal(closed, 4);
  for (const unit of definitions) await assert.rejects(fs.stat(unit.file), { code: 'ENOENT' });
});

test('exclusive creation preserves an existing second file while cleanup removes only the first owned file', async t => {
  const definitions = await fixture(t), owned = [];
  await fs.writeFile(definitions[1].file, 'preexisting');
  await assert.rejects(createFixtureUnitFiles(definitions, owned, async () => {}), { code: 'EEXIST' });
  assert.equal(owned.length, 1);
  await removeFixtureUnitFiles(owned);
  assert.equal(await fs.readFile(definitions[1].file, 'utf8'), 'preexisting');
});

test('cleanup refuses a replacement inode and preserves its contents', async t => {
  const definitions = await fixture(t), owned = [];
  await createFixtureUnitFiles(definitions, owned, async () => {});
  await fs.rename(definitions[1].file, definitions[1].file + '.owned');
  await fs.writeFile(definitions[1].file, 'replacement');
  await assert.rejects(removeFixtureUnitFiles(owned), /identity or contents changed/);
  assert.equal(await fs.readFile(definitions[1].file, 'utf8'), 'replacement');
  assert.equal(await fs.readFile(definitions[0].file, 'utf8'), definitions[0].contents);
});

test('checked guardian forward and rollback plans allow their exact atomic replacements even before completion acknowledgement', async t => {
  const definitions = await fixture(t), owned = [];
  await createFixtureUnitFiles(definitions, owned, async () => {});
  const unit = owned[1], instance = path.join(path.dirname(unit.file), 'instance');
  const original = unit.expectedContents;
  for (const [id, contents] of [['forward', '[Unit]\nDescription=checked candidate\n'], ['rollback', original]]) {
    const previousInode = unit.fileIdentity.ino;
    const plan = { id, phase: 'prepared', before: { instanceHome: instance }, after: { instanceHome: instance },
      unit: { file: unit.file, before: unit.expectedContents, after: contents } };
    await authorizeFixtureGuardianReplacement(owned, path.join(instance, 'runtime', `supervisor-transition-${id}.json`), plan, instance);
    await fs.writeFile(unit.file + '.next', contents, { flag: 'wx', mode: 0o600 });
    await fs.rename(unit.file + '.next', unit.file);
    // No coordinator acknowledgement: cleanup must recognize the checked plan.
    await assertFixtureUnitFilesOwned(owned);
    assert.notEqual(unit.fileIdentity.ino, previousInode);
    assert.equal(unit.fileIdentity.mode, 0o600);
  }
  await removeFixtureUnitFiles(owned);
});

test('same-inode writes require the previously declared rendered bytes', async t => {
  const definitions = await fixture(t), owned = [];
  await createFixtureUnitFiles(definitions, owned, async () => {});
  const unit = owned[0], previousInode = unit.fileIdentity.ino;
  await authorizeFixtureUnitWrite(unit, '[Unit]\nDescription=known owner target\n');
  await fs.writeFile(unit.file, '[Unit]\nDescription=known owner target\n');
  await assertFixtureUnitFilesOwned(owned);
  assert.equal(unit.fileIdentity.ino, previousInode);
  await fs.writeFile(unit.file, 'unknown same-inode contents');
  await assert.rejects(removeFixtureUnitFiles(owned), /identity or contents changed/);
  assert.equal(await fs.readFile(unit.file, 'utf8'), 'unknown same-inode contents');
});

test('a planned atomic replacement must also preserve the expected permissions', async t => {
  const definitions = await fixture(t), owned = [];
  await createFixtureUnitFiles(definitions, owned, async () => {});
  const unit = owned[1], instance = path.join(path.dirname(unit.file), 'instance');
  const plan = { id: 'mode-check', phase: 'prepared', before: { instanceHome: instance }, after: { instanceHome: instance },
    unit: { file: unit.file, before: unit.expectedContents, after: 'planned bytes' } };
  await authorizeFixtureGuardianReplacement(owned, path.join(instance, 'runtime', 'supervisor-transition-mode-check.json'), plan, instance);
  await fs.writeFile(unit.file + '.next', 'planned bytes', { flag: 'wx', mode: 0o644 });
  await fs.rename(unit.file + '.next', unit.file);
  await fs.chmod(unit.file, 0o644);
  await assert.rejects(assertFixtureUnitFilesOwned(owned), /identity or contents changed/);
  await fs.chmod(unit.file, 0o600);
  await removeFixtureUnitFiles(owned);
});
