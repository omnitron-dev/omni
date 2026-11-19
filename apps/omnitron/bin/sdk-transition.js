// Byte-preserving SDK selection recovery. This is deliberately separate from
// source/build qualification: a restored legacy checkpoint gains no new proof.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { pLimit } from '@omnitron-dev/common';

const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const state = root => path.join(root, '.omnitron/dev-sdk/transition.json');
const absent = error => { if (error.code === 'ENOENT') return null; throw error; };
const stat = file => fs.lstat(file, { bigint: true }).catch(absent);
const identity = value => ({ device: String(value.dev), inode: String(value.ino) });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const TREE_CONCURRENCY = 4;
const FILE_CONCURRENCY = 16;
const readFile = pLimit(FILE_CONCURRENCY);
const SMALL_FILE_BYTES = 256n * 1024n;

// Drain every admitted operation before reporting a failure. The caller may
// remove its private staging directory only after all writers have finished.
async function settledMap(items, concurrency, operation) {
  const limit = pLimit(concurrency);
  const results = await Promise.allSettled(items.map((item, index) => limit(operation, item, index)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map(result => result.value);
}
export const developmentCacheDirectory = override => path.resolve(override ??
  path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'omnitron', 'development'));
export const sdkTransitionSettled = phase => ['committed', 'restored', 'superseded'].includes(phase);

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
async function atomicBytes(file, bytes) {
  const temporary = file + '.' + randomUUID();
  const fd = await fs.open(temporary, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); }
  finally { await fd.close(); }
  await fs.rename(temporary, file);
  await sync(path.dirname(file));
}
const atomic = (file, value) => atomicBytes(file, JSON.stringify(value) + '\n');
async function physical(directory) {
  if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory())
    throw Error('SDK transition requires a physical directory: ' + directory);
}
async function measure(file, signal) {
  const rows = [], pending = []; let bytes = 0, failure;
  async function drain() {
    await Promise.all(pending.splice(0));
    if (failure) throw failure;
  }
  const unchanged = (before, after) => ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]);
  async function visit(current, relative) {
    signal?.throwIfAborted();
    const before = await stat(current);
    if (!before) { rows.push([relative, 'absent']); return; }
    const mode = Number(before.mode) & 0o7777;
    if (before.isSymbolicLink()) rows.push([relative, 'link', await fs.readlink(current)]);
    else if (before.isDirectory()) {
      rows.push([relative, 'directory', mode]);
      for (const name of (await fs.readdir(current)).sort()) await visit(path.join(current, name), path.join(relative, name));
    } else if (before.isFile()) {
      // Reserve depth-first order before asynchronous reads. Existing snapshot
      // digests remain identical regardless of filesystem completion order.
      const index = rows.length; rows.push(null);
      pending.push(readFile(async () => {
        signal?.throwIfAborted();
        const fd = await fs.open(current, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          if (!unchanged(before, await fd.stat({ bigint: true }))) throw Error('SDK file changed while opening: ' + current);
          const digest = createHash('sha256'); let length = 0;
          if (before.size <= SMALL_FILE_BYTES) {
            const buffer = Buffer.allocUnsafe(Number(before.size));
            while (length < buffer.length) {
              const { bytesRead } = await fd.read(buffer, length, buffer.length - length, null);
              if (!bytesRead) break;
              length += bytesRead;
            }
            digest.update(buffer.subarray(0, length));
          } else {
            for await (const chunk of fd.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024,
              end: Number(before.size) - 1 })) { signal?.throwIfAborted(); digest.update(chunk); length += chunk.length; }
          }
          if (BigInt(length) !== before.size || !unchanged(before, await fd.stat({ bigint: true })) ||
              !unchanged(before, await fs.lstat(current, { bigint: true })))
            throw Error('SDK file changed while measuring: ' + current);
          rows[index] = [relative, 'file', mode, Number(before.size), digest.digest('hex')]; bytes += Number(before.size);
        } finally { await fd.close(); }
      }).catch(error => { failure ??= error; }));
      // Bound both open descriptors and queued work, including a very wide tree.
      if (pending.length >= 32) await drain();
    } else throw Error('Unsupported SDK transition entry: ' + current);
  }
  try { await visit(file, ''); } finally { await drain(); }
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
async function verifyLocations(proof) {
  await verifyRoots(proof);
  for (const entry of proof.entries) {
    const parent = path.dirname(entry.path); await physical(parent);
    if (!same(identity(await stat(parent)), entry.parent)) throw Error('SDK destination parent was replaced: ' + parent);
  }
}
async function verifyGuards(proof, signal) {
  await verifyLocations(proof);
  await settledMap(proof.guards, FILE_CONCURRENCY, async item => {
    if (!same(await measure(item.path, signal), item.before)) throw Error('SDK inputs changed outside the transition: ' + item.path);
  });
}
async function measurements(proof, signal) {
  return settledMap(proof.entries, TREE_CONCURRENCY, async item => {
    await physical(path.dirname(item.path)); return measure(item.path, signal);
  });
}
async function load(root) {
  if (!await stat(state(root))) return null;
  await owned(path.dirname(state(root)), true, false); await owned(state(root), false);
  const raw = await fs.readFile(state(root), 'utf8').catch(absent);
  if (raw === null) return null;
  const journal = JSON.parse(raw);
  if (journal.schema !== 1 || journal.root !== root || !/^[a-f0-9-]{36}$/.test(journal.id) ||
      !path.isAbsolute(journal.cache) || journal.snapshot !== path.join(journal.cache, 'sdk-transitions', journal.id) ||
      !['prepared', 'mutating', 'recoverable', 'committed', 'restoring', 'restored', 'superseded'].includes(journal.phase))
    throw Error('Invalid SDK transition receipt');
  return { journal, proof: await readProof(journal), raw };
}
async function readProof(journal) {
  const { root } = journal;
  await owned(path.dirname(journal.snapshot), true); await owned(journal.snapshot, true);
  await owned(path.join(journal.snapshot, 'proof.json'), false);
  const bytes = await fs.readFile(path.join(journal.snapshot, 'proof.json'));
  if (hash(bytes) !== journal.proof) throw Error('SDK transition proof changed');
  const proof = JSON.parse(bytes);
  if (proof.schema !== 1 || proof.root !== root || proof.id !== journal.id || proof.source !== journal.source ||
      !same(proof.roots?.map(item => item.path), [root, journal.source]) ||
      !Array.isArray(proof.entries) || !Array.isArray(proof.guards) ||
      proof.entries.some(item => ![root, proof.source].some(base => inside(base, item.path)) ||
        item.path === root || item.path === proof.source || item.path.split(path.sep).includes('.git')))
    throw Error('SDK transition paths do not belong to the selected workspaces');
  return proof;
}

