// Byte-preserving SDK selection recovery. This is deliberately separate from
// source/build qualification: a restored legacy checkpoint gains no new proof.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const state = root => path.join(root, '.omnitron/dev-sdk/transition.json');
const absent = error => { if (error.code === 'ENOENT') return null; throw error; };
const stat = file => fs.lstat(file, { bigint: true }).catch(absent);
const identity = value => ({ device: String(value.dev), inode: String(value.ino) });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const developmentCacheDirectory = override => path.resolve(override ??
  path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'omnitron', 'development'));

export async function sdkDirectory(directory) {
  let prefix = path.parse(directory).root;
  for (const component of path.relative(prefix, directory).split(path.sep)) {
    prefix = path.join(prefix, component);
    let entry = await stat(prefix);
    if (!entry) { await fs.mkdir(prefix, { mode: 0o700 }); entry = await stat(prefix); }
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error('SDK directory prefix is not physical: ' + prefix);
  }
}
async function owned(file, directory, privateMode = true) {
  const info = await stat(file);
  if (!info || info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) ||
      typeof process.getuid === 'function' && (info.uid !== BigInt(process.getuid()) ||
        (Number(info.mode) & (privateMode ? 0o077 : 0o022)))) throw Error('SDK transition requires an owned, protected path: ' + file);
  if (await fs.realpath(file) !== file) throw Error('SDK transition path has a symbolic-link prefix: ' + file);
}
const copy = (from, to) => fs.cp(from, to, { recursive: true, force: false, errorOnExist: true,
  verbatimSymlinks: true, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE });
async function sync(file) {
  const fd = await fs.open(file, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
async function atomic(file, value) {
  const temporary = file + '.' + randomUUID();
  const fd = await fs.open(temporary, 'wx', 0o600);
  try { await fd.writeFile(JSON.stringify(value) + '\n'); await fd.sync(); }
  finally { await fd.close(); }
  await fs.rename(temporary, file);
  await sync(path.dirname(file));
}
async function physical(directory) {
  if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory())
    throw Error('SDK transition requires a physical directory: ' + directory);
}
async function measure(file) {
  const rows = []; let bytes = 0;
  async function visit(current, relative) {
    const before = await stat(current);
    if (!before) { rows.push([relative, 'absent']); return; }
    const mode = Number(before.mode) & 0o7777;
    if (before.isSymbolicLink()) rows.push([relative, 'link', await fs.readlink(current)]);
    else if (before.isDirectory()) {
      rows.push([relative, 'directory', mode]);
      for (const name of (await fs.readdir(current)).sort()) await visit(path.join(current, name), path.join(relative, name));
    } else if (before.isFile()) {
      const fd = await fs.open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const digest = createHash('sha256');
        for await (const chunk of fd.createReadStream({ autoClose: false })) digest.update(chunk);
        const after = await fd.stat({ bigint: true });
        if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key]))
          throw Error('SDK file changed while measuring: ' + current);
        rows.push([relative, 'file', mode, Number(before.size), digest.digest('hex')]); bytes += Number(before.size);
      } finally { await fd.close(); }
    } else throw Error('Unsupported SDK transition entry: ' + current);
  }
  await visit(file, '');
  return { digest: hash(JSON.stringify(rows)), bytes, absent: rows[0][1] === 'absent' };
}
async function space(directory, bytes) {
  const available = await fs.statfs(directory);
  if (available.bavail * available.bsize < bytes + 64 * 1024 ** 2)
    throw Error('Insufficient free space for SDK transition in ' + directory);
}
async function verifyRoots(proof) {
  for (const root of proof.roots) {
    await physical(root.path);
    if (!same(identity(await stat(root.path)), root.identity)) throw Error('SDK workspace directory was replaced: ' + root.path);
  }
}
async function verifyGuards(proof) {
  await verifyRoots(proof);
  for (const entry of proof.entries) {
    const parent = path.dirname(entry.path); await physical(parent);
    if (!same(identity(await stat(parent)), entry.parent)) throw Error('SDK destination parent was replaced: ' + parent);
  }
  for (const item of proof.guards)
    if (!same(await measure(item.path), item.before)) throw Error('SDK inputs changed outside the transition: ' + item.path);
}
async function measurements(proof) {
  const result = [];
  for (const item of proof.entries) { await physical(path.dirname(item.path)); result.push(await measure(item.path)); }
  return result;
}
async function load(root) {
  if (!await stat(state(root))) return null;
  await owned(path.dirname(state(root)), true, false); await owned(state(root), false);
  const raw = await fs.readFile(state(root), 'utf8').catch(absent);
  if (raw === null) return null;
  const journal = JSON.parse(raw);
  if (journal.schema !== 1 || journal.root !== root || !/^[a-f0-9-]{36}$/.test(journal.id) ||
      !path.isAbsolute(journal.cache) || journal.snapshot !== path.join(journal.cache, 'sdk-transitions', journal.id) ||
      !['prepared', 'mutating', 'recoverable', 'committed', 'restoring', 'restored'].includes(journal.phase))
    throw Error('Invalid SDK transition receipt');
  await owned(path.dirname(journal.snapshot), true); await owned(journal.snapshot, true);
  await owned(path.join(journal.snapshot, 'proof.json'), false);
  const bytes = await fs.readFile(path.join(journal.snapshot, 'proof.json'));
  if (hash(bytes) !== journal.proof) throw Error('SDK transition proof changed');
  const proof = JSON.parse(bytes);
  if (proof.root !== root || proof.id !== journal.id || proof.source !== journal.source ||
      !Array.isArray(proof.entries) || !Array.isArray(proof.guards) ||
      proof.entries.some(item => ![root, proof.source].some(base => inside(base, item.path)) ||
        item.path === root || item.path === proof.source || item.path.split(path.sep).includes('.git')))
    throw Error('SDK transition paths do not belong to the selected workspaces');
  return { journal, proof };
}

