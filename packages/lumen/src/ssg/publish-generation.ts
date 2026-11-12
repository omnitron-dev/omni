import {
  closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { computeContentHash } from '../manifest/hashing.js';
import { readProcessLifetime, compareProcessLifetimes } from '@omnitron-dev/common/process-identity';

interface PublicationOwner { pid: number; identity: string }

export type StaticFile = string | Uint8Array;
type Inventory = Record<string, { bytes: number; sha256: string }>;
interface Journal {
  protocol: 1;
  id: string;
  target: string;
  stage: string;
  backup: string;
  next: string;
  previous: string | null;
  owner: PublicationOwner;
}
const inventoryFile = '.lumen-generation.json';
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const digestPattern = /^[a-f0-9]{64}$/;
const hash = (value: StaticFile) => computeContentHash(value, 0);
const present = (path: string) => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
const journalPath = (target: string) => join(dirname(target), `.${basename(target)}.lumen-publication.json`);

function safePath(path: string): boolean {
  return Boolean(path) && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
function canonicalTarget(outDir: string): string {
  const target = resolve(outDir);
  if (target === dirname(target)) throw new Error('Cannot publish a site over a filesystem root');
  mkdirSync(dirname(target), { recursive: true });
  return join(realpathSync(dirname(target)), basename(target));
}
function syncPath(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function entries(root: string, prefix = ''): string[] {
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error('Generation must be a real directory');
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Generation contains a symbolic link: ${path}`);
    if (entry.isDirectory()) return entries(join(root, entry.name), `${path}/`);
    if (!entry.isFile()) throw new Error(`Generation contains a special file: ${path}`);
    return [path];
  });
}
function manifestHash(root: string): string | null {
  if (!present(root)) return null;
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error('Output must be a real directory');
  const path = join(root, inventoryFile);
  if (!present(path)) return null;
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Generation inventory must be a regular file');
  return hash(readFileSync(path));
}
/** Verify every byte and refuse unlisted files and symlinks before admitting a generation. */
export function verifyGeneration(root: string): { digest: string; files: Inventory } {
  const digest = manifestHash(root);
  if (!digest) throw new Error('Existing output is not a Lumen generation; select a new output directory');
  const proof = JSON.parse(readFileSync(join(root, inventoryFile), 'utf8'));
  if (proof.generator !== '@omnitron-dev/lumen' || !proof.files || typeof proof.files !== 'object' || Array.isArray(proof.files))
    throw new Error('Output ownership is invalid');
  const files = proof.files as Inventory;
  const actual = entries(root).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...Object.keys(files), inventoryFile].sort()))
    throw new Error('Generation inventory does not match its files');
  for (const [path, item] of Object.entries(files)) {
    if (!safePath(path) || path === inventoryFile || !item || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !digestPattern.test(item.sha256))
      throw new Error(`Invalid generation inventory entry: ${path}`);
    const content = readFileSync(join(root, path));
    if (content.byteLength !== item.bytes || hash(content) !== item.sha256) throw new Error(`Generation file changed: ${path}`);
  }
  return { digest, files };
}
function matches(root: string, expected: string | null): boolean {
  if (!expected || !present(root)) return false;
  try { return verifyGeneration(root).digest === expected; } catch { return false; }
}
function removeOwned(root: string, expected: string): void {
  if (!present(root)) return;
  const files = entries(root);
  // A kill after unlinking the last ownership marker may leave an empty directory.
  // Leave it alone rather than infer ownership from its name.
  if (files.length === 0) return;
  if (manifestHash(root) !== expected) throw new Error('Refusing to remove a generation without matching ownership evidence');
  // Keep the proof until all other children are removed, so interrupted cleanup is resumable.
  for (const entry of readdirSync(root)) if (entry !== inventoryFile) rmSync(join(root, entry), { recursive: true });
  syncPath(root);
  unlinkSync(join(root, inventoryFile));
  rmSync(root, { recursive: true });
  syncPath(dirname(root));
}
function readJournal(target: string): Journal | null {
  const path = journalPath(target);
  if (!present(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('Invalid publication journal file');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as Journal;
  const prefix = `.${basename(target)}-stage-`;
  if (journal.protocol !== 1 || !uuidPattern.test(journal.id) || journal.target !== basename(target) || typeof journal.stage !== 'string' ||
    !journal.stage.startsWith(prefix) || !/^[a-zA-Z0-9]{6}$/.test(journal.stage.slice(prefix.length)) ||
    journal.backup !== `${journal.stage}.previous` || !digestPattern.test(journal.next) ||
    !(journal.previous === null || digestPattern.test(journal.previous)) || !journal.owner ||
    !Number.isSafeInteger(journal.owner.pid) || journal.owner.pid < 1 ||
    typeof journal.owner.identity !== 'string' || compareProcessLifetimes(journal.owner.identity, journal.owner.identity) !== 'same')
    throw new Error('Invalid publication journal contents');
  return journal;
}
function recover(target: string, ownJournalId?: string): 'none' | 'previous' | 'next' {
  const journal = readJournal(target);
  if (!journal) return 'none';
  if (ownJournalId && journal.id !== ownJournalId) throw new Error('Publication journal changed during recovery');
  if (!ownJournalId) {
    const owner = readProcessLifetime(journal.owner.pid);
    if (owner.state === 'unknown') throw new Error('Cannot prove the publication owner has exited');
    if (owner.state === 'alive') {
      const comparison = compareProcessLifetimes(journal.owner.identity, owner.identity);
      if (comparison === 'unknown') throw new Error('Cannot compare the publication owner identity');
      if (comparison === 'same') throw new Error('A live process owns the publication journal');
    }
  }
  const stage = join(dirname(target), journal.stage);
  const backup = join(dirname(target), journal.backup);
  let result: 'previous' | 'next';
  if (matches(target, journal.next)) result = 'next';
  else if (matches(target, journal.previous)) result = 'previous';
  else if (!present(backup) && matches(stage, journal.next) && present(target)) {
    // Another publisher may have completed while this process was preparing its stage.
    // No output rename occurred here: retain that verified tree and discard only our stage.
    verifyGeneration(target);
    result = 'previous';
  } else if (matches(backup, journal.previous)) {
    if (present(target)) removeOwned(target, journal.next);
    renameSync(backup, target);
    syncPath(dirname(target));
    result = 'previous';
  } else if (!present(target) && journal.previous === null && matches(stage, journal.next)) {
    renameSync(stage, target);
    syncPath(dirname(target));
    result = 'next';
  } else throw new Error('No verified generation can recover this publication; existing evidence was retained');
  removeOwned(stage, journal.next);
  if (journal.previous) removeOwned(backup, journal.previous);
  unlinkSync(journalPath(target));
  syncPath(dirname(target));
  return result;
}

/** Called by build and serve before using a directory left by a dead publisher. */
export function recoverGeneration(outDir: string): 'none' | 'previous' | 'next' {
  return recover(canonicalTarget(outDir));
}

/** Staged replacement with a durable recovery journal; not an atomic directory exchange. */
export function publishGeneration(outDir: string, files: ReadonlyMap<string, StaticFile>): string[] {
  const target = canonicalTarget(outDir);
  recover(target);
  const previous = present(target) ? verifyGeneration(target).digest : null;
  const lifetime = readProcessLifetime(process.pid);
  if (lifetime.state !== 'alive') throw new Error('Durable Lumen publication requires a verifiable native process identity (macOS or Linux)');
  const owner: PublicationOwner = { pid: process.pid, identity: lifetime.identity };
  const stage = mkdtempSync(join(dirname(target), `.${basename(target)}-stage-`));
  const backup = `${stage}.previous`;
  const inventory: Inventory = Object.create(null);
  let journalInstalled = false;
  const journalId = randomUUID();
  const prepare = `${journalPath(target)}.prepare-${journalId}`;
  try {
    for (const [path, content] of files) {
      if (!safePath(path)) throw new Error(`Unsafe output path: ${path}`);
      if (path === inventoryFile) throw new Error('Reserved output inventory path');
      const destination = join(stage, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content, { flag: 'wx' });
      syncPath(destination);
      inventory[path] = { bytes: Buffer.byteLength(content), sha256: hash(content) };
    }
    const proof = JSON.stringify({ generator: '@omnitron-dev/lumen', files: inventory }, null, 2);
    writeFileSync(join(stage, inventoryFile), proof, { flag: 'wx' });
    syncPath(join(stage, inventoryFile));
    // Sync nested directory entries before the durable journal can admit their tree.
    const directories = new Set([stage]);
    for (const path of Object.keys(inventory)) {
      let directory = dirname(join(stage, path));
      while (directory !== dirname(stage)) { directories.add(directory); directory = dirname(directory); }
    }
    for (const directory of [...directories].sort((a, b) => b.length - a.length)) syncPath(directory);
    const journal: Journal = { protocol: 1, id: journalId, target: basename(target), stage: basename(stage), backup: basename(backup),
      next: hash(proof), previous, owner };
    writeFileSync(prepare, JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
    syncPath(prepare);
    // Atomic create, never overwrite another publisher's journal with rename().
    linkSync(prepare, journalPath(target));
    journalInstalled = true;
    syncPath(dirname(target));
    unlinkSync(prepare);
    if (present(backup)) throw new Error('Publication backup path already exists');
    if (previous) {
      if (!matches(target, previous)) throw new Error('Output changed while the generation was staged');
      renameSync(target, backup);
      syncPath(dirname(target));
    } else if (present(target)) throw new Error('Output appeared while the generation was staged');
    renameSync(stage, target);
    syncPath(dirname(target));
    recover(target, journalId);
    journalInstalled = false;
    return [...files.keys(), inventoryFile];
  } catch (error) {
    if (journalInstalled) { recover(target, journalId); journalInstalled = false; }
    throw error;
  } finally {
    if (!journalInstalled) rmSync(stage, { recursive: true, force: true });
    if (present(prepare)) unlinkSync(prepare);
  }
}

/** A preview holds one verified generation, independent of later output replacements. */
export function captureGeneration(outDir: string): { directory: string; release: () => void } {
  const target = canonicalTarget(outDir);
  recover(target);
  const generation = verifyGeneration(target);
  const directory = mkdtempSync(join(dirname(target), `.${basename(target)}-preview-`));
  try {
    for (const path of [...Object.keys(generation.files), inventoryFile]) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      linkSync(join(target, path), join(directory, path));
    }
    if (verifyGeneration(target).digest !== generation.digest || verifyGeneration(directory).digest !== generation.digest)
      throw new Error('Generation changed during preview capture; retry after the build completes');
    return { directory, release: () => removeOwned(directory, generation.digest) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