export async function sdkTransitionStatus(root, verify = false) {
  const selected = await load(root);
  if (selected && verify) await verifyGuards(selected.proof);
  if (selected?.journal.phase === 'superseded') await sdkAdoptionTransition(root);
  return selected && { id: selected.journal.id, phase: selected.journal.phase, source: selected.proof.source,
    ...(selected.journal.phase === 'superseded' && { adoption: { review: selected.journal.adoption.review,
      launch: 'unconfirmed', history: selected.journal.adoption.history } }) };
}

async function attemptsBytes(root) {
  const file = path.join(path.dirname(state(root)), 'start-attempts.json');
  if (!await stat(file)) return null;
  await owned(file, false);
  return fs.readFile(file, 'utf8');
}

/** Current-state admission never relies on or changes the former rollback guards. */
export async function sdkAdoptionTransition(root) {
  const selected = await load(root);
  if (!selected || !['recoverable', 'superseded'].includes(selected.journal.phase))
    throw Error('Only a recoverable SDK selection can be superseded; an interrupted writer or restoration must be resolved first');
  await verifyRoots(selected.proof);
  const { journal } = selected;
  let original = selected.raw;
  if (journal.phase === 'superseded') {
    const admission = journal.adoption;
    const history = path.join(path.dirname(state(root)), 'history', journal.id + '-' + admission?.review + '.json');
    if (admission?.protocol !== 1 || admission.history !== history || !/^[a-f0-9]{64}$/.test(admission.review) ||
        hash(JSON.stringify(admission.evidence)) !== admission.review || admission.launch !== 'unconfirmed' ||
        admission.evidence.protocol !== 1 || admission.evidence.root !== root || admission.evidence.source !== journal.source ||
        admission.evidence.transition?.id !== journal.id || admission.evidence.transition.source !== journal.source ||
        admission.evidence.transition.proofSha256 !== journal.proof) throw Error('Invalid SDK current-state admission');
    await owned(path.dirname(history), true);
    await owned(history, false);
    const bytes = await fs.readFile(history, 'utf8');
    if (hash(bytes) !== admission.historySha256) throw Error('Archived SDK transition history changed');
    const record = JSON.parse(bytes);
    original = record.journal;
    if (record.schema !== 1 || typeof original !== 'string' || (record.attempts !== null && typeof record.attempts !== 'string') ||
        hash(original) !== admission.evidence.transition.journalSha256 ||
        (record.attempts === null ? null : hash(record.attempts)) !== admission.evidence.startAttemptsSha256)
      throw Error('Archived SDK transition evidence changed');
    const prior = JSON.parse(original);
    if (prior.id !== journal.id || prior.root !== root || prior.source !== journal.source || prior.proof !== journal.proof || prior.phase !== 'recoverable')
      throw Error('Archived SDK transition belongs to another selection');
  }
  return { transition: { id: journal.id, source: journal.source, journalSha256: hash(original), proofSha256: journal.proof },
    startAttemptsSha256: await attemptsBytes(root).then(bytes => bytes === null ? null : hash(bytes)),
    ...(journal.phase === 'superseded' && { adoption: journal.adoption }) };
}