export async function sdkTransitionStatus(root, verify = false) {
  const selected = await load(root);
  if (selected && verify) await verifyGuards(selected.proof);
  return selected && { id: selected.journal.id, phase: selected.journal.phase, source: selected.proof.source };
}

export async function prepareSdkTransition({ root, source, paths, guards }) {
  const prior = await sdkTransitionStatus(root);
  if (prior && !['committed', 'restored'].includes(prior.phase)) throw Error('SDK transition is unfinished; run sdk recover before another selection');
  const cache = developmentCacheDirectory(process.env.OMNITRON_DEV_CACHE);
  if ([root, source].some(base => inside(base, cache) || inside(cache, base))) throw Error('SDK transition cache must be separate from both workspaces');
  if (cache.startsWith('/Volumes/')) {
    const volume = path.join('/Volumes', cache.split('/')[2]);
    const mounted = await stat(volume);
    if (!mounted || mounted.dev === (await stat('/Volumes')).dev) throw Error('SDK transition development volume is not mounted');
  }
  await sdkDirectory(cache); await owned(cache, true, false);
  await owned(path.dirname(state(root)), true, false);
  const id = randomUUID(), entries = [], roots = [];
  for (const directory of [root, source]) {
    await physical(directory); roots.push({ path: directory, identity: identity(await stat(directory)) });
  }
  // Parents are never created by recovery. Reject unknown installation layouts
  // before any build or package-manager repair rather than guessing ownership.
  const unique = [...new Set(paths)].filter(file => !paths.some(parent => parent !== file && inside(parent, file)));
  for (const file of unique) {
    if (![root, source].some(base => inside(base, file)) || [root, source].includes(file) || file.split(path.sep).includes('.git'))
      throw Error('SDK transition path escapes its workspace: ' + file);
    await physical(path.dirname(file));
    entries.push({ path: file, parent: identity(await stat(path.dirname(file))), before: await measure(file) });
  }
  const proof = { schema: 1, id, root, source, roots, entries, guards: [] };
  for (const file of [...new Set(guards)]) proof.guards.push({ path: file, before: await measure(file) });
  const directory = path.join(cache, 'sdk-transitions');
  await sdkDirectory(directory); await owned(directory, true);
  await space(directory, entries.reduce((total, entry) => total + entry.before.bytes, 0));
  const temporary = path.join(directory, id + '.preparing'), snapshot = path.join(directory, id);
  await fs.mkdir(temporary, { mode: 0o700 });
  try {
    for (const [index, entry] of entries.entries()) {
      if (!entry.before.absent) await copy(entry.path, path.join(temporary, String(index)));
      if (!same(await measure(path.join(temporary, String(index))), entry.before)) throw Error('SDK before-image copy verification failed: ' + entry.path);
    }
    await verifyGuards(proof);
    if (!same(await measurements(proof), entries.map(entry => entry.before))) throw Error('SDK files changed while retaining the before-image');
    await atomic(path.join(temporary, 'proof.json'), proof);
    await fs.rename(temporary, snapshot); await sync(directory);
    const journal = { schema: 1, id, root, source, cache, snapshot, phase: 'prepared',
      proof: hash(await fs.readFile(path.join(snapshot, 'proof.json'))), restoration: {} };
    await atomic(state(root), journal);
    return { journal, proof };
  } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
}

export async function beginSdkTransition(transition) {
  await verifyGuards(transition.proof);
  if (!same(await measurements(transition.proof), transition.proof.entries.map(entry => entry.before)))
    throw Error('SDK files changed after retaining the before-image');
  transition.journal.phase = 'mutating';
  await atomic(state(transition.proof.root), transition.journal);
}

// Called only after owned child processes have exited and the caller has
// checked package-manager lock ownership. A killed build has no such receipt.
export async function finishSdkTransition(transition, committed) {
  await verifyGuards(transition.proof);
  transition.journal.owned = await measurements(transition.proof);
  transition.journal.phase = committed ? 'committed' : 'recoverable';
  await atomic(state(transition.proof.root), transition.journal);
}

