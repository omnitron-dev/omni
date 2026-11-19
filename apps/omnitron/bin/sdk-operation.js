// One filesystem admission boundary for SDK writers and owner-run migrations.
// The durable migration outcome belongs to OperationJournal, never this file.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sdkDirectory, sdkTransitionStatus, sdkTransitionSettled } from './sdk-transition.js';

export const sdkStatePath = root => path.join(root, '.omnitron', 'dev-sdk');
const markerPath = root => path.join(sdkStatePath(root), 'pending-selection');
const absent = error => { if (error.code === 'ENOENT') return null; throw error; };
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const markerBytes = (root, reference) => JSON.stringify({ kind: 'migration', root, id: reference.id,
  review: reference.review, journal: reference.journal }) + '\n';

function validateMigrationReference(workspaces, reference) {
  if (!Array.isArray(workspaces) || !workspaces.length || new Set(workspaces.map(item => item.root)).size !== workspaces.length ||
      typeof reference.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(reference.id) ||
      !/^[a-f0-9]{64}$/.test(reference.review) || typeof reference.journal !== 'string' ||
      !path.isAbsolute(reference.journal) || typeof reference.read !== 'function')
    throw Error('A canonical migration operation and SDK workspace identities are required');
}
async function readMigrationReceipt(reference) {
  const receipt = await reference.read();
  if (!receipt || receipt.id !== reference.id || receipt.kind !== 'migration' || receipt.inputDigest !== reference.review)
    throw Error('The SDK hold has no matching canonical migration receipt');
  return receipt;
}
async function lockWorkspaces(workspaces, admitted, body, index = 0) {
  if (index === workspaces.length) return body();
  const identity = workspaces[index];
  if (!same(await sdkWorkspaceIdentity(identity.root), identity)) throw Error('SDK workspace identity changed before migration');
  const dir = await prepareSdkState(identity.root);
  return exclusively(dir, async () => {
    await admitted(identity);
    return lockWorkspaces(workspaces, admitted, body, index + 1);
  });
}

export async function prepareSdkState(root) {
  const dir = sdkStatePath(root);
  await sdkDirectory(dir);
  await protectedState(root);
  const ignore = path.join(dir, '.gitignore');
  const current = await coordinationFile(ignore);
  if (!current || current.size !== 2 || await fs.readFile(ignore, 'utf8') !== '*\n')
    await writeCoordinationFile(ignore, '*\n');
  return dir;
}

async function coordinationFile(file) {
  const info = await fs.lstat(file).catch(absent);
  if (info && (!info.isFile() || info.nlink !== 1 || typeof process.getuid === 'function' &&
      (info.uid !== process.getuid() || info.mode & 0o022))) throw Error('SDK coordination requires a physical workspace-owned file: ' + file);
  return info;
}

async function protectedState(root) {
  const dir = sdkStatePath(root), info = await fs.lstat(dir).catch(absent);
  if (!info) return;
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(dir) !== dir ||
      typeof process.getuid === 'function' && (info.uid !== process.getuid() || info.mode & 0o022))
    throw Error('SDK state directory must be physical, owned by this user and not writable by other users');
}

export async function sdkWorkspaceIdentity(root) {
  if (!path.isAbsolute(root) || await fs.realpath(root) !== root) throw Error('SDK workspace must be a physical directory');
  const info = await fs.stat(root);
  if (!info.isDirectory() || typeof process.getuid === 'function' && (info.uid !== process.getuid() || info.mode & 0o022))
    throw Error('SDK workspace must be owned by this user and not writable by other users');
  await protectedState(root);
  return { root, device: String(info.dev), inode: String(info.ino) };
}

// The same OS lock is used by already-running SDK watchers. Its release on
// process death is backed by pending-selection, which survives that process.
export async function exclusively(dir, body, waitSignal) {
  const { DatabaseSync } = await import('node:sqlite');
  const file = path.join(dir, 'operation.sqlite');
  await Promise.all(['', '-journal', '-wal', '-shm'].map(suffix => coordinationFile(file + suffix)));
  const db = new DatabaseSync(file);
  try {
    for (;;) {
      waitSignal?.throwIfAborted();
      try { db.exec('BEGIN IMMEDIATE'); break; }
      catch (error) {
        if (error.errcode !== 5) throw error;
        if (!waitSignal) throw Error('Another development SDK operation is active in ' + dir);
        await delay(200, undefined, { signal: waitSignal });
      }
    }
    return await body();
  } finally { db.close(); }
}

async function readMarker(root) {
  await protectedState(root);
  const file = markerPath(root), info = await fs.lstat(file).catch(absent);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || typeof process.getuid === 'function' &&
      (info.uid !== process.getuid() || info.mode & 0o022)) throw Error('SDK ownership marker is not an owned, protected file');
  return { bytes: await fs.readFile(file, 'utf8') };
}