/** Caller holds both workspace locks, verifies the current graph and proves stopped consumers. */
export async function supersedeSdkTransition(root, evidence, review, revalidate) {
  if (!/^[a-f0-9]{64}$/.test(review) || hash(JSON.stringify(evidence)) !== review || evidence?.protocol !== 1 || evidence.root !== root)
    throw Error('Current SDK state requires its exact reviewed digest');
  if (typeof revalidate !== 'function') throw Error('Current SDK admission requires independent revalidation');
  const observed = await sdkAdoptionTransition(root);
  if (!same(observed.transition, evidence.transition) || observed.startAttemptsSha256 !== evidence.startAttemptsSha256)
    throw Error('SDK transition or launch attempts changed before current-state admission');
  if (observed.adoption) {
    if (observed.adoption.review !== review) throw Error('This SDK selection already has another current-state admission');
    return observed.adoption;
  }
  const selected = await load(root);
  if (hash(selected.raw) !== evidence.transition.journalSha256) throw Error('SDK transition changed before archiving');
  const attempts = await attemptsBytes(root);
  if ((attempts === null ? null : hash(attempts)) !== evidence.startAttemptsSha256) throw Error('SDK launch attempts changed before archiving');
  const directory = path.join(path.dirname(state(root)), 'history');
  await sdkDirectory(directory); await owned(directory, true);
  const history = path.join(directory, selected.journal.id + '-' + review + '.json');
  const bytes = JSON.stringify({ schema: 1, journal: selected.raw, attempts }) + '\n';
  const temporary = history + '.' + randomUUID();
  try {
    const fd = await fs.open(temporary, 'wx', 0o600);
    try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
    try { await fs.link(temporary, history); await sync(directory); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await owned(history, false);
      if (await fs.readFile(history, 'utf8') !== bytes) throw Error('SDK history already contains different evidence');
    }
  } finally { await fs.rm(temporary, { force: true }); }
  await revalidate();
  if (await fs.readFile(state(root), 'utf8') !== selected.raw || await attemptsBytes(root) !== attempts)
    throw Error('SDK selection changed during archival; current files were preserved');
  const adoption = { protocol: 1, review, evidence, history, historySha256: hash(bytes), launch: 'unconfirmed' };
  await atomic(state(root), { ...selected.journal, phase: 'superseded', adoption });
  return adoption;
}

async function transitionCache(root, source) {
  const cache = developmentCacheDirectory(process.env.OMNITRON_DEV_CACHE);
  if ([root, source].some(base => inside(base, cache) || inside(cache, base))) throw Error('SDK transition cache must be separate from both workspaces');
  if (cache.startsWith('/Volumes/')) {
    const volume = path.join('/Volumes', cache.split('/')[2]);
    const mounted = await stat(volume);
    if (!mounted || mounted.dev === (await stat('/Volumes')).dev) throw Error('SDK transition development volume is not mounted');
  }
  return cache;
}
const outerPaths = paths => [...new Set(paths)].filter(file => !paths.some(parent => parent !== file && inside(parent, file)));
async function predecessor(root) {
  const prior = await load(root);
  if (prior && !sdkTransitionSettled(prior.journal.phase)) throw Error('SDK transition is unfinished; run sdk recover before another selection');
  if (prior?.journal.phase === 'superseded') await sdkAdoptionTransition(root);
  return prior?.raw ?? null;
}
const receiptDigest = raw => raw === null ? null : hash(raw);
/**
 * @param {{ root: string, source: string, paths: string[], guards: string[], detached?: boolean, intent?: string, signal?: AbortSignal,
 * progress?: (event: { phase: 'inventory' | 'retain' | 'verify' | 'prepared', paths: number, bytes?: number }) => void }} options
 */
