import { randomUUID } from 'node:crypto';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import type { AuthContext } from '@omnitron-dev/titan/netron/auth';
import { ADMIN_ROLES } from '../shared/roles.js';
import { daemonPrincipal } from '../services/daemon-principal.js';
import { runWithAuth } from '../services/auth-context.js';
import type { AuthService } from '../services/auth.service.js';
import type { AuditService } from '../services/audit.service.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type {
  FileNodeRequest,
  FileLocation,
  FileEntry,
  FileListing,
  FileDocument,
  FileRoot,
  FileChunk,
  FileUpload,
  FileTrash,
  FileCopyRequest,
  FileTransfer,
  IOmnitronFilesService,
} from '../shared/dto/files.js';
import { filePath, FILE_LIMITS, type FileNode } from './file-node.js';

export type FileNodeCall = (nodeId: string, actor: string, request: FileNodeRequest) => Promise<unknown>;
type Store = Pick<DaemonStateStore, 'kvGetSync' | 'kvSetSync' | 'kvDeleteSync'>;
type Plan = Array<{ source: FileLocation; destination: FileLocation; entry: FileEntry }>;
interface Job {
  view: FileTransfer;
  cursor: number;
  upload?: string;
  committedBytes: number;
}
const activeStates = new Set(['planning', 'running']);
const join = (a: string, b: string) => (a ? `${a}/${b}` : b);
const same = (a: FileLocation, b: FileLocation) => a.nodeId === b.nodeId && a.rootId === b.rootId;
function location(data: FileLocation): FileLocation {
  if (
    !data ||
    typeof data.nodeId !== 'string' ||
    !/^[\w.-]{1,100}$/.test(data.nodeId) ||
    typeof data.rootId !== 'string' ||
    !/^[\w-]{1,64}$/.test(data.rootId)
  )
    throw new Error('Select a registered node and file root');
  return { nodeId: data.nodeId, rootId: data.rootId, path: filePath(data.path) };
}