export async function recoverSdkTransition(root) {
  const selected = await load(root);
  if (!selected) throw Error('No retained SDK transition is available');
  const { journal, proof } = selected;
  if (journal.phase === 'restored') {
    await verifyGuards(proof);
    if (!same(await measurements(proof), proof.entries.map(entry => entry.before)))
      throw Error('Previously restored SDK files changed; recovery did not overwrite them');
    return;
  }
  if (journal.phase === 'mutating') throw Error('SDK build/install was interrupted before recording owned outputs; recovery cannot overwrite unproven changes');
  await verifyGuards(proof);
  for (const [index, entry] of proof.entries.entries())
    if (!same(await measure(path.join(journal.snapshot, String(index))), entry.before)) throw Error('Retained SDK before-image changed: ' + entry.path);
  if (journal.phase === 'prepared') {
    if (!same(await measurements(proof), proof.entries.map(entry => entry.before))) throw Error('Prepared SDK files changed outside the transition');
  } else {
    if (!Array.isArray(journal.owned) || journal.owned.length !== proof.entries.length) throw Error('SDK transition has no complete owned-output receipt');
    // Preflight every path before restoring any. Per-entry checks also protect
    // against edits arriving later while copying a large dependency directory.
    for (const [index, entry] of proof.entries.entries()) {
      const actual = await measure(entry.path), work = journal.restoration[index];
      if (!same(actual, entry.before) && !same(actual, journal.owned[index]) && !(work && actual.absent))
        throw Error('SDK recovery preserved files changed outside the transition: ' + entry.path);
    }
    journal.phase = 'restoring'; await atomic(state(root), journal);
    for (const [index, entry] of proof.entries.entries()) {
      // Check source bytes once before and after the complete restore. Rehashing
      // every dependency/source guard for every output makes recovery quadratic.
      await verifyRoots(proof); await physical(path.dirname(entry.path));
      if (!same(identity(await stat(path.dirname(entry.path))), entry.parent)) throw Error('SDK destination parent was replaced');
      if (same(await measure(entry.path), entry.before)) continue;
      let work = journal.restoration[index];
      if (!work) {
        await space(path.dirname(entry.path), entry.before.bytes);
        const directory = path.join(path.dirname(entry.path), '.sdk-recover-' + journal.id + '-' + index);
        await fs.mkdir(directory, { mode: 0o700 });
        work = journal.restoration[index] = { directory, identity: identity(await stat(directory)) };
        await atomic(state(root), journal);
      }
      if (work.directory !== path.join(path.dirname(entry.path), '.sdk-recover-' + journal.id + '-' + index) ||
          !same(identity(await stat(work.directory)), work.identity)) throw Error('SDK recovery staging directory changed');
      await owned(work.directory, true);
      const before = path.join(work.directory, 'before'), displaced = path.join(work.directory, 'displaced');
      if (!entry.before.absent && !same(await measure(before), entry.before)) {
        await fs.rm(before, { recursive: true, force: true });
        await copy(path.join(journal.snapshot, String(index)), before);
        if (!same(await measure(before), entry.before)) throw Error('SDK restoration copy verification failed');
      }
      const current = await measure(entry.path), moved = await measure(displaced);
      if (!current.absent) {
        if (!same(current, journal.owned[index]) || !moved.absent) throw Error('SDK recovery preserved a changed destination: ' + entry.path);
        await fs.rename(entry.path, displaced); await sync(path.dirname(entry.path)); await sync(work.directory);
        if (!same(await measure(displaced), journal.owned[index]))
          throw Error('SDK files changed during displacement and were preserved at ' + displaced);
      } else if (!journal.owned[index].absent && !same(moved, journal.owned[index]))
        throw Error('SDK recovery cannot prove ownership of the missing destination: ' + entry.path);
      if (await stat(entry.path)) throw Error('SDK recovery destination was recreated: ' + entry.path);
      if (!entry.before.absent) await fs.rename(before, entry.path);
      await sync(path.dirname(entry.path));
      if (!same(await measure(entry.path), entry.before)) throw Error('SDK restoration did not reproduce the before-image');
    }
  }
  await verifyGuards(proof);
  if (!same(await measurements(proof), proof.entries.map(entry => entry.before))) throw Error('SDK changed before recovery completed');
  journal.phase = 'restored'; await atomic(state(root), journal);
  // Displaced trees remain owned by this receipt, not silently adopted by any
  // future operation. The immutable before-image stays on the development disk.
  for (const [index, work] of Object.entries(journal.restoration)) {
    if (same(identity(await stat(work.directory)), work.identity) &&
        same(await measure(path.join(work.directory, 'displaced')), journal.owned[index]))
      await fs.rm(work.directory, { recursive: true });
  }
}