export async function prepareSdkTransition({ root, source, paths, guards, progress, detached = false, intent, signal }) {
  signal?.throwIfAborted();
  const previous = await predecessor(root);
  const cache = await transitionCache(root, source);
  await sdkDirectory(cache); await owned(cache, true, false);
  await owned(path.dirname(state(root)), true, false);
  const id = randomUUID(), roots = [];
  for (const directory of [root, source]) {
    await physical(directory); roots.push({ path: directory, identity: identity(await stat(directory)) });
  }
  // Parents are never created by recovery. Reject unknown installation layouts
  // before any build or package-manager repair rather than guessing ownership.
  const unique = outerPaths(paths);
  progress?.({ phase: 'inventory', paths: unique.length });
  for (const file of unique)
    if (![root, source].some(base => inside(base, file)) || [root, source].includes(file) || file.split(path.sep).includes('.git'))
      throw Error('SDK transition path escapes its workspace: ' + file);
  const entries = await settledMap(unique, TREE_CONCURRENCY, async file => {
    const parent = path.dirname(file);
    await physical(parent);
    return { path: file, parent: identity(await stat(parent)), before: await measure(file, signal) };
  });
  const measuredGuards = await settledMap([...new Set(guards)], FILE_CONCURRENCY, async file =>
    ({ path: file, before: await measure(file, signal) }));
  const proof = { schema: 1, id, root, source, roots, entries, guards: measuredGuards,
    ...(detached && { preparation: { version: 1, intent, previous: receiptDigest(previous) } }) };
  const directory = path.join(cache, 'sdk-transitions');
  await sdkDirectory(directory); await owned(directory, true);
  const bytes = entries.reduce((total, entry) => total + entry.before.bytes, 0);
  await space(directory, bytes);
  const temporary = path.join(directory, id + '.preparing'), snapshot = path.join(directory, id);
  await fs.mkdir(temporary, { mode: 0o700 });
  try {
    progress?.({ phase: 'retain', paths: entries.length, bytes });
    await settledMap(entries, TREE_CONCURRENCY, async (entry, index) => {
      signal?.throwIfAborted();
      if (!entry.before.absent) await copy(entry.path, path.join(temporary, String(index)));
      if (!same(await measure(path.join(temporary, String(index)), signal), entry.before)) throw Error('SDK before-image copy verification failed: ' + entry.path);
    });
    progress?.({ phase: 'verify', paths: entries.length, bytes });
    await verifyGuards(proof, signal);
    if (!same(await measurements(proof, signal), entries.map(entry => entry.before))) throw Error('SDK files changed while retaining the before-image');
    await atomic(path.join(temporary, 'proof.json'), proof);
    await fs.rename(temporary, snapshot); await sync(directory);
    const journal = { schema: 1, id, root, source, cache, snapshot, phase: 'prepared',
      proof: hash(await fs.readFile(path.join(snapshot, 'proof.json'))), restoration: {} };
    if (!detached) await atomic(state(root), journal);
    progress?.({ phase: 'prepared', paths: entries.length, bytes });
    return { journal, proof };
  } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
}

/** Re-discover the selection before calling this. Always hash the actual saved bytes, including absent paths. */
export async function readPreparedSdkTransition({ root, source, paths, guards, intent }, token, signal = undefined) {
  const match = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.([a-f0-9]{64})$/.exec(token);
  if (!match) throw Error('Use the complete SDK preparation token from sdk prepare');
  const cache = await transitionCache(root, source);
  await owned(cache, true, false);
  const [, id, digest] = match, snapshot = path.join(cache, 'sdk-transitions', id);
  const journal = { schema: 1, id, root, source, cache, snapshot, phase: 'prepared', proof: digest, restoration: {} };
  const proof = await readProof(journal);
  if (await stat(path.join(snapshot, 'claimed'))) throw Error('SDK preparation has already been used');
  if (proof.preparation?.version !== 1 || !intent || proof.preparation.intent !== intent ||
      proof.preparation.previous !== receiptDigest(await predecessor(root)) ||
      !same(proof.entries.map(item => item.path).sort(), outerPaths(paths).sort()) ||
      !same(proof.guards.map(item => item.path).sort(), [...new Set(guards)].sort()))
    throw Error('SDK preparation no longer matches the selected revision, package inputs, paths or previous transition');
  await settledMap(proof.entries, TREE_CONCURRENCY, async (entry, index) => {
    if (!same(await measure(path.join(snapshot, String(index)), signal), entry.before))
      throw Error('Retained SDK before-image changed: ' + entry.path);
  });
  return { journal, proof };
}

