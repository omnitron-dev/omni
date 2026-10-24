import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import type { Readable } from 'stream';
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

interface S3Config {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  maxSockets?: number;
  connectionTimeout?: number;
  socketTimeout?: number;
}

const STORAGE_INFO_CACHE_TTL = 60_000; // 60 seconds

/**
 * Keys per `DeleteObjects` request. The S3 API's own ceiling — a longer list
 * is rejected as `MalformedXML`, and the request fails whole.
 */
const S3_DELETE_BATCH = 1_000;

@Injectable()
export class S3Adapter implements StorageAdapter {
  private client!: S3Client;
  private bucket!: string;
  private storageInfoCache: { data: StorageInfo; expiresAt: number } | null = null;

  constructor(
    @Inject(CONFIG_SERVICE_TOKEN) private readonly config: ConfigService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule
  ) {}

  async onInit() {
    // Try config first, fall back to orchestrator-injected generic env vars
    let s3Config = this.config.get('storage.s3') as S3Config | undefined;

    if (!s3Config) {
      // Orchestrator injects S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET
      // when the default.json file can't be loaded (CWD mismatch in bootstrap mode)
      const endpoint = process.env['S3_ENDPOINT'];
      const accessKeyId = process.env['S3_ACCESS_KEY'];
      const secretAccessKey = process.env['S3_SECRET_KEY'];
      const bucket = process.env['S3_BUCKET'];

      if (endpoint && accessKeyId && secretAccessKey && bucket) {
        s3Config = { endpoint, accessKeyId, secretAccessKey, bucket };
      } else {
        throw new Error(
          'S3 configuration missing: storage.s3 is undefined and S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET env vars are not set. ' +
          'Check that config/default.json is loadable or that the orchestrator injects S3 env vars.'
        );
      }
    }

    // Configure connection pooling
    const maxSockets = s3Config.maxSockets || 200;
    const httpAgent = new HttpAgent({ keepAlive: true, maxSockets });
    const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets });

    this.client = new S3Client({
      ...(s3Config.endpoint !== undefined && { endpoint: s3Config.endpoint }),
      region: s3Config.region || 'us-east-1',
      forcePathStyle: s3Config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      requestHandler: new NodeHttpHandler({
        httpAgent,
        httpsAgent,
        connectionTimeout: s3Config.connectionTimeout || 5000,
        socketTimeout: s3Config.socketTimeout || 30000,
      }),
    });

    this.bucket = s3Config.bucket;

    this.loggerModule.logger.info({ bucket: this.bucket, endpoint: s3Config.endpoint }, 'S3 adapter initialized');
  }

  onDestroy(): void {
    this.client?.destroy();
    this.storageInfoCache = null;
  }

  async put(key: string, body: Readable | Buffer, options: PutOptions): Promise<{ etag: string; versionId?: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      ContentLength: options.contentLength,
      Metadata: options.metadata,
      CacheControl: options.cacheControl,
      ContentDisposition: options.contentDisposition,
      ContentEncoding: options.contentEncoding,
      ChecksumSHA256: options.checksumSHA256,
    });

    const result = await this.client.send(command);

    return {
      etag: result.ETag?.replace(/"/g, '') || '',
      ...(result.VersionId !== undefined && { versionId: result.VersionId }),
    };
  }

  async get(key: string, options?: GetOptions): Promise<GetResult> {
    const input: GetObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
    };

    if (options?.range) {
      input.Range = `bytes=${options.range.start}-${options.range.end}`;
    }
    if (options?.ifNoneMatch) {
      input.IfNoneMatch = options.ifNoneMatch;
    }
    if (options?.ifModifiedSince) {
      input.IfModifiedSince = options.ifModifiedSince;
    }

    const command = new GetObjectCommand(input);
    const result = await this.client.send(command);

    return {
      body: result.Body as Readable,
      contentType: result.ContentType || 'application/octet-stream',
      contentLength: result.ContentLength || 0,
      ...(result.ContentRange !== undefined && { contentRange: result.ContentRange }),
      etag: result.ETag?.replace(/"/g, '') || '',
      lastModified: result.LastModified || new Date(),
      ...(result.Metadata !== undefined && { metadata: result.Metadata }),
      ...(result.CacheControl !== undefined && { cacheControl: result.CacheControl }),
    };
  }

  async head(key: string): Promise<StorageObject> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const result = await this.client.send(command);

    return {
      key,
      size: result.ContentLength || 0,
      etag: result.ETag?.replace(/"/g, '') || '',
      contentType: result.ContentType || 'application/octet-stream',
      lastModified: result.LastModified || new Date(),
      ...(result.Metadata !== undefined && { metadata: result.Metadata }),
    };
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  /**
   * Delete many keys, in requests S3 will accept.
   *
   * `DeleteObjects` takes at most 1 000 keys and answers a longer list with
   * `MalformedXML` — the whole call fails, not the surplus. This used to send
   * every key in one command, and its callers are folder deletes and folder
   * renames, where the key count is the number of files a person put in a
   * folder. Above a thousand, cleanup failed entirely; below it, it worked;
   * nothing in between warned.
   *
   * The limit is a fact about the S3 API, so it is answered here rather than
   * in each of the seven call sites — none of which knew about it.
   *
   * Errors accumulate rather than throw: a chunk that reports per-key errors
   * is the documented shape, and the caller is told which keys failed across
   * the whole request.
   */
  async deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: string }> }> {
    const deleted: string[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (let i = 0; i < keys.length; i += S3_DELETE_BATCH) {
      const chunk = keys.slice(i, i + S3_DELETE_BATCH);
      const command = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: chunk.map((key) => ({ Key: key })),
          Quiet: false,
        },
      });

      const result = await this.client.send(command);
      for (const d of result.Deleted ?? []) deleted.push(d.Key || '');
      for (const e of result.Errors ?? []) errors.push({ key: e.Key || '', error: e.Message || '' });
    }

    return { deleted, errors };
  }

  async copy(options: CopyOptions): Promise<{ etag: string; versionId?: string }> {
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${options.sourceKey}`,
      Key: options.destinationKey,
      Metadata: options.metadata,
      MetadataDirective: options.metadataDirective || 'COPY',
    });

    const result = await this.client.send(command);

    return {
      etag: result.CopyObjectResult?.ETag?.replace(/"/g, '') || '',
      ...(result.VersionId !== undefined && { versionId: result.VersionId }),
    };
  }

  async list(options?: ListOptions): Promise<ListResult> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: options?.prefix,
      Delimiter: options?.delimiter,
      MaxKeys: options?.maxKeys || 1000,
      ContinuationToken: options?.continuationToken,
    });

    const result = await this.client.send(command);

    return {
      objects:
        result.Contents?.map((obj) => ({
          key: obj.Key || '',
          size: obj.Size || 0,
          etag: obj.ETag?.replace(/"/g, '') || '',
          contentType: '', // Not available in list
          lastModified: obj.LastModified || new Date(),
        })) || [],
      prefixes: result.CommonPrefixes?.map((p) => p.Prefix || '') || [],
      isTruncated: result.IsTruncated || false,
      ...(result.NextContinuationToken !== undefined && { continuationToken: result.NextContinuationToken }),
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
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  // Multipart upload methods
  async createMultipartUpload(options: MultipartUploadInit): Promise<{ uploadId: string }> {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: options.key,
      ContentType: options.contentType,
      Metadata: options.metadata,
    });

    const result = await this.client.send(command);

    return { uploadId: result.UploadId || '' };
  }

  async uploadPart(options: UploadPart & { key: string }): Promise<CompletedPart> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: options.key,
      UploadId: options.uploadId,
      PartNumber: options.partNumber,
      Body: options.body,
      ContentLength: options.contentLength,
    });

    const result = await this.client.send(command);

    return {
      partNumber: options.partNumber,
      etag: result.ETag?.replace(/"/g, '') || '',
    };
  }

  async listParts(uploadId: string, key: string): Promise<UploadedPart[]> {
    // Paged: S3 returns at most 1000 parts per call and an upload may hold up
    // to 10 000, so a single call silently truncates a large upload and the
    // completion then fails for the parts it did not mention.
    const out: UploadedPart[] = [];
    let marker: number | undefined;
    do {
      const result = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          ...(marker !== undefined && { PartNumberMarker: String(marker) }),
        })
      );
      for (const part of result.Parts ?? []) {
        if (part.PartNumber == null) continue;
        out.push({
          partNumber: part.PartNumber,
          // S3 quotes ETags; `completeMultipartUpload` is given them the same
          // way `uploadPart` returns them, unquoted.
          etag: (part.ETag ?? '').replace(/"/g, ''),
          size: Number(part.Size ?? 0),
          lastModified: part.LastModified ?? new Date(0),
        });
      }
      marker = result.IsTruncated ? Number(result.NextPartNumberMarker ?? 0) : undefined;
    } while (marker !== undefined);

    out.sort((a, b) => a.partNumber - b.partNumber);
    return out;
  }

  async completeMultipartUpload(
    uploadId: string,
    key: string,
    parts: CompletedPart[]
  ): Promise<{ etag: string; versionId?: string }> {
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
        })),
      },
    });

    const result = await this.client.send(command);

    return {
      etag: result.ETag?.replace(/"/g, '') || '',
      ...(result.VersionId !== undefined && { versionId: result.VersionId }),
    };
  }

  async abortMultipartUpload(uploadId: string, key: string): Promise<void> {
    const command = new AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    });

    await this.client.send(command);
  }

  async getStorageInfo(): Promise<StorageInfo> {
    // Return cached result if still valid
    if (this.storageInfoCache && Date.now() < this.storageInfoCache.expiresAt) {
      return this.storageInfoCache.data;
    }

    let usedBytes = 0;
    let objectCount = 0;
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      });

      const result = await this.client.send(command);

      if (result.Contents) {
        for (const obj of result.Contents) {
          usedBytes += obj.Size ?? 0;
          objectCount++;
        }
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    const info: StorageInfo = { usedBytes, objectCount };
    this.storageInfoCache = { data: info, expiresAt: Date.now() + STORAGE_INFO_CACHE_TTL };

    return info;
  }
}
