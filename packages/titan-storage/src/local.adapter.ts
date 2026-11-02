import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import * as crypto from 'crypto';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type {
  StorageAdapter,
  StorageInfo,
  GetResult,
  ListResult,
  StorageObject,
  PutOptions,
  GetOptions,
  ListOptions,
  CopyOptions,
  MultipartUploadInit,
  UploadPart,
  CompletedPart,
  UploadedPart,
} from './adapter.interface.js';

interface LocalConfig {
  basePath?: string;
}

interface ObjectMetadata {
  contentType: string;
  size: number;
  etag: string;
  lastModified: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
}

interface MultipartState {
  key: string;
  contentType: string;
  metadata?: Record<string, string>;
  parts: Map<number, { etag: string; path: string }>;
}

@Injectable()
export class LocalAdapter implements StorageAdapter {
  private basePath!: string;
  private multipartUploads = new Map<string, MultipartState>();

  constructor(
    @Inject(CONFIG_SERVICE_TOKEN) private readonly config: ConfigService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule
  ) {}

  async onInit() {
    const localConfig = this.config.get('storage.local') as LocalConfig;
    this.basePath = localConfig?.basePath || './data/storage';
    await fs.mkdir(this.basePath, { recursive: true });
    this.basePath = await fs.realpath(this.basePath);

    this.loggerModule.logger.info({ basePath: this.basePath }, 'Local adapter initialized');
  }

