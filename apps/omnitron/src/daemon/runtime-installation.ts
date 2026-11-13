import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
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
  /** A management-capable release remains available even after rollback to a legacy backend. */
  bootstrap: string | null;
  selectedAt: string;
}

interface InstallationLease { token: string; pid: number; acquiredAt: string }
export interface ReviewedRecoveryHold {
  planId: string;
  planFile: string;
  /** Stable supervisor transition intent digest, not mutable plan-file bytes. */
  planSha256: string;
  phase: 'held' | 'applying' | 'unconfirmed';
  checkpoint?: string;
}
export interface RuntimeActivation {
  candidate: string; previous: string; checkpoint: string; startedAt: string;
  reviewedRecovery?: ReviewedRecoveryHold;
}
const HASH = /^[a-f0-9]{64}$/;

async function privateDirectory(directory: string, create: boolean): Promise<void> {
  if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
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
  private inspection?: ReturnType<typeof openSqliteDatabase>;

  private constructor(readonly home: string) {
    this.directory = path.join(home, 'runtime');
    this.releases = path.join(this.directory, 'releases');
    this.store = new DaemonStateStore(createNullLogger(), path.join(this.directory, 'state.db'));
  }

  static async open(home = OMNITRON_HOME, options: { existing?: boolean; readOnly?: boolean } = {}): Promise<RuntimeInstallation | null> {
    if (!path.isAbsolute(home)) throw new Error('Runtime installation requires an absolute instance directory');
    const installation = new RuntimeInstallation(path.resolve(home));
    if (options.existing || options.readOnly) {
      try { await fs.lstat(installation.store.dbPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }
    await privateDirectory(installation.directory, !options.readOnly);
    await privateDirectory(installation.releases, !options.readOnly);
    // Do not follow an operator-supplied database link, including SQLite sidecars.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        const stat = await fs.lstat(installation.store.dbPath + suffix);
        if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
            (process.getuid && stat.uid !== process.getuid())) throw new Error('Runtime registry must be a private regular file');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (options.readOnly) installation.inspection = openSqliteDatabase(installation.store.dbPath, { readonly: true, fileMustExist: true });
    else installation.store.initSync().pragma('synchronous = FULL');
    return installation;
  }

  /** No schema initialization or writer lease. SQLite may coordinate readers through WAL/SHM sidecars. */
  static openReadOnly(home = OMNITRON_HOME): Promise<RuntimeInstallation | null> {
    return RuntimeInstallation.open(home, { readOnly: true });
  }

  private read<T extends object>(key: string): T | null {
    const row = (this.inspection ?? this.store.initSync()).prepare('SELECT value FROM state_kv WHERE key = ?').get(key) as { value: string } | undefined;
    // Invalid state is never interpreted as an empty installation.
    if (!row) return null;
    const value: unknown = JSON.parse(row.value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid runtime registry record: ' + key);
    return value as T;
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
    const hold = value?.reviewedRecovery;
    if (hold !== undefined && (!hold || !/^[a-f0-9-]{36}$/.test(hold.planId) || !HASH.test(hold.planSha256) ||
        hold.planFile !== path.join(this.directory, `supervisor-transition-${hold.planId}.json`) ||
        !['held', 'applying', 'unconfirmed'].includes(hold.phase) ||
        (hold.checkpoint !== undefined && !path.isAbsolute(hold.checkpoint)))) {
      throw new Error('Invalid reviewed recovery hold; automatic startup is refused');
    }
    return value;
  }

  /** Approved native transition pins its reviewed intent before stopping the old guardian. */
  holdReviewedRecovery(expectedActivation: RuntimeActivation, expectedSelection: RuntimeSelection,
    plan: Pick<ReviewedRecoveryHold, 'planId' | 'planFile' | 'planSha256'>): void {
    if (!this.lease || expectedActivation.reviewedRecovery || !/^[a-f0-9-]{36}$/.test(plan.planId) ||
        !HASH.test(plan.planSha256) || plan.planFile !== path.join(this.directory, `supervisor-transition-${plan.planId}.json`)) {
      throw new Error('Reviewed recovery requires a leased, validated native transition');
    }
    this.store.initSync().transaction(() => {
      const actual = this.activation();
      if (!actual || JSON.stringify(this.selection()) !== JSON.stringify(expectedSelection)) throw Error('Runtime selection changed before reviewed recovery');
      const { reviewedRecovery, ...original } = actual;
      if (JSON.stringify(original) !== JSON.stringify(expectedActivation)) throw Error('Runtime activation changed before reviewed recovery');
      if (reviewedRecovery) {
        if (reviewedRecovery.phase === 'held' && reviewedRecovery.planId === plan.planId &&
            reviewedRecovery.planFile === plan.planFile && reviewedRecovery.planSha256 === plan.planSha256) return;
        throw Error('Another reviewed recovery already owns the runtime activation');
      }
      this.store.kvSetSync('runtime.activation', { ...original, reviewedRecovery: { ...plan, phase: 'held' } });
    }).immediate();
  }

  /** A failed or interrupted attempt stays held; it can never become an automatic retry. */
  advanceReviewedRecovery(expected: ReviewedRecoveryHold, next: { phase: 'applying' | 'unconfirmed'; checkpoint?: string }): ReviewedRecoveryHold {
    if (!this.lease || (next.checkpoint !== undefined && !path.isAbsolute(next.checkpoint)) ||
        (expected.checkpoint !== undefined && next.checkpoint !== undefined && expected.checkpoint !== next.checkpoint) ||
        !(expected.phase === 'held' && next.phase === 'applying' || expected.phase === 'applying' && ['applying', 'unconfirmed'].includes(next.phase))) {
      throw Error('Invalid reviewed recovery transition');
    }
    return this.store.initSync().transaction(() => {
      const activation = this.activation();
      if (!activation || JSON.stringify(activation.reviewedRecovery) !== JSON.stringify(expected)) throw Error('Reviewed recovery hold changed');
      const hold = { ...expected, ...next };
      this.store.kvSetSync('runtime.activation', { ...activation, reviewedRecovery: hold });
      return hold;
    }).immediate();
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
    if (this.activation()?.reviewedRecovery) throw Error('Reviewed recovery cannot be discarded by ordinary activation rollback');
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

  /** A passive observer cannot recover an abandoned lease or imply that a pending activation is settled. */
  settledSelection(): RuntimeSelection;
  settledSelection(options: { allowEmpty: true }): RuntimeSelection | null;
  settledSelection(options?: { allowEmpty: true }): RuntimeSelection | null {
    const db = this.inspection ?? this.store.initSync();
    const read = () => {
      if (db.prepare("SELECT 1 FROM state_kv WHERE key IN ('runtime.lease','runtime.activation') LIMIT 1").get()) {
        throw Error('The runtime registry has an unsettled lease or activation');
      }
      const selection = this.selection();
      if (!selection && !options?.allowEmpty) throw Error('No runtime has been selected');
      return selection;
    };
    return db.transaction(read).deferred();
  }

  private assertAvailable(): void {
    const previous = this.read<InstallationLease>('runtime.lease');
    if (previous && (!Number.isSafeInteger(previous.pid) || previous.pid < 1 || !previous.token || PidManager.isProcessAlive(previous.pid))) {
      throw new Error(`Another runtime operation holds the installation lease (PID ${previous.pid}); no activation performed`);
    }
  }

  /** Exclusive across CLI processes; SQLite releases its own write lock even after SIGKILL. */
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.inspection) throw new Error('A read-only runtime inspection cannot claim the installation lease');
    if (this.lease) throw new Error('Runtime operation is already in progress');
    const lease = { token: randomUUID(), pid: process.pid, acquiredAt: new Date().toISOString() };
    this.store.initSync().transaction(() => {
      this.assertAvailable();
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
    const sourceRoot = path.resolve(source);
    if (path.dirname(sourceRoot) === this.releases) {
      // Installed directories are addressed by their pinned digest. Use the
      // same verification as cold start before running their preflight.
      return this.artifact(path.basename(sourceRoot));
    }
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

  async select(id: string, expectedRevision: number, promoteManagement = false,
    reviewedRecovery?: { hold: ReviewedRecoveryHold; selection: RuntimeSelection; activation: RuntimeActivation; beforeCommit: () => Promise<void> }): Promise<RuntimeSelection> {
    if (!this.lease) throw new Error('Runtime selection requires an exclusive operation');
    if (this.activation()?.reviewedRecovery && !reviewedRecovery) throw Error('Runtime selection is held for reviewed recovery');
    const artifact = await this.artifact(id);
    let hasLauncher = false;
    try { hasLauncher = (await fs.lstat(path.join(artifact.directory, 'cli/installed.js'))).isFile(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await reviewedRecovery?.beforeCommit();
    return this.store.initSync().transaction(() => {
      const previous = this.selection();
      if ((previous?.revision ?? 0) !== expectedRevision) throw new Error('Runtime selection changed; review the active installation before retrying');
      const activation = this.activation();
      if (reviewedRecovery) {
        const { reviewedRecovery: held, ...original } = activation ?? {};
        if (!activation || reviewedRecovery.hold.phase !== 'applying' || JSON.stringify(held) !== JSON.stringify(reviewedRecovery.hold) ||
            JSON.stringify(previous) !== JSON.stringify(reviewedRecovery.selection) || JSON.stringify(original) !== JSON.stringify(reviewedRecovery.activation) ||
            id !== activation.previous) throw Error('Reviewed recovery requires its exact held attempt before selecting the previous runtime');
      } else if (activation?.reviewedRecovery) throw Error('Runtime selection is held for reviewed recovery');
      if (activation && id !== activation.candidate && id !== activation.previous) throw new Error('The selected release does not belong to the pending activation');
      const value: RuntimeSelection = {
        protocol: 1, revision: expectedRevision + 1, current: id,
        previous: previous?.current === id ? previous.previous : previous?.current ?? null,
        bootstrap: promoteManagement && hasLauncher ? id : previous?.bootstrap ?? (hasLauncher ? id : null), selectedAt: new Date().toISOString(),
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

  async close(): Promise<void> {
    if (this.inspection) this.inspection.close();
    else await this.store.dispose();
  }
}

/** Resolving a startup always revalidates Node, backend and the entire dependency closure. */
export async function selectedBackend(home = OMNITRON_HOME, purpose: 'startup' | 'control' | 'management' = 'startup'): Promise<BackendArtifact | null> {
  const installation = await RuntimeInstallation.open(home, { existing: true });
  if (!installation) return null;
  try {
    const activation = installation.activation();
    if (activation && purpose === 'startup') throw new Error(`Runtime activation is unfinished. Inspect and recover its checkpoint before cold start: ${activation.checkpoint}`);
    const selection = installation.selection();
    if (!selection) return null;
    if (activation && purpose !== 'startup') return await installation.artifact(selection.bootstrap ?? selection.current);
    const current = await installation.artifact(selection.current);
    if (purpose === 'management' && selection.bootstrap) {
      try { await fs.access(path.join(current.directory, 'cli/installed.js')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return await installation.artifact(selection.bootstrap);
      }
    }
    return current;
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
