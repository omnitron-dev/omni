import * as fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type {
  FileRootConfig,
  FileRoot,
  FileEntry,
  FileListing,
  FileDocument,
  FileNodeRequest,
  FileUpload,
  FileTrash,
} from '../shared/dto/files.js';

export const FILE_LIMITS = {
  chunk: 256 * 1024,
  text: 1024 * 1024,
  entries: 10_000,
  page: 200,
  fileBytes: 100 * 1024 ** 3,
  uploads: 32,
  records: 1000,
} as const;
const INTERNAL = '.omnitron-files';
type Store = Pick<DaemonStateStore, 'kvGetSync' | 'kvSetSync' | 'kvDeleteSync'>;
interface Upload extends FileUpload {
  actor: string;
  rootId: string;
  path: string;
  updatedAt: number;
}
interface Trash extends FileTrash {
  actor: string;
}
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';
export function filePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    /\\/.test(value) ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32) ||
    value.startsWith('/') ||
    (value !== '' && value.split('/').some((p) => !p || p === '.' || p === '..' || p === INTERNAL))
  )
    throw new Error('Use a relative path inside the selected file root');
  return value;
}
function fingerprint(s: BigIntStats) {
  return digest([s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.mode].join(':'));
}
function entry(p: string, s: BigIntStats): FileEntry {
  return {
    name: path.posix.basename(p),
    path: p,
    kind: s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'special',
    size: Number(s.size),
    modifiedAt: new Date(Number(s.mtimeMs)).toISOString(),
    mode: Number(s.mode) & 0o777,
    version: fingerprint(s),
  };
}
function integer(v: unknown, maximum: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > maximum)
    throw new Error('Invalid file byte offset or size');
  return v;
}
function identifier(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-f0-9-]{36}$/.test(v)) throw new Error('Invalid file operation ID');
  return v;
}
async function exists(p: string) {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}
async function syncDirectory(p: string) {
  const fd = await fs.open(p, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}

/** Host-local filesystem provider. Explicit exports; no shell, SFTP or arbitrary absolute paths. */
export class FileNode {
  private rootsById = new Map<string, FileRootConfig>();
  private pins = new Map<string, { real: string; ino: bigint; dev: bigint }>();
  private locks = new Map<string, Promise<unknown>>();
  private requests = 0;
  constructor(
    roots: FileRootConfig[],
    private readonly store: Store
  ) {
    if (!Array.isArray(roots) || roots.length > 32) throw new Error('Configure at most 32 file roots');
    for (const r of roots) {
      if (
        !r ||
        !/^[\w-]{1,64}$/.test(r.id) ||
        this.rootsById.has(r.id) ||
        typeof r.path !== 'string' ||
        !path.isAbsolute(r.path) ||
        typeof r.label !== 'string' ||
        !r.label ||
        r.label.length > 100 ||
        (r.readOnly !== undefined && typeof r.readOnly !== 'boolean')
      )
        throw new Error('Invalid or duplicate file root');
      this.rootsById.set(r.id, { ...r });
    }
  }
  roots(): { protocol: 1; roots: FileRoot[] } {
    return {
      protocol: 1,
      roots: [...this.rootsById.values()].map((r) => ({ id: r.id, label: r.label, readOnly: Boolean(r.readOnly) })),
    };
  }
  private async root(id: string, write = false) {
    const config = this.rootsById.get(id);
    if (!config || (write && config.readOnly)) throw new Error('File root is unavailable or read-only');
    const real = await fs.realpath(config.path),
      stat = await fs.lstat(real, { bigint: true });
    if (!stat.isDirectory()) throw new Error('Exported file root is not a directory');
    const pin = this.pins.get(id);
    if (pin && (pin.real !== real || pin.ino !== stat.ino || pin.dev !== stat.dev))
      throw new Error('File root changed; review configuration and restart the daemon');
    this.pins.set(id, { real, ino: stat.ino, dev: stat.dev });
    return real;
  }
  private async resolve(rootId: string, relative: string, write = false, absentLeaf = false) {
    filePath(relative);
    let resolved = await this.root(rootId, write);
    const segments = relative ? relative.split('/') : [];
    for (let i = 0; i < segments.length; i++) {
      resolved = path.join(resolved, segments[i]!);
      let stat;
      try {
        stat = await fs.lstat(resolved);
      } catch (e) {
        if (absentLeaf && i === segments.length - 1 && missing(e)) return resolved;
        throw e;
      }
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are visible but cannot be followed');
      if (i < segments.length - 1 && !stat.isDirectory()) throw new Error('A path component is not a directory');
    }
    return resolved;
  }
  private async internal(rootId: string, kind: 'uploads' | 'trash', relative = '') {
    let p = await this.resolve(rootId, relative, true);
    for (const component of [INTERNAL, kind]) {
      p = path.join(p, component);
      try {
        await fs.mkdir(p, { mode: 0o700 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      const stat = await fs.lstat(p);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
        throw new Error('Private file staging directory has unsafe ownership or permissions');
    }
    return p;
  }
  private async locked<T>(key: string, run: () => Promise<T>): Promise<T> {
    const before = this.locks.get(key) ?? Promise.resolve();
    const current = before.catch(() => {}).then(run);
    this.locks.set(key, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
  private index(kind: string): string[] {
    return this.store.kvGetSync<string[]>(`files:${kind}:index`) ?? [];
  }
  private register(kind: string, id: string) {
    let index = this.index(kind);
    if (index.includes(id)) return;
    // Keep terminal receipts for 30 days; never expire an unfinished write or un-restored trash.
    if (index.length >= FILE_LIMITS.records) {
      index = index.filter((key) => {
        const value =
          kind === 'uploads'
            ? this.store.kvGetSync<Upload>(`files:upload:${key}`)
            : this.store.kvGetSync<Trash>(`files:trash:${key}`);
        const expired =
          value &&
          ('state' in value
            ? ['complete', 'aborted'].includes(value.state) && value.updatedAt < Date.now() - 30 * 86400_000
            : value.restored);
        if (expired) this.store.kvDeleteSync(`files:${kind === 'uploads' ? 'upload' : 'trash'}:${key}`);
        return !expired;
      });
    }
    if (index.length >= FILE_LIMITS.records)
      throw new Error(`File ${kind} journal is full; inspect retained records before continuing`);
    this.store.kvSetSync(`files:${kind}:index`, [...index, id]);
  }
  private upload(actor: string, id: string): Upload {
    const value = this.store.kvGetSync<Upload>(`files:upload:${identifier(id)}`);
    if (!value || value.actor !== actor) throw new Error('File write does not belong to this session');
    return value;
  }
  private persistUpload(value: Upload) {
    value.updatedAt = Date.now();
    this.store.kvSetSync(`files:upload:${value.id}`, value);
  }
  private viewUpload(value: Upload): FileUpload {
    return {
      id: value.id,
      offset: value.offset,
      size: value.size,
      state: value.state,
      ...(value.sha256 ? { sha256: value.sha256 } : {}),
    };
  }
  async invoke(actor: string, request: FileNodeRequest): Promise<unknown> {
    if (!actor || actor.length > 300 || !request || typeof request !== 'object')
      throw new Error('Invalid file request');
    if (this.requests >= 32) throw new Error('File request capacity reached');
    this.requests++;
    try {
      return await this.dispatch(actor, request);
    } finally {
      this.requests--;
    }
  }
  private async dispatch(actor: string, request: FileNodeRequest): Promise<unknown> {
    switch (request.op) {
      case 'roots':
        return this.roots();
      case 'list':
        return this.list(request);
      case 'stat':
        return this.stat(request.rootId, request.path);
      case 'readText':
        return this.readText(request.rootId, request.path);
      case 'readChunk':
        return this.readChunk(request);
      case 'saveText':
        return this.locked(request.rootId, () => this.saveText(request));
      case 'mkdir':
        return this.locked(request.rootId, async () => {
          if (!filePath(request.path)) throw new Error('Cannot create the exported root');
          const destination = await this.resolve(request.rootId, request.path, true, true);
          await fs.mkdir(destination, { mode: 0o700 });
          await syncDirectory(path.dirname(destination));
          return this.stat(request.rootId, request.path);
        });
      case 'rename':
        return this.locked(request.rootId, () => this.rename(request));
      case 'trash':
        return this.locked(request.rootId, () => this.trash(actor, request));
      case 'trashList':
        return this.index('trash')
          .map((id) => this.store.kvGetSync<Trash>(`files:trash:${id}`))
          .filter((r): r is Trash => Boolean(r && r.actor === actor && r.rootId === request.rootId && !r.restored))
          .reverse()
          .map(({ actor: _actor, ...r }) => r);
      case 'restore':
        return this.restore(actor, request.id);
      case 'beginWrite':
        return this.locked(request.rootId, () => this.beginWrite(actor, request));
      case 'acknowledgeWrite':
        return this.locked('receipts', () => this.acknowledgeWrite(actor, request.id));
      case 'writeStatus':
        return this.viewUpload(this.upload(actor, request.id));
      case 'writeChunk': {
        const u = this.upload(actor, request.id);
        return this.locked(u.rootId, () => this.writeChunk(actor, request));
      }
      case 'commitWrite': {
        const u = this.upload(actor, request.id);
        return this.locked(u.rootId, () => this.commitWrite(actor, request.id));
      }
      case 'abortWrite': {
        const u = this.upload(actor, request.id);
        return this.locked(u.rootId, () => this.abortWrite(actor, request.id));
      }
      default:
        throw new Error('Unsupported file protocol operation');
    }
  }
  private async stat(rootId: string, relative: string) {
    const resolved = await this.resolve(rootId, relative);
    return entry(relative, await fs.lstat(resolved, { bigint: true }));
  }
  private async list(r: Extract<FileNodeRequest, { op: 'list' }>): Promise<FileListing> {
    if (r.after !== undefined && (typeof r.after !== 'string' || r.after.length > 255))
      throw new Error('Invalid directory cursor');
    const directory = await this.resolve(r.rootId, r.path);
    const before = await fs.lstat(directory, { bigint: true }),
      revision = fingerprint(before);
    if (!before.isDirectory()) throw new Error('Not a directory');
    if (r.revision && r.revision !== revision)
      throw new Error('Directory changed; refresh before requesting the next page');
    const names: string[] = [],
      stream = await fs.opendir(directory);
    for await (const item of stream) {
      if (item.name === INTERNAL) continue;
      names.push(item.name);
      if (names.length > FILE_LIMITS.entries) throw new Error('Directory exceeds the 10,000-entry interactive limit');
    }
    names.sort();
    const remaining = names.filter((n) => r.after === undefined || n > r.after);
    const page = remaining.slice(0, FILE_LIMITS.page);
    const entries: FileEntry[] = [];
    for (const name of page)
      entries.push(
        entry(r.path ? `${r.path}/${name}` : name, await fs.lstat(path.join(directory, name), { bigint: true }))
      );
    if (fingerprint(await fs.lstat(directory, { bigint: true })) !== revision)
      throw new Error('Directory changed while reading; refresh');
    return { entries, next: remaining.length > page.length ? page.at(-1)! : null, revision };
  }
  private async open(rootId: string, relative: string, expected?: string) {
    const p = await this.resolve(rootId, relative);
    const fd = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await fd.stat({ bigint: true });
      if (!stat.isFile()) throw new Error('Only regular files can be read');
      if (expected && fingerprint(stat) !== expected) throw new Error('File changed; reload before continuing');
      return { fd, stat };
    } catch (e) {
      await fd.close();
      throw e;
    }
  }
  private async readText(rootId: string, relative: string): Promise<FileDocument> {
    const { fd, stat } = await this.open(rootId, relative);
    try {
      if (stat.size > BigInt(FILE_LIMITS.text))
        throw new Error('Text editor supports files up to 1 MiB; use a transfer for larger files');
      const bytes = Buffer.alloc(Number(stat.size));
      let offset = 0;
      while (offset < bytes.length) {
        const read = await fd.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset !== bytes.length || fingerprint(await fd.stat({ bigint: true })) !== fingerprint(stat))
        throw new Error('File changed while reading');
      const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (decoded.includes('\0')) throw new Error('Binary content cannot be edited as text');
      const bom = decoded.startsWith('\ufeff');
      return { content: bom ? decoded.slice(1) : decoded, version: fingerprint(stat), bytes: bytes.length, bom };
    } finally {
      await fd.close();
    }
  }
  private async readChunk(r: Extract<FileNodeRequest, { op: 'readChunk' }>) {
    const offset = integer(r.offset, FILE_LIMITS.fileBytes);
    if (typeof r.version !== 'string' || !/^[a-f0-9]{64}$/.test(r.version))
      throw new Error('A source version is required');
    const { fd, stat } = await this.open(r.rootId, r.path, r.version);
    try {
      if (stat.size > BigInt(FILE_LIMITS.fileBytes) || offset > Number(stat.size))
        throw new Error('File size or offset exceeds the transfer limit');
      const data = Buffer.alloc(Math.min(FILE_LIMITS.chunk, Number(stat.size) - offset));
      let read = 0;
      while (read < data.length) {
        const result = await fd.read(data, read, data.length - read, offset + read);
        if (!result.bytesRead) break;
        read += result.bytesRead;
      }
      if (read !== data.length || fingerprint(await fd.stat({ bigint: true })) !== r.version)
        throw new Error('Source changed during transfer');
      return { data: data.toString('base64'), sha256: digest(data), offset, eof: offset + read === Number(stat.size) };
    } finally {
      await fd.close();
    }
  }
  private async saveText(r: Extract<FileNodeRequest, { op: 'saveText' }>): Promise<FileDocument> {
    if (
      !filePath(r.path) ||
      typeof r.content !== 'string' ||
      r.content.includes('\0') ||
      (r.bom !== undefined && typeof r.bom !== 'boolean')
    )
      throw new Error('Invalid text document');
    const bytes = Buffer.from((r.bom ? '\ufeff' : '') + r.content, 'utf8');
    if (bytes.length > FILE_LIMITS.text) throw new Error('Text editor supports at most 1 MiB');
    const target = await this.resolve(r.rootId, r.path, true, true);
    const prior = await fs.lstat(target, { bigint: true }).catch((e) => {
      if (missing(e)) return null;
      throw e;
    });
    if (prior ? !prior.isFile() || fingerprint(prior) !== r.version : r.version !== null)
      throw new Error('Save conflict: file changed or no longer exists; reload or save a copy');
    const staging = path.join(
      await this.internal(r.rootId, 'uploads', path.posix.dirname(r.path) === '.' ? '' : path.posix.dirname(r.path)),
      randomUUID()
    );
    try {
      const fd = await fs.open(staging, 'wx', 0o600);
      try {
        await fd.writeFile(bytes);
        if (prior) {
          await fd.chown(Number(prior.uid), Number(prior.gid));
          await fd.chmod(Number(prior.mode) & 0o777);
        }
        await fd.sync();
      } finally {
        await fd.close();
      }
      await this.resolve(r.rootId, r.path, true, true);
      const current = await fs.lstat(target, { bigint: true }).catch((e) => {
        if (missing(e)) return null;
        throw e;
      });
      if (current ? fingerprint(current) !== r.version : r.version !== null)
        throw new Error('Save conflict: file changed before commit');
      // No-overwrite publication for new files. Existing files use atomic replacement after the version check.
      if (!current) {
        await fs.link(staging, target);
        await fs.unlink(staging);
      } else await fs.rename(staging, target);
      await syncDirectory(path.dirname(target));
      return await this.readText(r.rootId, r.path);
    } finally {
      await fs.unlink(staging).catch((e) => {
        if (!missing(e)) throw e;
      });
    }
  }
  private async rename(r: Extract<FileNodeRequest, { op: 'rename' }>) {
    if (!filePath(r.path) || !filePath(r.destination)) throw new Error('Cannot rename an exported root');
    const source = await this.resolve(r.rootId, r.path, true);
    const target = await this.resolve(r.rootId, r.destination, true, true);
    if ((await this.stat(r.rootId, r.path)).version !== r.version) throw new Error('File changed before rename');
    if (await exists(target)) throw new Error('Destination already exists');
    await fs.rename(source, target);
    await syncDirectory(path.dirname(target));
    if (path.dirname(source) !== path.dirname(target)) await syncDirectory(path.dirname(source));
    return this.stat(r.rootId, r.destination);
  }
  private async trash(actor: string, r: Extract<FileNodeRequest, { op: 'trash' }>): Promise<FileTrash> {
    if (!filePath(r.path)) throw new Error('Cannot remove an exported root');
    const source = await this.resolve(r.rootId, r.path, true);
    if ((await this.stat(r.rootId, r.path)).version !== r.version) throw new Error('File changed before removal');
    const value: Trash = {
      id: randomUUID(),
      actor,
      rootId: r.rootId,
      path: r.path,
      removedAt: new Date().toISOString(),
      restored: false,
    };
    const destination = path.join(
      await this.internal(r.rootId, 'trash', path.posix.dirname(r.path) === '.' ? '' : path.posix.dirname(r.path)),
      value.id
    );
    this.register('trash', value.id);
    this.store.kvSetSync(`files:trash:${value.id}`, value);
    await fs.rename(source, destination);
    await syncDirectory(path.dirname(source));
    await syncDirectory(path.dirname(destination));
    const { actor: _actor, ...result } = value;
    return result;
  }
  private async restore(actor: string, id: string): Promise<FileTrash> {
    const value = this.store.kvGetSync<Trash>(`files:trash:${identifier(id)}`);
    if (!value || value.actor !== actor) throw new Error('Trash record does not belong to this session');
    return this.locked(value.rootId, async () => {
      if (!value.restored) {
        const target = await this.resolve(value.rootId, value.path, true, true);
        if (await exists(target)) throw new Error('Restore conflict: destination exists');
        const source = path.join(
          await this.internal(
            value.rootId,
            'trash',
            path.posix.dirname(value.path) === '.' ? '' : path.posix.dirname(value.path)
          ),
          value.id
        );
        await fs.rename(source, target);
        await syncDirectory(path.dirname(target));
        await syncDirectory(path.dirname(source));
        value.restored = true;
        this.store.kvSetSync(`files:trash:${id}`, value);
      }
      const { actor: _actor, ...result } = value;
      return result;
    });
  }
  private async beginWrite(actor: string, r: Extract<FileNodeRequest, { op: 'beginWrite' }>) {
    if (!filePath(r.path)) throw new Error('Choose a destination file');
    integer(r.size, FILE_LIMITS.fileBytes);
    const id = r.id === undefined ? randomUUID() : identifier(r.id);
    const previous = this.store.kvGetSync<Upload>(`files:upload:${id}`);
    if (previous) {
      if (
        previous.actor !== actor ||
        previous.rootId !== r.rootId ||
        previous.path !== r.path ||
        previous.size !== r.size
      )
        throw new Error('Upload key is already bound to another request');
      if (previous.state === 'receiving' && previous.offset === 0) {
        const staged = path.join(
          await this.internal(
            r.rootId,
            'uploads',
            path.posix.dirname(r.path) === '.' ? '' : path.posix.dirname(r.path)
          ),
          id
        );
        try {
          const fd = await fs.open(staged, 'wx', 0o600);
          try {
            await fd.sync();
          } finally {
            await fd.close();
          }
          await syncDirectory(path.dirname(staged));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
      }
      return this.viewUpload(previous);
    }
    if (await exists(await this.resolve(r.rootId, r.path, true, true)))
      throw new Error('Destination exists; copy to a new name');
    const uploads = this.index('uploads').map((id) => this.store.kvGetSync<Upload>(`files:upload:${id}`));
    if (uploads.filter((u) => u && ['receiving', 'committing'].includes(u.state)).length >= FILE_LIMITS.uploads)
      throw new Error('File write capacity reached');
    const u: Upload = {
      id,
      actor,
      rootId: r.rootId,
      path: r.path,
      size: r.size,
      offset: 0,
      state: 'receiving',
      updatedAt: Date.now(),
    };
    const p = path.join(
      await this.internal(r.rootId, 'uploads', path.posix.dirname(r.path) === '.' ? '' : path.posix.dirname(r.path)),
      u.id
    );
    this.register('uploads', u.id);
    this.persistUpload(u);
    const fd = await fs.open(p, 'wx', 0o600);
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
    await syncDirectory(path.dirname(p));
    return this.viewUpload(u);
  }
  private async writeChunk(actor: string, r: Extract<FileNodeRequest, { op: 'writeChunk' }>) {
    const u = this.upload(actor, r.id),
      offset = integer(r.offset, FILE_LIMITS.fileBytes);
    if (u.state !== 'receiving') throw new Error('Write session is not receiving');
    if (
      typeof r.data !== 'string' ||
      r.data.length > Math.ceil(FILE_LIMITS.chunk / 3) * 4 ||
      !/^[a-f0-9]{64}$/.test(r.sha256)
    )
      throw new Error('Invalid file chunk');
    const data = Buffer.from(r.data, 'base64');
    if (
      !data.length ||
      data.length > FILE_LIMITS.chunk ||
      data.toString('base64') !== r.data ||
      digest(data) !== r.sha256 ||
      offset + data.length > u.size
    )
      throw new Error('File chunk size, encoding or checksum mismatch');
    if (offset > u.offset) throw new Error('File chunk arrived out of order');
    const fd = await fs.open(
      path.join(
        await this.internal(u.rootId, 'uploads', path.posix.dirname(u.path) === '.' ? '' : path.posix.dirname(u.path)),
        u.id
      ),
      constants.O_RDWR | constants.O_NOFOLLOW
    );
    try {
      if (!(await fd.stat()).isFile()) throw new Error('Invalid staged file');
      if (offset < u.offset) {
        if (offset + data.length > u.offset) throw new Error('File chunk overlaps the acknowledged boundary');
        const previous = Buffer.alloc(data.length);
        const read = await fd.read(previous, 0, previous.length, offset);
        if (read.bytesRead !== previous.length || digest(previous) !== r.sha256)
          throw new Error('Conflicting duplicate file chunk');
        return this.viewUpload(u);
      }
      await fd.truncate(u.offset); // A crash can leave durable bytes ahead of the last journal acknowledgement.
      let written = 0;
      while (written < data.length) {
        const part = await fd.write(data, written, data.length - written, offset + written);
        if (!part.bytesWritten) throw new Error('File write made no progress');
        written += part.bytesWritten;
      }
      await fd.datasync();
      u.offset += written;
      this.persistUpload(u);
      return this.viewUpload(u);
    } finally {
      await fd.close();
    }
  }
  private async commitWrite(actor: string, id: string) {
    const u = this.upload(actor, id);
    if (u.state === 'complete') return this.viewUpload(u);
    if (u.state === 'aborted' || u.offset !== u.size) throw new Error('Cannot commit an incomplete write');
    const staged = path.join(
      await this.internal(u.rootId, 'uploads', path.posix.dirname(u.path) === '.' ? '' : path.posix.dirname(u.path)),
      u.id
    );
    const target = await this.resolve(u.rootId, u.path, true, true);
    const sourceStat = await fs.lstat(staged, { bigint: true });
    if (!sourceStat.isFile() || sourceStat.size !== BigInt(u.size)) throw new Error('Staged file size changed');
    const hash = createHash('sha256'),
      fd = await fs.open(staged, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      for await (const chunk of fd.createReadStream({ autoClose: false, highWaterMark: FILE_LIMITS.chunk }))
        hash.update(chunk);
    } finally {
      await fd.close();
    }
    u.sha256 = hash.digest('hex');
    u.state = 'committing';
    this.persistUpload(u);
    try {
      await fs.link(staged, target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const dest = await fs.lstat(target, { bigint: true });
      // An acknowledgement can be lost after link(). Only our exact staged inode is a successful retry.
      if (dest.ino !== sourceStat.ino || dest.dev !== sourceStat.dev)
        throw new Error('Destination exists; nothing was overwritten', { cause: e });
    }
    await syncDirectory(path.dirname(target));
    u.state = 'complete';
    this.persistUpload(u);
    await fs.unlink(staged);
    await syncDirectory(path.dirname(staged));
    return this.viewUpload(u);
  }
  private async acknowledgeWrite(actor: string, id: string): Promise<void> {
    identifier(id);
    if (!this.store.kvGetSync(`files:upload:${id}`)) return;
    const u = this.upload(actor, id);
    if (!['complete', 'aborted'].includes(u.state)) throw new Error('Only a final receipt can be acknowledged');
    // The caller has durably advanced its cursor. Free admission capacity without touching the published file.
    const staged = path.join(
      await this.internal(u.rootId, 'uploads', path.posix.dirname(u.path) === '.' ? '' : path.posix.dirname(u.path)),
      id
    );
    await fs.unlink(staged).catch((e) => {
      if (!missing(e)) throw e;
    });
    this.store.kvSetSync(
      'files:uploads:index',
      this.index('uploads').filter((key) => key !== id)
    );
    this.store.kvDeleteSync(`files:upload:${id}`);
  }
  private async abortWrite(actor: string, id: string) {
    const u = this.upload(actor, id);
    if (u.state === 'committing') throw new Error('Commit outcome must be reconciled before cancelling');
    if (u.state === 'receiving') {
      const p = path.join(
        await this.internal(u.rootId, 'uploads', path.posix.dirname(u.path) === '.' ? '' : path.posix.dirname(u.path)),
        u.id
      );
      u.state = 'aborted';
      this.persistUpload(u);
      await fs.unlink(p).catch((e) => {
        if (!missing(e)) throw e;
      });
    }
    return this.viewUpload(u);
  }
}
