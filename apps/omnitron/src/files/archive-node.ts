import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type {
  FileArchiveStatus,
  FileArchiveManifest,
  FileNodeRequest,
  FileEntry,
  FileListing,
  FileChunk,
} from '../shared/dto/files.js';
import { ensurePrivateDir } from '../shared/private-files.js';
import { fileNameError } from '../shared/file-policy.js';
import { createArchive, probeArchiveFormats } from './archive-codec.js';

type Store = Pick<DaemonStateStore, 'kvGetSync' | 'kvSetSync' | 'kvDeleteSync'>;
type Prepare = Extract<FileNodeRequest, { op: 'prepareArchive' }>;
type Call = <T>(actor: string, request: FileNodeRequest) => Promise<T>;
interface Record {
  actor: string;
  request: Prepare;
  view: FileArchiveStatus;
  stamp?: string;
}
const MAX_BYTES = 100 * 1024 ** 3;
const stamp = (stat: BigIntStats) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Durable private source snapshots. Public paths are always read through FileNode's confined API. */
export class ArchiveNode {
  private active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private cachePin: string | undefined;
  private stopped = false;
  activeOperationCount(): number {
    return this.active.size;
  }
  async dispose(): Promise<void> {
    this.stopped = true;
    const operations = [...this.active.values()];
    for (const operation of operations) operation.controller.abort();
    await Promise.all(operations.map((operation) => operation.done));
  }
  constructor(
    private readonly call: Call,
    private readonly assertSource: (rootId: string, relative: string) => Promise<void>,
    private readonly store: Store,
    private readonly directory: string
  ) {
    for (const id of this.index()) {
      const record = store.kvGetSync<Record>(`files:archive:${id}`);
      if (record?.view.state === 'preparing') {
        record.view.state = 'interrupted';
        record.view.error = 'Archive preparation was interrupted; resume explicitly to rebuild its private snapshot.';
        this.persist(record);
      }
    }
  }
  private index(): string[] {
    return this.store.kvGetSync<string[]>('files:archives:index') ?? [];
  }
  private persist(record: Record): void {
    this.store.kvSetSync(`files:archive:${record.request.id}`, record);
  }
  private record(actor: string, id: string): Record {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid archive operation ID');
    const value = this.store.kvGetSync<Record>(`files:archive:${id}`);
    if (!value || value.actor !== actor) throw new Error('Archive does not belong to this identity');
    return value;
  }
  private async cache(id: string): Promise<string> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid archive operation ID');
    ensurePrivateDir(this.directory);
    const real = await fs.realpath(this.directory),
      metadata = await fs.lstat(real, { bigint: true });
    const pin = `${real}:${metadata.dev}:${metadata.ino}`;
    if (this.cachePin && this.cachePin !== pin) throw new Error('Private archive storage changed');
    this.cachePin = pin;
    const candidate = path.join(real, id);
    const stat = await fs.lstat(candidate).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077))
      throw new Error('Archive staging is not a private owned directory');
    return candidate;
  }
  async invoke(actor: string, request: FileNodeRequest): Promise<unknown> {
    if (this.stopped) throw new Error('Archive provider is stopping');
    switch (request.op) {
      case 'archiveFormats':
        return probeArchiveFormats();
      case 'prepareArchive':
        return this.prepare(actor, request);
      case 'archiveStatus': {
        const record = this.record(actor, request.id);
        if (record.view.state === 'ready') {
          const file = path.join(await this.cache(request.id), 'payload');
          const stat = await fs.lstat(file, { bigint: true });
          if (!stat.isFile() || stat.isSymbolicLink() || stamp(stat) !== record.stamp)
            throw new Error('Prepared archive changed; start a new transfer');
        }
        return structuredClone(record.view);
      }
      case 'readArchive':
        return this.read(actor, request);
      case 'abortArchive': {
        const record = this.record(actor, request.id),
          active = this.active.get(request.id);
        active?.controller.abort();
        await active?.done;
        record.view.state = 'cancelled';
        this.persist(record);
        await fs.rm(await this.cache(request.id), { recursive: true, force: true });
        return structuredClone(record.view);
      }
      case 'releaseArchive': {
        if (!this.store.kvGetSync(`files:archive:${request.id}`)) return undefined;
        this.record(actor, request.id);
        const active = this.active.get(request.id);
        active?.controller.abort();
        await active?.done;
        await fs.rm(await this.cache(request.id), { recursive: true, force: true });
        this.store.kvDeleteSync(`files:archive:${request.id}`);
        this.store.kvSetSync(
          'files:archives:index',
          this.index().filter((id) => id !== request.id)
        );
        return undefined;
      }
      default:
        throw new Error('Unsupported archive operation');
    }
  }
  private async prepare(actor: string, request: Prepare): Promise<FileArchiveStatus> {
    if (!/^[a-f0-9-]{36}$/.test(request.id) || !/^[a-f0-9]{64}$/.test(request.version))
      throw new Error('An archive ID and source version are required');
    await this.assertSource(request.rootId, request.path);
    if (!(await probeArchiveFormats()).formats.some((item) => item.format === request.format))
      throw new Error('This archive format is not available on the source node');
    if (this.stopped) throw new Error('Archive provider is stopping');
    const previous = this.store.kvGetSync<Record>(`files:archive:${request.id}`);
    if (previous) {
      if (previous.actor !== actor || JSON.stringify(previous.request) !== JSON.stringify(request))
        throw new Error('Archive ID is bound to another request');
      if (previous.view.state === 'ready' || this.active.has(request.id)) return structuredClone(previous.view);
    }
    if (this.active.size >= 2) throw new Error('At most two source archives can be prepared concurrently');
    const index = this.index();
    if (!index.includes(request.id) && index.length >= 100)
      throw new Error('Archive journal is full; cancel or finish pending transfers');
    const record: Record = {
      actor,
      request,
      view: { id: request.id, state: 'preparing', phase: 'planning', preparedBytes: 0, sourceBytes: 0 },
    };
    this.persist(record);
    if (!index.includes(request.id)) this.store.kvSetSync('files:archives:index', [...index, request.id]);
    const controller = new AbortController();
    const active = { controller, done: Promise.resolve() };
    this.active.set(request.id, active);
    active.done = this.build(record, AbortSignal.any([controller.signal, AbortSignal.timeout(60 * 60_000)]))
      .catch(async (error) => {
        record.view.state = this.stopped ? 'interrupted' : controller.signal.aborted ? 'cancelled' : 'failed';
        record.view.error = this.stopped
          ? 'Archive preparation interrupted by node shutdown; resume explicitly'
          : controller.signal.aborted
            ? 'Archive preparation cancelled'
            : error instanceof Error
              ? error.message.slice(0, 500)
              : 'Archive preparation failed';
        try {
          await fs.rm(await this.cache(request.id), { recursive: true, force: true });
        } finally {
          this.persist(record);
        }
      })
      .finally(() => {
        this.active.delete(request.id);
      });
    // Observe cleanup/journal failure without leaving a rejected background promise.
    void active.done.catch(() => {});
    return structuredClone(record.view);
  }
  private async build(record: Record, signal: AbortSignal): Promise<void> {
    const { request, actor } = record;
    const checkpoint = () => {
      signal.throwIfAborted();
    };
    const work = await this.cache(request.id);
    await fs.rm(work, { recursive: true, force: true });
    await fs.mkdir(work, { mode: 0o700 });
    const tree = path.join(work, 'tree');
    await fs.mkdir(tree, { mode: 0o700 });
    const rootName = request.path.split('/').at(-1)!;
    if (fileNameError(rootName)) throw new Error('Invalid source folder name');
    const sourceEntries: Array<{ source: string; item: FileEntry; destination: string }> = [];
    const walk = async (source: string, destination: string, expected: string, depth: number): Promise<void> => {
      checkpoint();
      if (depth > 32 || sourceEntries.length >= 10_000)
        throw new Error('Archive exceeds 32 directory levels or 10,000 entries');
      const item = await this.call<FileEntry>(actor, { op: 'stat', rootId: request.rootId, path: source });
      if (item.version !== expected) throw new Error('Source changed after selection; refresh the panel');
      if (!['file', 'directory'].includes(item.kind) || (!depth && item.kind !== 'directory'))
        throw new Error('Archive sources must be directories containing only regular files and directories');
      sourceEntries.push({ source, item, destination });
      if (item.kind === 'file') {
        record.view.sourceBytes += item.size;
        if (!Number.isSafeInteger(item.size) || item.size < 0 || record.view.sourceBytes > MAX_BYTES)
          throw new Error('Archive source exceeds 100 GiB');
      } else {
        let after: string | undefined, revision: string | undefined;
        do {
          const listing = await this.call<FileListing>(actor, {
            op: 'list',
            rootId: request.rootId,
            path: source,
            ...(after && revision ? { after, revision } : {}),
          });
          revision = listing.revision;
          for (const child of listing.entries)
            await walk(child.path, destination + '/' + child.name, child.version, depth + 1);
          after = listing.next ?? undefined;
        } while (after);
      }
    };
    await walk(request.path, rootName, request.version, 0);
    const available = await fs.statfs(work);
    if (Number(available.bavail) * Number(available.bsize) < record.view.sourceBytes * 2 + 64 * 1024 ** 2)
      throw new Error('Source node needs free space for the private snapshot and archive');
    record.view.phase = 'snapshotting';
    this.persist(record);
    const manifest: FileArchiveManifest = { protocol: 1, rootName, entries: [] };
    let lastPersist = Date.now();
    for (const entry of sourceEntries) {
      checkpoint();
      const target = path.join(tree, entry.destination);
      if (entry.item.kind === 'directory') {
        await fs.mkdir(target, { mode: entry.item.mode | 0o700 });
        manifest.entries.push({ path: entry.destination, kind: 'directory', size: 0, mode: entry.item.mode });
        continue;
      }
      const fd = await fs.open(target, 'wx', 0o600),
        hash = createHash('sha256');
      try {
        let offset = 0;
        while (offset < entry.item.size) {
          checkpoint();
          const chunk = await this.call<FileChunk>(actor, {
            op: 'readChunk',
            rootId: request.rootId,
            path: entry.source,
            version: entry.item.version,
            offset,
          });
          const bytes = Buffer.from(chunk.data, 'base64');
          if (
            chunk.offset !== offset ||
            !bytes.length ||
            bytes.length > 256 * 1024 ||
            offset + bytes.length > entry.item.size ||
            bytes.toString('base64') !== chunk.data ||
            sha(bytes) !== chunk.sha256
          )
            throw new Error('Invalid source snapshot frame');
          await fd.writeFile(bytes);
          hash.update(bytes);
          offset += bytes.length;
          record.view.preparedBytes += bytes.length;
          if (Date.now() - lastPersist > 250) {
            this.persist(record);
            lastPersist = Date.now();
          }
        }
        await fd.chmod(entry.item.mode | 0o400);
        await fd.sync();
      } finally {
        await fd.close();
      }
      manifest.entries.push({
        path: entry.destination,
        kind: 'file',
        size: entry.item.size,
        mode: entry.item.mode,
        sha256: hash.digest('hex'),
      });
    }
    for (const entry of sourceEntries) {
      checkpoint();
      if (
        (await this.call<FileEntry>(actor, { op: 'stat', rootId: request.rootId, path: entry.source })).version !==
        entry.item.version
      )
        throw new Error('Source tree changed while its archive snapshot was prepared');
    }
    record.view.phase = 'archiving';
    this.persist(record);
    const payload = path.join(work, 'payload');
    await createArchive({ format: request.format, sourceDirectory: tree, outputFile: payload, manifest, signal });
    checkpoint();
    const fd = await fs.open(payload, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let size: number, version: string, fingerprint: string;
    try {
      const before = await fd.stat({ bigint: true });
      size = Number(before.size);
      if (!before.isFile() || size > MAX_BYTES) throw new Error('Prepared archive exceeds the 100 GiB transfer limit');
      const hash = createHash('sha256'),
        bytes = Buffer.alloc(256 * 1024);
      let offset = 0;
      while (offset < size) {
        checkpoint();
        const read = await fd.read(bytes, 0, Math.min(bytes.length, size - offset), offset);
        if (!read.bytesRead) throw new Error('Archive ended unexpectedly');
        hash.update(bytes.subarray(0, read.bytesRead));
        offset += read.bytesRead;
      }
      if (stamp(before) !== stamp(await fd.stat({ bigint: true })))
        throw new Error('Prepared archive changed during verification');
      fingerprint = stamp(before);
      version = hash.digest('hex');
      await fd.sync();
    } finally {
      await fd.close();
    }
    await fs.rm(tree, { recursive: true, force: true });
    const parent = await fs.open(work, 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    record.stamp = fingerprint;
    record.view = {
      ...record.view,
      state: 'ready',
      manifest,
      file: {
        name: rootName,
        path: rootName,
        kind: 'file',
        size,
        mode: 0o600,
        modifiedAt: new Date().toISOString(),
        version,
      },
    };
    this.persist(record);
  }
  private async read(actor: string, request: Extract<FileNodeRequest, { op: 'readArchive' }>): Promise<FileChunk> {
    const record = this.record(actor, request.id),
      file = record.view.file;
    if (
      record.view.state !== 'ready' ||
      !file ||
      request.version !== file.version ||
      !Number.isSafeInteger(request.offset) ||
      request.offset < 0 ||
      request.offset > file.size
    )
      throw new Error('Prepared archive version or offset is unavailable');
    const fd = await fs.open(
      path.join(await this.cache(request.id), 'payload'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const before = await fd.stat({ bigint: true });
      if (!before.isFile() || stamp(before) !== record.stamp) throw new Error('Prepared archive changed');
      const data = Buffer.alloc(Math.min(256 * 1024, file.size - request.offset));
      let read = 0;
      while (read < data.length) {
        const frame = await fd.read(data, read, data.length - read, request.offset + read);
        if (!frame.bytesRead) break;
        read += frame.bytesRead;
      }
      if (read !== data.length || stamp(await fd.stat({ bigint: true })) !== record.stamp)
        throw new Error('Prepared archive changed while reading');
      return {
        data: data.toString('base64'),
        sha256: sha(data),
        offset: request.offset,
        eof: request.offset + data.length === file.size,
      };
    } finally {
      await fd.close();
    }
  }
}