  /** Storage owns this directory. Never follow symbolic links below its configured root. */
  private async resolveUnderRoot(relative: string): Promise<string> {
    const full = path.resolve(this.basePath, relative);
    const fromRoot = path.relative(this.basePath, full);
    if (path.isAbsolute(relative) || path.isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('..' + path.sep)) {
      throw new Error(`Refusing a storage path outside the root: ${relative}`);
    }
    let current = this.basePath;
    for (const piece of fromRoot.split(path.sep)) {
      if (!piece || piece === '.') continue;
      current = path.join(current, piece);
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) {
          throw new Error(`Refusing a symbolic link in storage path: ${relative}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
    return full;
  }

  private getObjectPath(key: string) {
    this.ensureObjectKey(key);
    return this.resolveUnderRoot(key);
  }

  private ensureObjectKey(key: string) {
    if (!key || key.split(/[\\/]/).some(part => part === '.uploads' || part.endsWith('.meta.json'))) {
      throw new Error('Reserved local storage key');
    }
  }

  private getMetadataPath(key: string) {
    this.ensureObjectKey(key);
    return this.resolveUnderRoot(`${key}.meta.json`);
  }

  private async saveMetadata(key: string, metadata: ObjectMetadata): Promise<void> {
    const metaPath = await this.getMetadataPath(key);
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  private async loadMetadata(key: string): Promise<ObjectMetadata> {
    const metaPath = await this.getMetadataPath(key);
    try {
      const content = await fs.readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    } catch (_error) {
      throw new Error(`Metadata not found for key: ${key}`, { cause: _error });
    }
  }

  private async calculateEtag(filePath: string): Promise<string> {
    const hash = crypto.createHash('md5');
    const stream = createReadStream(filePath);

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async put(key: string, body: Readable | Buffer, options: PutOptions): Promise<{ etag: string; versionId?: string }> {
    const objectPath = await this.getObjectPath(key);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });

    // Write object data
    if (Buffer.isBuffer(body)) {
      await fs.writeFile(objectPath, body);
    } else {
      const writeStream = createWriteStream(objectPath);
      await pipeline(body, writeStream);
    }

    // Calculate etag
    const etag = await this.calculateEtag(objectPath);

    // Get file stats
    const stats = await fs.stat(objectPath);

    // Save metadata
    await this.saveMetadata(key, {
      contentType: options.contentType,
      size: stats.size,
      etag,
      lastModified: stats.mtime.toISOString(),
      ...(options.metadata && { metadata: options.metadata }),
      ...(options.cacheControl && { cacheControl: options.cacheControl }),
      ...(options.contentDisposition && { contentDisposition: options.contentDisposition }),
      ...(options.contentEncoding && { contentEncoding: options.contentEncoding }),
    });

    return { etag };
  }

  async get(key: string, options?: GetOptions): Promise<GetResult> {
    const objectPath = await this.getObjectPath(key);
    const metadata = await this.loadMetadata(key);

    // Check if-none-match
    if (options?.ifNoneMatch && options.ifNoneMatch === metadata.etag) {
      throw new Error('Not Modified');
    }

    // Check if-modified-since
    if (options?.ifModifiedSince) {
      const lastModified = new Date(metadata.lastModified);
      if (lastModified <= options.ifModifiedSince) {
        throw new Error('Not Modified');
      }
    }

    let body: Readable;
    let contentRange: string | undefined;
    let contentLength = metadata.size;

    if (options?.range) {
      const { start, end } = options.range;
      body = createReadStream(objectPath, { start, end });
      contentLength = end - start + 1;
      contentRange = `bytes ${start}-${end}/${metadata.size}`;
    } else {
      body = createReadStream(objectPath);
    }

    return {
      body,
      contentType: metadata.contentType,
      contentLength,
      ...(contentRange && { contentRange }),
      etag: metadata.etag,
      lastModified: new Date(metadata.lastModified),
      ...(metadata.metadata && { metadata: metadata.metadata }),
      ...(metadata.cacheControl && { cacheControl: metadata.cacheControl }),
    };
  }

  async head(key: string): Promise<StorageObject> {
    const metadata = await this.loadMetadata(key);

    return {
      key,
      size: metadata.size,
      etag: metadata.etag,
      contentType: metadata.contentType,
      lastModified: new Date(metadata.lastModified),
      ...(metadata.metadata && { metadata: metadata.metadata }),
    };
  }

  async delete(key: string): Promise<void> {
    const objectPath = await this.getObjectPath(key);
    const metaPath = await this.getMetadataPath(key);

    try {
      await fs.unlink(objectPath);
    } catch {
      // Ignore if file doesn't exist
    }

    try {
      await fs.unlink(metaPath);
    } catch {
      // Ignore if metadata doesn't exist
    }
  }

  async deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: string }> }> {
    const deleted: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (const key of keys) {
      try {
        await this.delete(key);
        deleted.push(key);
      } catch (error) {
        errors.push({
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { deleted, errors };
  }

  async copy(options: CopyOptions): Promise<{ etag: string; versionId?: string }> {
    const sourcePath = await this.getObjectPath(options.sourceKey);
    const destPath = await this.getObjectPath(options.destinationKey);

    // Copy file
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(sourcePath, destPath);

    // Handle metadata
    const sourceMetadata = await this.loadMetadata(options.sourceKey);
    let destMetadata: ObjectMetadata;

    if (options.metadataDirective === 'REPLACE' && options.metadata) {
      destMetadata = {
        ...sourceMetadata,
        metadata: options.metadata,
      };
    } else {
      destMetadata = { ...sourceMetadata };
    }

    // Calculate new etag
    const etag = await this.calculateEtag(destPath);
    destMetadata.etag = etag;

    // Save destination metadata
    await this.saveMetadata(options.destinationKey, destMetadata);

    return { etag };
  }

  async list(options: ListOptions = {}): Promise<ListResult> {
    const { prefix = '', delimiter, maxKeys = 1000, continuationToken } = options;
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 0) throw new RangeError('Invalid maxKeys');
    const result: ListResult = { objects: [], prefixes: [], isTruncated: false };
    if (!maxKeys) return result;
    let after = '';
    if (continuationToken !== undefined) {
      const cursor: unknown = JSON.parse(Buffer.from(continuationToken, 'base64url').toString());
      if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== prefix ||
          cursor[1] !== (delimiter ?? '') || typeof cursor[2] !== 'string') throw new Error('Invalid list cursor');
      after = cursor[2];
    }

    // Directory entries and sidecars share the same ordering as the keys they emit.
    // Skip unrelated branches. Only a matching .meta.json identifies a stored object.
    async function* keys(dir: string, parent = ''): AsyncGenerator<string> {
      const entries = (await fs.readdir(dir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() ? entry.name !== '.uploads' : entry.isFile() && entry.name.endsWith('.meta.json'))
        .map(entry => ({ entry, key: parent + (entry.isDirectory() ? entry.name + '/' : entry.name.slice(0, -10)) }))
        .sort((a, b) => a.key < b.key ? -1 : Number(a.key > b.key));
      for (const { entry, key } of entries) {
        if (entry.isDirectory()) {
          if (key.startsWith(prefix) || prefix.startsWith(key)) yield* keys(path.join(dir, entry.name), key);
        } else if (key.startsWith(prefix)) yield key;
      }
    }

    let last: string | undefined;
    for await (const key of keys(this.basePath)) {
      const split = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
      const entry = split < 0 ? key : key.slice(0, split + delimiter!.length);
      if (entry <= after || entry === last) continue;
      if (result.objects.length + result.prefixes.length === maxKeys) {
        result.isTruncated = true;
        result.continuationToken = Buffer.from(JSON.stringify([prefix, delimiter ?? '', last])).toString('base64url');
        break;
      }
      if (split < 0) result.objects.push(await this.head(key));
      else result.prefixes.push(entry);
      last = entry;
    }
    return result;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.head(key);
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    // For local adapter, we can't generate true signed URLs
    // Return a file:// URL as a placeholder
    const objectPath = await this.getObjectPath(key);
    return `file://${objectPath}?expires=${Date.now() + expiresIn * 1000}`;
  }

  // Multipart upload methods
  async createMultipartUpload(options: MultipartUploadInit): Promise<{ uploadId: string }> {
    await this.getObjectPath(options.key);
    const uploadId = generateUuidV7();
    this.multipartUploads.set(uploadId, {
      key: options.key,
      contentType: options.contentType,
      ...(options.metadata && { metadata: options.metadata }),
      parts: new Map(),
    });
    return { uploadId };
  }

  async uploadPart(options: UploadPart & { key: string }): Promise<CompletedPart> {
    const upload = this.multipartUploads.get(options.uploadId);
    if (!upload || upload.key !== options.key) {
      throw new Error(`Upload not found: ${options.uploadId}`);
    }

    // Create temporary directory for parts
    const partsDir = await this.resolveUnderRoot(path.join('.uploads', options.uploadId));
    await fs.mkdir(partsDir, { recursive: true });

    if (!Number.isSafeInteger(options.partNumber) || options.partNumber < 1 || options.partNumber > 10000) {
      throw new Error('Invalid multipart part number');
    }
    const partPath = await this.resolveUnderRoot(path.join('.uploads', options.uploadId, `part-${options.partNumber}`));

    // Write part data
    if (Buffer.isBuffer(options.body)) {
      await fs.writeFile(partPath, options.body);
    } else {
      const writeStream = createWriteStream(partPath);
      await pipeline(options.body, writeStream);
    }

    // Calculate etag for part
    const etag = await this.calculateEtag(partPath);

    upload.parts.set(options.partNumber, { etag, path: partPath });

    return {
      partNumber: options.partNumber,
      etag,
    };
  }

  async listParts(uploadId: string, key: string): Promise<UploadedPart[]> {
    const upload = this.multipartUploads.get(uploadId);
    if (!upload || upload.key !== key) return [];
    const out: UploadedPart[] = [];
    for (const [partNumber, part] of upload.parts) {
      // A part whose file is gone is a part that did not land; leaving it out
      // is the same answer S3 would give.
      const stat = await fs.stat(part.path).catch(() => null);
      if (!stat) continue;
      out.push({ partNumber, etag: part.etag, size: stat.size, lastModified: stat.mtime });
    }
    out.sort((a, b) => a.partNumber - b.partNumber);
    return out;
  }

  async completeMultipartUpload(
    uploadId: string,
    key: string,
    parts: CompletedPart[]
  ): Promise<{ etag: string; versionId?: string }> {
    const upload = this.multipartUploads.get(uploadId);
    if (!upload || upload.key !== key) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    const objectPath = await this.getObjectPath(key);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });

    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const sources: string[] = [];
    for (const [index, part] of ordered.entries()) {
      const stored = upload.parts.get(part.partNumber);
      if (!stored || stored.etag !== part.etag || ordered[index - 1]?.partNumber === part.partNumber) {
        throw new Error(`Missing, duplicate or mismatched part ${part.partNumber}`);
      }
      sources.push(await this.resolveUnderRoot(path.relative(this.basePath, stored.path)));
    }

    // Commit complete bytes on the same filesystem. A failed read leaves the
    // previous object intact and its parts available for retry.
    const staged = await this.resolveUnderRoot(path.join('.uploads', uploadId, generateUuidV7()));
    await fs.mkdir(path.dirname(staged), { recursive: true });
    async function* chunks() {
      for (const source of sources) yield* createReadStream(source);
    }
    try {
      await pipeline(chunks(), createWriteStream(staged, { flags: 'wx' }));
      await fs.rename(staged, objectPath);
    } finally {
      await fs.rm(staged, { force: true });
    }

    // Calculate final etag
    const etag = await this.calculateEtag(objectPath);

    // Get file stats
    const stats = await fs.stat(objectPath);

    // Save metadata
    await this.saveMetadata(key, {
      contentType: upload.contentType,
      size: stats.size,
      etag,
      lastModified: stats.mtime.toISOString(),
      ...(upload.metadata && { metadata: upload.metadata }),
    });

    // Cleanup
    const partsDir = await this.resolveUnderRoot(path.join('.uploads', uploadId));
    await fs.rm(partsDir, { recursive: true, force: true });
    this.multipartUploads.delete(uploadId);

    return { etag };
  }

