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

    this.loggerModule.logger.info({ basePath: this.basePath }, 'Local adapter initialized');
  }

  /**
   * Resolve a key under the storage root, and refuse anything that lands
   * outside it.
   *
   * `path.join` COLLAPSES `..`, which is the whole reason a key must never
   * carry one. `objectStorageKey` is where that is enforced, and it is the
   * right place — but this adapter takes a plain string, and a belt at the
   * point of the file operation costs one comparison. If the two ever
   * disagree, the file system is the one that matters.
   */
  private resolveUnderRoot(relative: string): string {
    const root = path.resolve(this.basePath);
    const full = path.resolve(root, relative);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Refusing a storage path outside the root: ${relative}`);
    }
    return full;
  }

  private getObjectPath(key: string): string {
    return this.resolveUnderRoot(key);
  }

  private getMetadataPath(key: string): string {
    return this.resolveUnderRoot(`${key}.meta.json`);
  }

  private async saveMetadata(key: string, metadata: ObjectMetadata): Promise<void> {
    const metaPath = this.getMetadataPath(key);
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  private async loadMetadata(key: string): Promise<ObjectMetadata> {
    const metaPath = this.getMetadataPath(key);
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
    const objectPath = this.getObjectPath(key);
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
    const objectPath = this.getObjectPath(key);
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
    const objectPath = this.getObjectPath(key);
    const metaPath = this.getMetadataPath(key);

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
    const sourcePath = this.getObjectPath(options.sourceKey);
    const destPath = this.getObjectPath(options.destinationKey);

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

  async list(options?: ListOptions): Promise<ListResult> {
    const prefix = options?.prefix || '';
    const delimiter = options?.delimiter;
    const maxKeys = options?.maxKeys || 1000;

    const objects: StorageObject[] = [];
    const prefixes = new Set<string>();

    const searchPath = path.join(this.basePath, prefix);
    const searchDir = delimiter ? path.dirname(searchPath) : this.basePath;

    try {
      await fs.access(searchDir);
    } catch {
      return { objects: [], prefixes: [], isTruncated: false };
    }

    // Recursively find all .meta.json files
    const findMetaFiles = async (dir: string, currentPrefix: string = ''): Promise<void> => {
      if (objects.length >= maxKeys) return;

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (objects.length >= maxKeys) break;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(currentPrefix, entry.name);

        if (entry.isDirectory()) {
          if (delimiter && relativePath.startsWith(prefix)) {
            const delimiterIndex = relativePath.indexOf(delimiter, prefix.length);
            if (delimiterIndex !== -1) {
              prefixes.add(relativePath.substring(0, delimiterIndex + 1));
              continue;
            }
          }
          await findMetaFiles(fullPath, relativePath);
        } else if (entry.name.endsWith('.meta.json')) {
          const key = relativePath.replace(/\.meta\.json$/, '');
          if (key.startsWith(prefix)) {
            try {
              const metadata = await this.loadMetadata(key);
              objects.push({
                key,
                size: metadata.size,
                etag: metadata.etag,
                contentType: metadata.contentType,
                lastModified: new Date(metadata.lastModified),
                ...(metadata.metadata && { metadata: metadata.metadata }),
              });
            } catch {
              // Skip if metadata can't be loaded
            }
          }
        }
      }
    };

    await findMetaFiles(searchDir);

    return {
      objects: objects.slice(0, maxKeys),
      prefixes: Array.from(prefixes).slice(0, maxKeys),
      isTruncated: objects.length > maxKeys,
    };
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
    const objectPath = this.getObjectPath(key);
    return `file://${objectPath}?expires=${Date.now() + expiresIn * 1000}`;
  }

  // Multipart upload methods
  async createMultipartUpload(options: MultipartUploadInit): Promise<{ uploadId: string }> {
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
    if (!upload) {
      throw new Error(`Upload not found: ${options.uploadId}`);
    }

    // Create temporary directory for parts
    const partsDir = path.join(this.basePath, '.uploads', options.uploadId);
    await fs.mkdir(partsDir, { recursive: true });

    const partPath = path.join(partsDir, `part-${options.partNumber}`);

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

  async listParts(uploadId: string, _key: string): Promise<UploadedPart[]> {
    const upload = this.multipartUploads.get(uploadId);
    if (!upload) return [];
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
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    const objectPath = this.getObjectPath(key);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });

    // Concatenate parts in order
    const writeStream = createWriteStream(objectPath);

    for (const part of parts.sort((a, b) => a.partNumber - b.partNumber)) {
      const partData = upload.parts.get(part.partNumber);
      if (!partData) {
        throw new Error(`Part ${part.partNumber} not found`);
      }

      const partStream = createReadStream(partData.path);
      await pipeline(partStream, writeStream, { end: false });
    }

    writeStream.end();

    // Wait for write to finish
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

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
    const partsDir = path.join(this.basePath, '.uploads', uploadId);
    await fs.rm(partsDir, { recursive: true, force: true });
    this.multipartUploads.delete(uploadId);

    return { etag };
  }

  async abortMultipartUpload(uploadId: string, _key: string): Promise<void> {
    const upload = this.multipartUploads.get(uploadId);
    if (!upload) {
      return; // Already cleaned up or doesn't exist
    }

    // Cleanup parts directory
    const partsDir = path.join(this.basePath, '.uploads', uploadId);
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
        } else if (!entry.name.endsWith('.meta.json')) {
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
