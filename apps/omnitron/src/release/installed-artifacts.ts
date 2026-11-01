import { constants } from 'node:fs';
import { open, opendir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { OrchestratorControl } from '../orchestrator/execution-contract.js';
import type { InstalledArtifactObservation } from '../shared/dto/installed-release.js';

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_DURATION_MS = 45_000;
const active = new WeakSet<object>();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const stamp = (stat: Awaited<ReturnType<FileHandle['stat']>>) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

async function file<T>(filename: string, maximum: number, read: (handle: FileHandle) => Promise<T>): Promise<T> {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) throw new Error('File is not regular or exceeds the inspection size limit');
    const result = await read(handle);
    if (stamp(before) !== stamp(await handle.stat())) throw new Error('File changed during inspection');
    return result;
  } finally { await handle.close().catch(() => undefined); }
}

async function hash(handle: FileHandle, signal: AbortSignal): Promise<string> {
  const digest = createHash('sha256');
  const { size } = await handle.stat();
  if (size > 0) for await (const chunk of handle.createReadStream({ start: 0, end: size - 1, autoClose: false, signal })) digest.update(chunk);
  return digest.digest('hex');
}

/** Uses the same platform tar as deployment; no shell, extraction or executable archive content. */
async function tar(handle: FileHandle, args: string[], maximum: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['pipe', 'pipe', 'pipe'], signal, timeout: 10_000, killSignal: 'SIGKILL' });
    const input = handle.createReadStream({ start: 0, end: MAX_FILE_BYTES - 1, autoClose: false, signal });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const fail = (error: Error) => { failure ??= error; child.kill('SIGKILL'); input.destroy(); };
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximum) fail(new Error('Archive output exceeds the inspection limit'));
      else chunks.push(chunk);
    });
    // Archive names and local paths must not leak through tar diagnostics to viewers.
    child.stderr.resume();
    child.stdin.on('error', () => undefined);
    input.on('error', fail);
    child.on('error', error => { failure ??= error; });
    child.on('close', code => {
      if (!input.readableEnded) input.destroy();
      if (failure || code !== 0) reject(failure ?? new Error('Archive member could not be read'));
      else resolve(Buffer.concat(chunks));
    });
    input.pipe(child.stdin);
  });
}