  async abortMultipartUpload(uploadId: string, key: string): Promise<void> {
    const upload = this.multipartUploads.get(uploadId);
    if (!upload || upload.key !== key) {
      return; // Already cleaned up or belongs to another key
    }

    // Cleanup parts directory
    const partsDir = await this.resolveUnderRoot(path.join('.uploads', uploadId));
    await fs.rm(partsDir, { recursive: true, force: true });

    this.multipartUploads.delete(uploadId);
  }

  async getStorageInfo(): Promise<StorageInfo> {
    let usedBytes = 0;
    let objectCount = 0;

    const scan = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        // A directory that does not exist has nothing to scan — that is the
        // case this catch was written for, and it is fine. Anything else
        // (EACCES, EIO, a mount that went away) means the directory IS there
        // and we could not read it, and returning silently reports its
        // contents as zero. The caller cannot tell that apart from an empty
        // store, so a permissions problem surfaces as "0 bytes used" on the
        // storage dashboard rather than as a fault.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        this.loggerModule.logger.warn(
          { err: error, dir },
          'Could not read directory while computing storage usage — the reported total is incomplete'
        );
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip internal directories
          if (entry.name === '.uploads') continue;
          await scan(fullPath);
        } else if (entry.isFile() && !entry.name.endsWith('.meta.json')) {
          const stat = await fs.stat(fullPath);
          usedBytes += stat.size;
          objectCount++;
        }
      }
    };

    await scan(this.basePath);
    return { usedBytes, objectCount };
  }
}
