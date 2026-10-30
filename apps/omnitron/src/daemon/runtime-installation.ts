import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { OMNITRON_HOME } from '../config/defaults.js';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';
import { DaemonStateStore } from './daemon-state-store.service.js';
import { checkBackendCandidate, type BackendArtifact } from './backend-candidate.js';
import { PidManager } from './pid-manager.js';
import { writePrivateFile } from './execution-journal.js';

export interface RuntimeSelection {
  protocol: 1;
  revision: number;
  current: string;
  previous: string | null;
  /** The launcher itself stays pinned; changing the backend never removes it. */
  bootstrap: string | null;
  selectedAt: string;
}

interface InstallationLease { token: string; pid: number; acquiredAt: string }
export interface RuntimeActivation { candidate: string; previous: string; checkpoint: string; startedAt: string }
const HASH = /^[a-f0-9]{64}$/;

async function privateDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) {
    throw new Error(`Runtime directory must be private and owned by this user: ${directory}`);
  }
}

/** One local, transactional startup selector, independent of PostgreSQL and the running daemon. */
export class RuntimeInstallation {
  readonly directory: string;
  readonly releases: string;
  private readonly store: DaemonStateStore;
  private lease: InstallationLease | null = null;

  private constructor(readonly home: string) {
    this.directory = path.join(home, 'runtime');
    this.releases = path.join(this.directory, 'releases');
    this.store = new DaemonStateStore(createNullLogger(), path.join(this.directory, 'state.db'));
  }