/**
 * The caller holds both workspace locks through the first writer. An admitted
 * source fence and prepared journal survive a crash and are understood by recover.
 * @param {any} transition
 * @param {{ signal?: AbortSignal, admit?: () => Promise<void>, fence?: () => Promise<void>, unfence?: () => Promise<void> }} options
 */
export async function beginSdkTransition(transition, { signal, admit, fence, unfence } = {}) {
  const { journal, proof } = transition;
  signal?.throwIfAborted();
  await verifyGuards(proof, signal);
  if (!same(await measurements(proof, signal), proof.entries.map(entry => entry.before)))
    throw Error('SDK files changed after retaining the before-image');
  const previous = proof.preparation ? await predecessor(proof.root) : null;
  if (proof.preparation && proof.preparation.previous !== receiptDigest(previous)) throw Error('SDK preparation predecessor changed');
  await admit?.();
  await verifyLocations(proof);
  signal?.throwIfAborted();
  const claim = path.join(journal.snapshot, 'claimed');
  if (proof.preparation) {
    await readProof(journal);
    signal?.throwIfAborted();
    try { await fs.link(path.join(journal.snapshot, 'proof.json'), claim); }
    catch (error) { if (error.code === 'EEXIST') throw Error('SDK preparation has already been used'); throw error; }
    await sync(journal.snapshot);
    await atomic(state(proof.root), journal);
  }
  await fence?.();
  if (!signal?.aborted) {
    journal.phase = 'mutating';
    await atomic(state(proof.root), journal);
  }
  // An OS signal can arrive during metadata fsync. No workspace writer has
  // run yet, so undo only this admission while we still hold both locks.
  if (signal?.aborted && proof.preparation) {
    await unfence?.();
    if (previous !== null) await atomicBytes(state(proof.root), previous);
    else { await fs.unlink(state(proof.root)); await sync(path.dirname(state(proof.root))); }
    await fs.unlink(claim); await sync(journal.snapshot);
    journal.phase = 'prepared';
  }
  signal?.throwIfAborted();
}

// Called only after owned child processes have exited and the caller has
// checked package-manager lock ownership. A killed build has no such receipt.
export async function finishSdkTransition(transition, committed) {
  await verifyGuards(transition.proof);
  transition.journal.owned = await measurements(transition.proof);
  transition.journal.phase = committed ? 'committed' : 'recoverable';
  await atomic(state(transition.proof.root), transition.journal);
}

/** Application receipts may advance after the file selection committed. Keep
 * only that owned metadata entry current; never adopt changed build outputs. */
export async function saveSdkBuildCheckpoint(root, checkpoint) {
  const selected = await load(root), file = path.join(root, '.omnitron/dev-sdk/built.json');
  const index = selected?.proof.entries.findIndex(entry => entry.path === file) ?? -1;
  let tracked = false;
  if (selected?.journal.phase === 'committed' && index >= 0 && selected.journal.owned?.[index]) {
    await verifyRoots(selected.proof);
    const entry = selected.proof.entries[index];
    await physical(path.dirname(file));
    if (!same(identity(await stat(path.dirname(file))), entry.parent)) throw Error('SDK checkpoint parent was replaced');
    if (!same(await measure(file), selected.journal.owned[index]))
      throw Error('SDK checkpoint changed outside its committed selection; its recovery evidence was preserved');
    tracked = true;
  }
  await atomic(file, checkpoint);
  if (tracked) {
    const bytes = Buffer.from(JSON.stringify(checkpoint) + '\n');
    const expected = { digest: hash(JSON.stringify([['', 'file', 0o600, bytes.length, hash(bytes)]])), bytes: bytes.length, absent: false };
    if (!same(await measure(file), expected)) throw Error('SDK checkpoint changed before its recovery receipt was saved');
    selected.journal.owned[index] = expected;
    await atomic(state(root), selected.journal);
  }
}

export async function recoverSdkTransition(root) {
  const selected = await load(root);
  if (!selected) throw Error('No retained SDK transition is available');
  const { journal, proof } = selected;
  if (journal.phase === 'superseded') throw Error('This SDK transition was superseded without restoration; its uncertain attempt remains in history. Select a new SDK to retain a fresh before-image.');
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