async function archiveEntry(handle: FileHandle, relative: string, signal: AbortSignal): Promise<string | null> {
  const names = (await tar(handle, ['-tzf', '-'], 2 * 1024 * 1024, signal)).toString('utf8').split('\n');
  const matches = names.filter(name => name.replace(/^\.\//, '') === relative);
  if (matches.length !== 1) return null; // Missing and duplicate members are not evidence.
  const bytes = await tar(handle, ['-xzOf', '-', '--', matches[0]!], MAX_ENTRY_BYTES, signal);
  return bytes.length ? sha(bytes) : null;
}

async function frameworkCommit(root: string): Promise<string | null> {
  try {
    const entry = createRequire(path.join(root, 'package.json')).resolve('@omnitron-dev/omnitron');
    let directory = path.dirname(await realpath(entry));
    for (let depth = 0; depth < 8; depth++, directory = path.dirname(directory)) {
      const manifest = await file(path.join(directory, 'package.json'), 64 * 1024, h => h.readFile('utf8')).catch(() => null);
      if (!manifest || JSON.parse(manifest).name !== '@omnitron-dev/omnitron') continue;
      const build = JSON.parse(await file(path.join(directory, 'dist', 'BUILD.json'), 64 * 1024, h => h.readFile('utf8'))) as { commit?: unknown; dirty?: unknown };
      return typeof build.commit === 'string' && /^[a-f0-9]{7,40}$/.test(build.commit) && build.dirty === false ? build.commit : null;
    }
  } catch { /* An absent/unreadable stamp is unknown, never this backend's own build. */ }
  return null;
}

function identity(orchestrator: OrchestratorControl, name: string) {
  const handle = orchestrator.getHandle(name);
  if (!handle || handle.name !== name) return null;
  const entry = handle.entry;
  return { pid: handle.pid ?? null, startedAt: handle.startedAt, cwd: entry.cwd, bootstrap: entry.bootstrap, script: entry.script, releaseRoot: entry.releaseRoot };
}

/** Legacy deployment layout locates files only; archive bytes, never this path, identify their release. */
export function installedRoot(name: string, entry: { cwd?: string | undefined; bootstrap?: string | undefined; script?: string | undefined; releaseRoot?: string | undefined }): string {
  if (entry.releaseRoot && path.isAbsolute(entry.releaseRoot)) return entry.releaseRoot;
  const bootstrap = entry.bootstrap ?? entry.script;
  if (!bootstrap) throw new Error('Owner did not report an entry point');
  const [project, , app, extra] = name.split('/');
  if (project && app && !extra && path.isAbsolute(bootstrap) && path.basename(bootstrap) === 'bootstrap.js' && path.basename(path.dirname(bootstrap)) === 'dist') {
    const root = path.dirname(path.dirname(bootstrap));
    const expectedParent = path.join('/opt/omnitron/artifacts', project, app);
    if (path.dirname(root) === expectedParent && /^[a-zA-Z0-9._-]+$/.test(path.basename(root))) return root;
  }
  if (!entry.cwd) throw new Error('Owner did not report an installation root');
  return entry.cwd;
}

/** Names must be exact inventory keys; neither paths nor baselines are accepted from the caller. */
export async function inspectInstalledArtifacts(orchestrator: OrchestratorControl, names: string[]): Promise<InstalledArtifactObservation[]> {
  if (!Array.isArray(names) || names.length < 1 || names.length > 32 || names.some(name => typeof name !== 'string' || name.length > 256)) throw new Error('Provide 1–32 canonical application names');
  if (active.has(orchestrator)) throw new Error('An installed-file inspection is already running on this node');
  active.add(orchestrator);
  const signal = AbortSignal.timeout(MAX_DURATION_MS);
  const results: InstalledArtifactObservation[] = [];
  let bytesRead = 0;
  try {
    await orchestrator.refreshObservation?.();
    for (const name of new Set(names)) {
      const before = identity(orchestrator, name);
      const observation: InstalledArtifactObservation = { app: name, pid: before?.pid ?? null, startedAt: before?.startedAt ?? null,
        observedAt: new Date().toISOString(), state: 'unavailable', entrySha256: null, frameworkCommit: null, archives: [], reasons: [] };
      results.push(observation);
      try {
        signal.throwIfAborted();
        if (!before) throw new Error('Canonical application is absent from the owner inventory');
        if (!(before.bootstrap ?? before.script)) throw new Error('Owner did not report an entry point');
        const root = await realpath(installedRoot(name, before));
        const entry = path.resolve(before.cwd ?? root, before.bootstrap ?? before.script!);
        const relative = path.relative(root, entry);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Entry point is outside its installation root');
        // Reject escaping intermediate symlinks as well as symlink entry files.
        if (await realpath(path.dirname(entry)) !== path.dirname(entry)) throw new Error('Entry point traverses a symbolic link');
        observation.entrySha256 = await file(entry, MAX_ENTRY_BYTES, h => hash(h, signal));
        observation.frameworkCommit = await frameworkCommit(root);
        const archives: string[] = [];
        let entries = 0;
        for await (const item of await opendir(root)) {
          if (++entries > 4096) throw new Error('Installation directory exceeds the inspection entry limit');
          if (item.isFile() && item.name.endsWith('.tar.gz')) archives.push(item.name);
          if (archives.length > 8) throw new Error('Installation directory exceeds the archive inspection limit');
        }
        for (const archive of archives.sort()) {
          signal.throwIfAborted();
          await file(path.join(root, archive), MAX_FILE_BYTES, async handle => {
            const { size } = await handle.stat();
            bytesRead += size;
            if (bytesRead > MAX_TOTAL_BYTES) throw new Error('Node inspection exceeds the archive byte budget');
            const sha256 = await hash(handle, signal);
            const entrySha256 = await archiveEntry(handle, relative.split(path.sep).join('/'), signal);
            observation.archives.push({ sha256, bytes: size, entrySha256 });
          });
        }
        observation.state = 'observed';
        if (!archives.length) observation.reasons.push('No retained release archive exists in the installation directory');
        if (!observation.frameworkCommit) observation.reasons.push('Installed framework has no clean, readable build stamp');
      } catch (error) {
        // Filesystem errors include paths. Return a controlled category, never config/env/path values.
        const message = error instanceof Error ? error.message : '';
        observation.reasons.push(/^(Canonical|Owner|Entry point|Installation directory|Node inspection|File |Archive |The operation was aborted)/.test(message) ? message : 'Installed files could not be read within the inspection limits');
        observation.archives = [];
      }
      await orchestrator.refreshObservation?.();
      if (JSON.stringify(before) !== JSON.stringify(identity(orchestrator, name))) {
        observation.state = 'changed-during-inspection';
        observation.archives = [];
        observation.entrySha256 = null;
        observation.reasons.push('Owner PID, start time or entry changed during inspection; repeat the inspection');
      }
    }
    return results;
  } finally { active.delete(orchestrator); }
}