  static async open(home = OMNITRON_HOME, options: { existing?: boolean } = {}): Promise<RuntimeInstallation | null> {
    if (!path.isAbsolute(home)) throw new Error('Runtime installation requires an absolute instance directory');
    const installation = new RuntimeInstallation(path.resolve(home));
    if (options.existing) {
      try { await fs.lstat(installation.store.dbPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }
    await privateDirectory(installation.directory);
    await privateDirectory(installation.releases);
    // Do not follow an operator-supplied database link, including SQLite sidecars.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        const stat = await fs.lstat(installation.store.dbPath + suffix);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
            (process.getuid && stat.uid !== process.getuid())) throw new Error('Runtime registry must be a private regular file');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    installation.store.initSync().pragma('synchronous = FULL');
    return installation;
  }

  private read<T>(key: string): T | null {
    const row = this.store.initSync().prepare('SELECT value FROM state_kv WHERE key = ?').get(key) as { value: string } | undefined;
    // Invalid state is never interpreted as an empty installation.
    return row ? JSON.parse(row.value) as T : null;
  }

  selection(): RuntimeSelection | null {
    const value = this.read<RuntimeSelection>('runtime.selection');
    if (!value) return null;
    if (value.protocol !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        !HASH.test(value.current) || (value.bootstrap !== null && !HASH.test(value.bootstrap)) ||
        (value.previous !== null && !HASH.test(value.previous)) || !Number.isFinite(Date.parse(value.selectedAt))) {
      throw new Error('Invalid runtime selection; cold start is refused');
    }
    return value;
  }

  releasePath(id: string): string {
    if (!HASH.test(id)) throw new Error('A complete runtime SHA-256 is required');
    return path.join(this.releases, id);
  }

  activation(): RuntimeActivation | null {
    const value = this.read<RuntimeActivation>('runtime.activation');
    if (value && (!HASH.test(value.candidate) || !HASH.test(value.previous) ||
        typeof value.checkpoint !== 'string' || !path.isAbsolute(value.checkpoint) || !Number.isFinite(Date.parse(value.startedAt)))) {
      throw new Error('Invalid runtime activation journal; automatic startup is refused');
    }
    return value;
  }

  beginActivation(candidate: string, previous: string, checkpoint: string): void {
    if (!this.lease || !HASH.test(candidate) || !HASH.test(previous) || !path.isAbsolute(checkpoint)) {
      throw new Error('A leased activation and validated release identities are required');
    }
    if (this.activation()) throw new Error('A runtime activation is unfinished; inspect its checkpoint before another upgrade');
    this.store.kvSetSync('runtime.activation', { candidate, previous, checkpoint, startedAt: new Date().toISOString() });
  }

  abortActivation(): void {
    if (!this.lease) throw new Error('Aborting activation requires the installation lease');
    this.store.kvDeleteSync('runtime.activation');
  }

  async artifact(id: string): Promise<BackendArtifact> {
    const root = this.releasePath(id);
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Installed runtime cannot be a symbolic link');
    const artifact = await checkBackendCandidate(path.join(root, 'packages/0/dist'), undefined, id);
    if (artifact.runtimeHash !== id) throw new Error('Installed runtime content does not match its identity');
    return artifact;
  }

  /** Exclusive across CLI processes; SQLite releases its own write lock even after SIGKILL. */
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.lease) throw new Error('Runtime operation is already in progress');
    const lease = { token: randomUUID(), pid: process.pid, acquiredAt: new Date().toISOString() };
    this.store.initSync().transaction(() => {
      const previous = this.read<InstallationLease>('runtime.lease');
      if (previous && (!Number.isSafeInteger(previous.pid) || previous.pid < 1 || !previous.token || PidManager.isProcessAlive(previous.pid))) {
        throw new Error(`Another runtime operation holds the installation lease (PID ${previous.pid}); no activation performed`);
      }
      this.store.kvSetSync('runtime.lease', lease);
    }).immediate();
    this.lease = lease;
    try { return await operation(); }
    finally {
      this.store.initSync().transaction(() => {
        if (this.read<InstallationLease>('runtime.lease')?.token !== lease.token) throw new Error('Runtime lease changed unexpectedly');
        this.store.kvDeleteSync('runtime.lease');
      }).immediate();
      this.lease = null;
    }
  }

  /** Copies only a prebuilt, sealed dependency closure. Never moves or rewrites a live release. */
  async install(source: string): Promise<BackendArtifact> {
    if (!this.lease) throw new Error('Runtime installation requires an exclusive operation');
    const candidate = await checkBackendCandidate(path.join(source, 'packages/0/dist'));
    const destination = this.releasePath(candidate.runtimeHash);
    try {
      await fs.lstat(destination);
      return await this.artifact(candidate.runtimeHash);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const staging = path.join(this.releases, `.install-${this.lease.token}`);
    try {
      await fs.cp(candidate.runtimeRoot, staging, {
        recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true,
        mode: constants.COPYFILE_FICLONE,
      });
      await verifyRuntimeArtifact(staging, candidate.runtimeHash);
      // Flush every copied regular file before publishing the directory and its selector.
      const syncTree = async (directory: string): Promise<void> => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await syncTree(file);
          else if (entry.isFile()) {
            const handle = await fs.open(file, 'r');
            try { await handle.sync(); } finally { await handle.close(); }
          }
        }
        const handle = await fs.open(directory, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
      };
      await syncTree(staging);
      await fs.rename(staging, destination);
      const parent = await fs.open(this.releases, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
      return await this.artifact(candidate.runtimeHash);
    } finally {
      // Only this operation's unpublished staging tree is disposable.
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async select(id: string, expectedRevision: number): Promise<RuntimeSelection> {
    if (!this.lease) throw new Error('Runtime selection requires an exclusive operation');
    await this.artifact(id);
    return this.store.initSync().transaction(() => {
      const previous = this.selection();
      if ((previous?.revision ?? 0) !== expectedRevision) throw new Error('Runtime selection changed; review the active installation before retrying');
      const activation = this.activation();
      if (activation && id !== activation.candidate && id !== activation.previous) throw new Error('The selected release does not belong to the pending activation');
      const value: RuntimeSelection = {
        protocol: 1, revision: expectedRevision + 1, current: id,
        previous: previous?.current === id ? previous.previous : previous?.current ?? null,
        bootstrap: previous?.bootstrap ?? null, selectedAt: new Date().toISOString(),
      };
      this.store.kvSetSync('runtime.selection', value);
      this.store.kvDeleteSync('runtime.activation');
      return value;
    }).immediate();
  }

  /** A stable entry point whose bootstrap release is retained independently of backend selection. */
  async writeLauncher(initialBootstrap?: string): Promise<string> {
    if (!this.lease) throw new Error('Launcher installation requires an exclusive operation');
    const selection = this.selection();
    if (!selection) throw new Error('Select a runtime before installing its launcher');
    const bootstrap = selection.bootstrap ?? initialBootstrap ?? selection.current;
    const artifact = await this.artifact(bootstrap);
    const entry = path.join(artifact.directory, 'cli/installed.js');
    await fs.access(entry);
    if (!selection.bootstrap) this.store.kvSetSync('runtime.selection', { ...selection, bootstrap });
    const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
    const launcher = path.join(this.directory, 'bin/omnitron');
    await writePrivateFile(launcher, `#!/bin/sh\nexport OMNITRON_HOME=${quote(this.home)}\nexec ${quote(artifact.execPath)} ${quote(entry)} "$@"\n`, 0o700);
    return launcher;
  }

  async close(): Promise<void> { await this.store.dispose(); }
}

/** Resolving a startup always revalidates Node, backend and the entire dependency closure. */
export async function selectedBackend(home = OMNITRON_HOME, purpose: 'startup' | 'control' = 'startup'): Promise<BackendArtifact | null> {
  const installation = await RuntimeInstallation.open(home, { existing: true });
  if (!installation) return null;
  try {
    const activation = installation.activation();
    if (activation && purpose === 'startup') throw new Error(`Runtime activation is unfinished. Inspect and recover its checkpoint before cold start: ${activation.checkpoint}`);
    const selection = installation.selection();
    return selection ? await installation.artifact(activation && purpose === 'control' ? selection.bootstrap ?? selection.current : selection.current) : null;
  } finally { await installation.close(); }
}

/** Startup and version selection share a lease, closing the PID-file creation race. */
export async function withRuntimeStartup<T>(directory: string, start: () => Promise<T>): Promise<T> {
  const installation = await RuntimeInstallation.open(undefined, { existing: true });
  if (!installation) return start();
  try { return await installation.exclusive(async () => {
    if (installation.activation()) throw new Error('Runtime activation is unfinished; recover its checkpoint before starting');
    const selection = installation.selection();
    if (selection) {
      const root = installation.releasePath(selection.current);
      if (await fs.realpath(directory) !== path.join(root, 'packages/0/dist') ||
          await fs.realpath(process.execPath) !== path.join(root, 'node')) {
        throw new Error('Runtime selection changed before startup; retry through the installed launcher');
      }
    }
    return start();
  }); } finally { await installation.close(); }
}