/** Shared Console/CLI file API. File contents are administrative data, not a viewer capability. */
@Service({ name: 'OmnitronFiles' })
export class FilesRpcService implements IOmnitronFilesService {
  private jobs = new Map<string, Job>();
  private active = new Map<string, { stop?: 'paused' | 'cancelled'; done: Promise<void> }>();
  private stopped = false;
  constructor(
    private readonly local: FileNode,
    private readonly remote: FileNodeCall,
    private readonly auth: Pick<AuthService, 'validateSession'>,
    private readonly audit: Pick<AuditService, 'record'>,
    private readonly store: Store
  ) {
    for (const id of this.store.kvGetSync<string[]>('files:jobs:index') ?? []) {
      const job = this.store.kvGetSync<Job>(`files:job:${id}`);
      if (!job) continue;
      if (activeStates.has(job.view.state)) {
        job.view.state = 'interrupted';
        job.view.error = 'Daemon stopped before completion. Resume explicitly to reconcile the destination receipt.';
        this.persist(job);
      }
      this.jobs.set(id, job);
    }
  }
  private async owner(action?: string, resource?: unknown) {
    if (this.stopped) throw new Error('File workspace is stopping');
    const principal = await daemonPrincipal(this.auth, 'admin');
    if (action)
      await this.audit.record(
        { action: `files.${action}`, resourceType: 'file', details: { location: resource } },
        true
      );
    return principal.context;
  }
  private call<T>(nodeId: string, owner: AuthContext, request: FileNodeRequest): Promise<T> {
    return (
      nodeId === 'local' ? this.local.invoke(owner.userId!, request) : this.remote(nodeId, owner.userId!, request)
    ) as Promise<T>;
  }
  private async request<T>(data: FileLocation, op: FileNodeRequest, action?: string): Promise<T> {
    const ref = location(data),
      owner = await this.owner(action, ref);
    return this.call<T>(ref.nodeId, owner, op);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async roots(data: { nodeId: string }): Promise<{ protocol: 1; roots: FileRoot[] }> {
    location({ ...data, rootId: 'probe', path: '' });
    return this.call(data.nodeId, await this.owner(), { op: 'roots' });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  list(data: FileLocation & { after?: string; revision?: string }): Promise<FileListing> {
    return this.request(data, { ...data, op: 'list' });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  stat(data: FileLocation): Promise<FileEntry> {
    return this.request(data, { ...data, op: 'stat' });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  readText(data: FileLocation): Promise<FileDocument> {
    return this.request(data, { ...data, op: 'readText' }, 'read');
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  readChunk(data: FileLocation & { version: string; offset: number }): Promise<FileChunk> {
    return this.request(data, { ...data, op: 'readChunk' }, data.offset === 0 ? 'download' : undefined);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  saveText(data: FileLocation & { content: string; version: string | null; bom?: boolean }): Promise<FileDocument> {
    return this.request(data, { ...data, op: 'saveText' }, 'save.requested');
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  mkdir(data: FileLocation): Promise<FileEntry> {
    return this.request(data, { ...data, op: 'mkdir' }, 'mkdir.requested');
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  rename(data: FileLocation & { destination: string; version: string }): Promise<FileEntry> {
    return this.request(data, { ...data, op: 'rename' }, 'rename.requested');
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  trash(data: FileLocation & { version: string }): Promise<FileTrash> {
    return this.request(data, { ...data, op: 'trash' }, 'trash.requested');
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async trashList(data: { nodeId: string; rootId: string }): Promise<FileTrash[]> {
    return this.request({ ...data, path: '' }, { ...data, op: 'trashList' });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async restore(data: { nodeId: string; id: string }): Promise<FileTrash> {
    return this.call(data.nodeId, await this.owner('restore.requested', data), { op: 'restore', id: data.id });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  beginUpload(data: FileLocation & { size: number; id?: string }): Promise<FileUpload> {
    return this.request(data, { ...data, op: 'beginWrite' }, 'upload.requested');
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async uploadChunk(data: {
    nodeId: string;
    id: string;
    offset: number;
    data: string;
    sha256: string;
  }): Promise<FileUpload> {
    return this.call(data.nodeId, await this.owner(), { ...data, op: 'writeChunk' });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async uploadStatus(data: { nodeId: string; id: string }): Promise<FileUpload> {
    return this.call(data.nodeId, await this.owner(), { op: 'writeStatus', id: data.id });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async finishUpload(data: { nodeId: string; id: string }): Promise<FileUpload> {
    return this.call(data.nodeId, await this.owner('upload.commit.requested', data), {
      op: 'commitWrite',
      id: data.id,
    });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async acknowledgeUpload(data: { nodeId: string; id: string }): Promise<void> {
    await this.call(data.nodeId, await this.owner(), { op: 'acknowledgeWrite', id: data.id });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async abortUpload(data: { nodeId: string; id: string }): Promise<FileUpload> {
    return this.call(data.nodeId, await this.owner('upload.abort.requested', data), { op: 'abortWrite', id: data.id });
  }
  private persist(job: Job) {
    job.view.updatedAt = new Date().toISOString();
    this.store.kvSetSync(`files:job:${job.view.id}`, job);
  }
  private view(job: Job): FileTransfer {
    return structuredClone(job.view);
  }
  private async plan(owner: AuthContext, request: FileCopyRequest, checkpoint: () => Promise<void>): Promise<Plan> {
    const plan: Plan = [],
      visited = new Set<string>();
    let bytes = 0;
    const walk = async (
      source: FileLocation,
      destination: FileLocation,
      expected: string | undefined,
      depth: number
    ) => {
      await checkpoint();
      if (depth > 32 || plan.length >= FILE_LIMITS.entries)
        throw new Error('Transfer exceeds 32 directory levels or 10,000 entries');
      const identity = JSON.stringify(destination);
      if (visited.has(identity)) throw new Error('Transfer contains overlapping or duplicate destinations');
      visited.add(identity);
      const item = await this.call<FileEntry>(source.nodeId, owner, { ...source, op: 'stat' });
      if (expected && item.version !== expected) throw new Error('Source changed after selection; refresh the panel');
      if (item.kind !== 'file' && item.kind !== 'directory')
        throw new Error('Symlinks and special files cannot be copied');
      if (item.size > FILE_LIMITS.fileBytes) throw new Error('File exceeds the transfer size limit');
      if (item.kind === 'file') bytes += item.size;
      if (bytes > FILE_LIMITS.fileBytes) throw new Error('Transfer exceeds 100 GiB');
      plan.push({ source, destination, entry: item });
      if (item.kind === 'directory') {
        let after: string | undefined, revision: string | undefined;
        do {
          const listing = await this.call<FileListing>(source.nodeId, owner, {
            ...source,
            op: 'list',
            ...(after && revision ? { after, revision } : {}),
          });
          revision = listing.revision;
          for (const child of listing.entries)
            await walk(
              { ...source, path: child.path },
              { ...destination, path: join(destination.path, child.name) },
              child.version,
              depth + 1
            );
          after = listing.next ?? undefined;
        } while (after);
      }
    };
    for (const raw of request.sources) {
      const source = location(raw),
        destination = { ...request.destination, path: join(request.destination.path, source.path.split('/').at(-1)!) };
      if (
        !source.path ||
        (same(source, destination) &&
          (destination.path === source.path || destination.path.startsWith(source.path + '/')))
      )
        throw new Error('Cannot copy an exported root or copy a directory into itself');
      await walk(source, destination, raw.version, 0);
    }
    return plan;
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async copy(data: FileCopyRequest): Promise<FileTransfer> {
    if (!data || !Array.isArray(data.sources) || !data.sources.length || data.sources.length > 200)
      throw new Error('Select between 1 and 200 sources');
    const request = {
      sources: data.sources.map((s) => ({ ...location(s), version: s.version })),
      destination: location(data.destination),
    };
    if (request.sources.some((s) => !/^[a-f0-9]{64}$/.test(s.version))) throw new Error('Source versions are required');
    const owner = await this.owner('copy.requested', request);
    if (this.active.size >= 4) throw new Error('At most four file transfers can run concurrently');
    for (const [id, old] of this.jobs) {
      if (this.jobs.size < 100) break;
      if (old.view.state === 'completed' || old.view.state === 'cancelled') {
        this.jobs.delete(id);
        this.store.kvDeleteSync(`files:job:${id}`);
        this.store.kvDeleteSync(`files:plan:${id}`);
      }
    }
    if (this.jobs.size >= 100) throw new Error('Resolve pending file transfers before creating another');
    const now = new Date().toISOString();
    const job: Job = {
      view: {
        id: randomUUID(),
        ownerId: owner.userId!,
        state: 'planning',
        source: request.sources,
        destination: request.destination,
        bytes: 0,
        totalBytes: 0,
        completedFiles: 0,
        totalFiles: 0,
        createdAt: now,
        updatedAt: now,
      },
      cursor: 0,
      committedBytes: 0,
    };
    this.persist(job);
    this.jobs.set(job.view.id, job);
    this.store.kvSetSync('files:jobs:index', [...this.jobs.keys()]);
    this.start(job, owner, request);
    return this.view(job);
  }
  private start(job: Job, owner: AuthContext, request?: FileCopyRequest) {
    const control = { done: Promise.resolve() } as { stop?: 'paused' | 'cancelled'; done: Promise<void> };
    this.active.set(job.view.id, control);
    control.done = Promise.resolve()
      .then(async () => {
        try {
          const checkpoint = async () => {
            if (control.stop || this.stopped) throw new Error('Transfer interrupted by operator or shutdown');
            await runWithAuth(owner, () => daemonPrincipal(this.auth, 'admin'));
          };
          let plan = this.store.kvGetSync<Plan>(`files:plan:${job.view.id}`);
          if (!plan) {
            if (!request) throw new Error('Transfer planning was interrupted; create a new transfer');
            plan = await this.plan(owner, request, checkpoint);
            this.store.kvSetSync(`files:plan:${job.view.id}`, plan);
            job.view.totalBytes = plan.filter((p) => p.entry.kind === 'file').reduce((n, p) => n + p.entry.size, 0);
            job.view.totalFiles = plan.filter((p) => p.entry.kind === 'file').length;
          }
          job.view.state = 'running';
          delete job.view.error;
          this.persist(job);
          let persisted = Date.now();
          for (; job.cursor < plan.length; job.cursor++) {
            const step = plan[job.cursor]!;
            let receipt: string | undefined;
            await checkpoint();
            job.view.currentPath = step.source.path;
            if (step.entry.kind === 'directory') {
              // mkdir never overwrites. A pre-existing directory can hold additional copied entries.
              try {
                await this.call(step.destination.nodeId, owner, { ...step.destination, op: 'mkdir' });
              } catch (e) {
                const existing = await this.call<FileEntry>(step.destination.nodeId, owner, {
                  ...step.destination,
                  op: 'stat',
                });
                if (existing.kind !== 'directory') throw e;
              }
            } else {
              // Persist a caller-generated key before remote admission: a lost begin response cannot leak a new session on every retry.
              if (!job.upload) {
                job.upload = randomUUID();
                this.persist(job);
              }
              let upload = await this.call<FileUpload>(step.destination.nodeId, owner, {
                ...step.destination,
                op: 'beginWrite',
                id: job.upload,
                size: step.entry.size,
              });
              if (upload.state === 'aborted') throw new Error('Destination write was aborted; create a new copy');
              while (upload.offset < upload.size) {
                await checkpoint();
                const chunk = await this.call<FileChunk>(step.source.nodeId, owner, {
                  ...step.source,
                  op: 'readChunk',
                  version: step.entry.version,
                  offset: upload.offset,
                });
                if (chunk.offset !== upload.offset || !chunk.data)
                  throw new Error('Source returned an invalid transfer frame');
                upload = await this.call(step.destination.nodeId, owner, {
                  op: 'writeChunk',
                  id: upload.id,
                  offset: chunk.offset,
                  data: chunk.data,
                  sha256: chunk.sha256,
                });
                job.view.bytes = job.committedBytes + upload.offset;
                if (Date.now() - persisted > 500) {
                  this.persist(job);
                  persisted = Date.now();
                }
              }
              await checkpoint();
              if (upload.state !== 'complete') {
                const source = await this.call<FileEntry>(step.source.nodeId, owner, { ...step.source, op: 'stat' });
                if (source.version !== step.entry.version) throw new Error('Source changed before transfer commit');
                upload = await this.call(step.destination.nodeId, owner, { op: 'commitWrite', id: upload.id });
              }
              if (upload.state !== 'complete') throw new Error('Destination did not confirm publication');
              job.committedBytes += step.entry.size;
              job.view.bytes = job.committedBytes;
              job.view.completedFiles++;
              receipt = job.upload;
              delete job.upload;
            }
            // Persist the next cursor together with completion, not a counter that may be applied twice after a crash.
            job.cursor++;
            this.persist(job);
            job.cursor--;
            if (receipt)
              await this.call(step.destination.nodeId, owner, { op: 'acknowledgeWrite', id: receipt }).catch(
                () => undefined
              );
          }
          job.view.state = 'completed';
          delete job.view.currentPath;
        } catch (e) {
          job.view.state = control.stop ?? (this.stopped ? 'interrupted' : 'failed');
          job.view.error = e instanceof Error ? e.message.slice(0, 500) : 'File transfer failed';
          if (control.stop === 'cancelled' && job.upload) {
            const plan = this.store.kvGetSync<Plan>(`files:plan:${job.view.id}`),
              step = plan?.[job.cursor];
            if (step)
              try {
                await this.call(step.destination.nodeId, owner, { op: 'abortWrite', id: job.upload });
              } catch {
                job.view.state = 'interrupted';
                job.view.error =
                  'Cancellation could not confirm the destination outcome. Resume to reconcile the receipt.';
              }
          }
        } finally {
          try {
            this.persist(job);
            await runWithAuth(owner, () =>
              this.audit.record({
                action: `files.copy.${job.view.state}`,
                outcome: job.view.state === 'completed' ? 'ok' : job.view.completedFiles > 0 ? 'partial' : 'failed',
                resourceType: 'file',
                resourceId: job.view.id,
                details: { bytes: job.view.bytes, files: job.view.completedFiles, error: job.view.error },
              })
            );
          } finally {
            this.active.delete(job.view.id);
          }
        }
      })
      .catch(() => {
        job.view.state = 'interrupted';
        job.view.error = 'Transfer journal unavailable; inspect destination receipts before recovery';
        this.active.delete(job.view.id);
      });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async transfers(): Promise<FileTransfer[]> {
    const owner = await this.owner();
    return [...this.jobs.values()]
      .filter((j) => j.view.ownerId === owner.userId)
      .map((j) => this.view(j))
      .reverse();
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async controlTransfer(data: { id: string; action: 'pause' | 'resume' | 'cancel' }): Promise<FileTransfer> {
    const owner = await this.owner('transfer.control', { id: data.id, action: data.action }),
      job = this.jobs.get(data.id);
    if (!job || job.view.ownerId !== owner.userId || !['pause', 'resume', 'cancel'].includes(data.action))
      throw new Error('Unknown transfer or action');
    const control = this.active.get(data.id);
    if (data.action === 'resume') {
      if (!control && ['paused', 'failed', 'interrupted'].includes(job.view.state)) {
        if (this.active.size >= 4) throw new Error('Transfer capacity reached');
        job.view.state = 'running';
        this.persist(job);
        this.start(job, owner);
      }
    } else if (control) {
      control.stop = data.action === 'pause' ? 'paused' : 'cancelled';
      await control.done;
    } else if (data.action === 'cancel' && !['completed', 'cancelled'].includes(job.view.state)) {
      if (job.upload) {
        const step = this.store.kvGetSync<Plan>(`files:plan:${data.id}`)?.[job.cursor];
        if (step) await this.call(step.destination.nodeId, owner, { op: 'abortWrite', id: job.upload });
      }
      job.view.state = 'cancelled';
      this.persist(job);
    }
    return this.view(job);
  }
  async dispose() {
    this.stopped = true;
    await Promise.all([...this.active.values()].map((c) => c.done));
  }
}
