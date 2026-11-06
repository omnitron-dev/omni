// File ownership for the existing native fixture lifecycle; no process launch.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

async function inspect(unit) {
  const handle = await fs.open(unit.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.nlink === 1 && before.size <= 128 * 1024,
      'Fixture unit file is not a bounded regular file');
    const contents = await handle.readFile('utf8'), after = await handle.stat();
    assert.ok(['dev', 'ino', 'uid', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]),
      'Fixture unit changed while reading');
    const atPath = await fs.lstat(unit.file);
    assert.ok(!atPath.isSymbolicLink() && atPath.dev === after.dev && atPath.ino === after.ino,
      'Fixture unit path changed while reading');
    return { stat: after, contents };
  } finally { await handle.close(); }
}

const identity = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o7777 });
const sameIdentity = (stat, expected) => Object.keys(expected).every(key =>
  (key === 'mode' ? stat.mode & 0o7777 : stat[key]) === expected[key]);

export async function createFixtureUnitFiles(definitions, owned, verify) {
  for (const definition of definitions) {
    const handle = await fs.open(definition.file, 'wx', 0o644);
    try {
      const stat = await handle.stat();
      // Record ownership before writing or verifying: either can fail.
      const unit = { mode: definition.mode, file: definition.file, job: definition.job,
        fileIdentity: identity(stat), expectedContents: '' };
      owned.push(unit);
      await handle.writeFile(definition.contents);
      unit.expectedContents = definition.contents;
    } finally { await handle.close(); }
    await assertFixtureUnitFilesOwned([owned.at(-1)]);
    await verify(owned.at(-1));
  }
}

export async function assertFixtureUnitFilesOwned(units) {
  for (const unit of units) {
    const { stat, contents } = await inspect(unit);
    if (sameIdentity(stat, unit.fileIdentity) && contents === unit.expectedContents) continue;
    const pending = unit.pendingChange;
    assert.ok(pending && contents === pending.contents && sameIdentity(stat, pending.identity),
      'Fixture unit file identity or contents changed; refusing native cleanup');
    // Only an explicitly declared write or checked guardian plan can authorize
    // a new inode/content pair. Cleanup never learns arbitrary current bytes.
    unit.fileIdentity = identity(stat);
    unit.expectedContents = contents;
    delete unit.pendingChange;
  }
}

export async function authorizeFixtureUnitWrite(unit, contents) {
  await assertFixtureUnitFilesOwned([unit]);
  assert.equal(typeof contents, 'string');
  unit.pendingChange = { contents, identity: { ...unit.fileIdentity }, source: 'fixture-render' };
}

// Called only with the existing public SDK's prepared/checked guardian plan.
export async function authorizeFixtureGuardianReplacement(units, file, plan, instance) {
  const unit = units.find(value => value.mode === 'backend' && value.file === plan.unit?.file);
  assert.ok(unit && plan.phase === 'prepared' &&
    path.dirname(file) === path.join(instance, 'runtime') &&
    path.basename(file) === `supervisor-transition-${plan.id}.json` &&
    plan.before?.instanceHome === instance && plan.after?.instanceHome === instance,
  'Guardian plan is outside this fixture');
  await assertFixtureUnitFilesOwned([unit]);
  assert.ok(plan.unit.before === unit.expectedContents && typeof plan.unit.after === 'string',
    'Guardian plan unit bytes differ from the owned fixture');
  unit.pendingChange = { contents: plan.unit.after, identity: { dev: unit.fileIdentity.dev, uid: unit.fileIdentity.uid, mode: 0o600 },
    source: { planFile: file, planId: plan.id } };
}

export async function removeFixtureUnitFiles(units) {
  await assertFixtureUnitFilesOwned(units);
  for (const unit of units) {
    await assertFixtureUnitFilesOwned([unit]);
    await fs.unlink(unit.file);
  }
}
