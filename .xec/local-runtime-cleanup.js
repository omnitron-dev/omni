import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withKernelFileLock } from '@xec-sh/ops/utils/file-lock';
import { releaseCommand } from '@xec-sh/ops/release';
import { readPrivateRecord, writePrivateRecord } from '../apps/omnitron/src/daemon/execution-journal.ts';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const states = ['building', 'queued', 'removing', 'failed', 'cleaned'];
const registry = base => path.join(base, '.runtime-workspaces');
const stat = file => fs.lstat(file, { bigint: true }).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });

export async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function privateDirectory(directory) {
  const info = await stat(directory);
  if (!info?.isDirectory() || (info.mode & 0o077n) !== 0n || process.getuid && info.uid !== BigInt(process.getuid()) ||
      await fs.realpath(directory) !== directory) throw Error('Invalid private runtime workspace directory: ' + directory);
  return info;
}

export async function physicalCache(requested, create = false) {
  if (create) await fs.mkdir(requested, { recursive: true, mode: 0o700 });
  const info = await stat(requested);
  if (!info && !create) return requested;
  if (!info?.isDirectory() || (info.mode & 0o077n) !== 0n || process.getuid && info.uid !== BigInt(process.getuid()))
    throw Error('Local runtime cache must be a private physical directory owned by this user');
  return fs.realpath(requested);
}

async function readJob(queue, id) {
  if (!uuid.test(id)) throw Error('Invalid runtime workspace identity');
  const directory = path.join(queue, id);
  await privateDirectory(directory);
  const job = await readPrivateRecord(path.join(directory, 'job.json'));
  if (job && (job.protocol !== 1 || job.id !== id || !/^[a-f0-9]{40}$/.test(job.revision) ||
      !/^\d+$/.test(job.device) || !/^\d+$/.test(job.inode) || !states.includes(job.state) ||
      !Number.isSafeInteger(job.attempts) || job.attempts < 0)) throw Error('Invalid runtime workspace receipt: ' + id);
  return job;
}

/** Only the producer holds this job's kernel lock while the checkout can still be written. */
export async function buildInWorkspace(base, revision, onJob, build, progress) {
  const queue = registry(base);
  await fs.mkdir(queue, { recursive: true, mode: 0o700 });
  await privateDirectory(queue);
  const id = randomUUID(), directory = path.join(queue, id);
  await fs.mkdir(directory, { mode: 0o700 });
  return withKernelFileLock(path.join(directory, 'job.lock'), async () => {
    const tree = path.join(directory, 'tree');
    await fs.mkdir(tree, { mode: 0o700 });
    const info = await privateDirectory(tree);
    const file = path.join(directory, 'job.json');
    const job = { protocol: 1, id, revision, device: String(info.dev), inode: String(info.ino), state: 'building', attempts: 0 };
    await writePrivateRecord(file, job);
    await syncDirectory(queue);
    await syncDirectory(base);
    onJob(id);
    try { return await build(tree); }
    finally {
      // With the producer gone, a still-building receipt can also be reclaimed by acquiring this same lock.
      try { await writePrivateRecord(file, { ...job, state: 'queued' }); }
      catch (error) { progress('Workspace ' + id + ' retained its building receipt: ' + error.message); }
    }
  });
}

const busyLock = error => /^Kernel lock was not acquired \(exit (?:1|75)\):/.test(error.message);

/** Recursive removal is confined to the recorded inode beneath the private job directory. Its receipt survives partial removal. */
export async function cleanWorkspace(base, id, run = releaseCommand, wait = 0, signal) {
  const queue = registry(base);
  await privateDirectory(queue);
  await readJob(queue, id);
  const directory = path.join(queue, id), file = path.join(directory, 'job.json'), tree = path.join(directory, 'tree');
  let entered = false;
  try {
    return await withKernelFileLock(path.join(directory, 'job.lock'), async () => {
      entered = true;
      const job = await readJob(queue, id);
      if (!job || job.state === 'cleaned') return job;
      const next = { ...job, state: 'removing', attempts: job.attempts + 1 };
      delete next.error;
      try {
        // A tree absent after a crash between successful removal and recording completion is already clean.
        const info = await stat(tree);
        if (info) {
          if (!info.isDirectory() || String(info.dev) !== job.device || String(info.ino) !== job.inode ||
              await fs.realpath(tree) !== tree) throw Error('The build workspace was replaced: ' + id);
          await writePrivateRecord(file, next);
          await run(directory, '/bin/rm', ['-rf', '--', tree], { timeoutMs: 5 * 60_000, ...(signal && { signal }) });
          if (await stat(tree)) throw Error('Build workspace removal is unconfirmed: ' + id);
        }
        next.state = 'cleaned';
      } catch (error) {
        next.state = 'failed';
        next.error = error.message;
      }
      await writePrivateRecord(file, next);
      return next;
    }, wait);
  } catch (error) {
    if (!entered && !wait && busyLock(error)) return { id, state: 'busy' };
    throw error;
  }
}

async function inspectJobs(queue) {
  if (!await stat(queue)) return [];
  await privateDirectory(queue);
  const jobs = [];
  for (const id of (await fs.readdir(queue)).filter(name => uuid.test(name)).sort()) {
    try {
      const job = await readJob(queue, id);
      if (job) jobs.push(job);
    } catch (error) { jobs.push({ id, state: 'invalid', error: error.message }); }
  }
  return jobs;
}

export async function localCleanup(base, { status = false, run = releaseCommand, signal, waitForWorker = 0 } = {}) {
  const queue = registry(base);
  let jobs = await inspectJobs(queue);
  if (status || !jobs.some(job => job.state !== 'cleaned' && job.state !== 'invalid')) return { cache: base, jobs };
  let entered = false;
  try {
    await withKernelFileLock(path.join(queue, 'cleanup.lock'), async () => {
      entered = true;
      const attempted = new Set();
      for (;;) {
        jobs = await inspectJobs(queue);
        const pending = jobs.filter(job => !['cleaned', 'invalid'].includes(job.state) && !attempted.has(job.id));
        if (!pending.length) break;
        for (const job of pending) {
          attempted.add(job.id);
          signal?.throwIfAborted();
          await cleanWorkspace(base, job.id, run, 0, signal);
        }
      }
    }, waitForWorker);
  } catch (error) {
    if (!entered && busyLock(error)) return { cache: base, busy: true, jobs };
    throw error;
  }
  return { cache: base, jobs };
}

/** The worker runs from this checkout so its module and Xec dependencies share the project package boundary. */
export async function scheduleLocalCleanup(base, newJob) {
  if (!await stat(registry(base))) return;
  const args = ['--import=tsx/esm', fileURLToPath(import.meta.url), base];
  if (newJob) args.push(newJob);
  const worker = spawn(process.execPath, args, {
    cwd: fileURLToPath(new URL('../', import.meta.url)), detached: true, stdio: 'ignore',
  });
  await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('spawn', resolve); });
  worker.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const base = process.argv[2];
  if (!base || !path.isAbsolute(base)) throw Error('A private runtime cache is required');
  const newJob = process.argv[3];
  if (newJob && !uuid.test(newJob)) throw Error('Invalid published workspace identity');
  // A newly registered job can arrive as the older worker finishes its final scan.
  // Its own worker waits for that sweep, independently of the command which published it.
  const result = await localCleanup(base, { waitForWorker: newJob ? 360 : 0 });
  if (result.jobs.some(job => ['failed', 'invalid'].includes(job.state))) process.exitCode = 1;
}