async function writeCoordinationFile(file, bytes) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = await fs.open(temporary, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); }
  finally { await fd.close(); }
  try { await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
  await syncDirectory(path.dirname(file));
}
const atomicMarker = (root, bytes) => writeCoordinationFile(markerPath(root), bytes);
async function syncDirectory(dir) {
  const fd = await fs.open(dir, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}

export async function assertSdkAvailable(root, ownedSelection) {
  const raw = await readMarker(root);
  if (!raw) return;
  const owner = JSON.parse(raw.bytes);
  if (owner?.kind === 'migration')
    throw Error('SDK inputs are held by a stack migration; inspect its owner operation before changing dependencies');
  if (!owner || owner.kind !== undefined || typeof owner.root !== 'string' || !path.isAbsolute(owner.root))
    throw Error('Invalid SDK ownership marker');
  if (ownedSelection && owner.root === ownedSelection.root && owner.id === ownedSelection.id) return;
  const selection = await sdkTransitionStatus(owner.root);
  if (!selection || selection.id !== owner.id || selection.source !== root ||
      !sdkTransitionSettled(selection.phase))
    throw Error('Shared SDK source has an unfinished selection; recover its consumer before another build: ' + owner.root);
}

export async function clearSdkSelection(root, source, id) {
  const raw = await readMarker(source);
  const owner = raw && JSON.parse(raw.bytes);
  // A selection can never release a migration, even with a supplied matching ID.
  if (owner && owner.kind === undefined && owner.root === root && owner.id === id) {
    await fs.rm(markerPath(source)); await syncDirectory(sdkStatePath(source));
  }
}

/** The caller provides the canonical OperationJournal reader, not a second
 * parser or a copied outcome. SDK commands never release these references. */
export async function withMigrationSdkLocks(workspaces, reference, body) {
  validateMigrationReference(workspaces, reference);
  const root = workspaces[0].root;
  const marker = markerBytes(root, reference);
  const previous = new Map(), held = new Set();
  let closed = false;
  const checkIdentity = async () => {
    if (closed) throw Error('The SDK migration lock has already closed');
    for (const identity of workspaces)
      if (!same(await sdkWorkspaceIdentity(identity.root), identity)) throw Error('SDK workspace identity changed during migration');
  };
  const read = () => readMigrationReceipt(reference);
  const hold = {
    async retain() {
      await checkIdentity();
      const receipt = await read();
      if (!['prepared', 'running'].includes(receipt.state)) throw Error('A new SDK hold requires an admitted migration that has not finished');
      // Old watchers only understand selection IDs. A real selection with the
      // same UUID must not make them mistake this reference for a terminal one.
      if ((await sdkTransitionStatus(root))?.id === reference.id)
        throw Error('Migration ID already belongs to an SDK selection');
      for (const identity of workspaces) {
        if (held.has(identity.root)) {
          if ((await readMarker(identity.root))?.bytes !== marker) throw Error('SDK migration ownership changed');
          continue;
        }
        if ((await readMarker(identity.root))?.bytes !== previous.get(identity.root)?.bytes)
          throw Error('SDK ownership changed before retaining migration inputs');
        // Remember before writing: an fsync acknowledgement can be lost after
        // rename. A known pre-execution failure may still release this exact hold.
        held.add(identity.root);
        await atomicMarker(identity.root, marker);
      }
      for (const identity of workspaces)
        if ((await readMarker(identity.root))?.bytes !== marker) throw Error('SDK migration ownership could not be confirmed');
    },
    async release() {
      await checkIdentity();
      if (!terminal.has((await read()).state)) throw Error('SDK migration inputs remain held until the canonical outcome is terminal');
      // Preflight the complete set before restoring any previous ownership.
      for (const directory of held) {
        const actual = (await readMarker(directory))?.bytes;
        if (actual !== marker && actual !== previous.get(directory)?.bytes) throw Error('SDK migration ownership changed; newer marker preserved');
      }
      for (const directory of held) {
        if ((await readMarker(directory))?.bytes === marker) {
          const prior = previous.get(directory);
          if (prior) await atomicMarker(directory, prior.bytes);
          else { await fs.rm(markerPath(directory)); await syncDirectory(sdkStatePath(directory)); }
        }
      }
      held.clear();
    },
  };
  try {
    return await lockWorkspaces(workspaces, async identity => {
      await assertSdkAvailable(identity.root);
      previous.set(identity.root, await readMarker(identity.root));
    }, () => body(hold));
  }
  finally { closed = true; } // Never infer a durable outcome from callback completion.
}

/** Explicit owner completion after a terminal commit whose cleanup reply was
 * lost. No SQL, no retry, no inferred outcome and no SDK recovery-history edits. */
export async function releaseTerminalMigrationSdk(workspaces, reference) {
  validateMigrationReference(workspaces, reference);
  const requireTerminal = async () => {
    if (!terminal.has((await readMigrationReceipt(reference)).state))
      throw Error('SDK migration inputs remain held until the canonical outcome is terminal');
  };
  await requireTerminal();
  const marker = markerBytes(workspaces[0].root, reference), observed = new Map();
  return lockWorkspaces(workspaces, async identity => {
    const raw = await readMarker(identity.root);
    if (raw?.bytes !== marker) await assertSdkAvailable(identity.root);
    observed.set(identity.root, raw?.bytes);
  }, async () => {
    await requireTerminal();
    for (const identity of workspaces) {
      if (!same(await sdkWorkspaceIdentity(identity.root), identity) ||
          (await readMarker(identity.root))?.bytes !== observed.get(identity.root))
        throw Error('SDK migration ownership changed; newer marker preserved');
    }
    for (const identity of workspaces) if (observed.get(identity.root) === marker) {
      await fs.rm(markerPath(identity.root)); await syncDirectory(sdkStatePath(identity.root));
    }
  });
}
