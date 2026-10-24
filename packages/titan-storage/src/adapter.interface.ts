import type { Readable } from 'stream';

export interface StorageObject {
  key: string;
  size: number;
  etag: string;
  contentType: string;
  lastModified: Date;
  metadata?: Record<string, string>;
}

export interface PutOptions {
  contentType: string;
  contentLength?: number;
  metadata?: Record<string, string>;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  checksumSHA256?: string;
}

export interface GetOptions {
  range?: { start: number; end: number };
  ifNoneMatch?: string;
  ifModifiedSince?: Date;
}

export interface GetResult {
  body: Readable;
  contentType: string;
  contentLength: number;
  contentRange?: string;
  etag: string;
  lastModified: Date;
  metadata?: Record<string, string>;
  cacheControl?: string;
}

export interface ListOptions {
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListResult {
  objects: StorageObject[];
  prefixes: string[];
  isTruncated: boolean;
  continuationToken?: string;
}

export interface CopyOptions {
  sourceKey: string;
  destinationKey: string;
  metadata?: Record<string, string>;
  metadataDirective?: 'COPY' | 'REPLACE';
}

export interface MultipartUploadInit {
  key: string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface UploadPart {
  uploadId: string;
  partNumber: number;
  body: Readable | Buffer;
  contentLength: number;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/** A part as the BACKEND has it — the authority on what actually landed. */
export interface UploadedPart extends CompletedPart {
  size: number;
  lastModified: Date;
}

export interface StorageInfo {
  usedBytes: number;
  objectCount: number;
}

export interface StorageAdapter {
  put(key: string, body: Readable | Buffer, options: PutOptions): Promise<{ etag: string; versionId?: string }>;
  get(key: string, options?: GetOptions): Promise<GetResult>;
  head(key: string): Promise<StorageObject>;
  delete(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; error: string }> }>;
  copy(options: CopyOptions): Promise<{ etag: string; versionId?: string }>;
  list(options?: ListOptions): Promise<ListResult>;
  exists(key: string): Promise<boolean>;
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
  createMultipartUpload(options: MultipartUploadInit): Promise<{ uploadId: string }>;
  uploadPart(options: UploadPart & { key: string }): Promise<CompletedPart>;
  /**
   * The parts the backend holds for an upload, ascending.
   *
   * `completeMultipartUpload` must be handed each part's ETag, and the only
   * place an ETag exists is the response to `uploadPart` — or here. Keeping a
   * copy in our own database made the database the authority on something it
   * cannot observe: a part that lands and whose row is then lost is invisible,
   * and a row written for a part that failed is a lie. Asking the backend
   * removes both cases.
   */
  listParts(uploadId: string, key: string): Promise<UploadedPart[]>;
  completeMultipartUpload(
    uploadId: string,
    key: string,
    parts: CompletedPart[]
  ): Promise<{ etag: string; versionId?: string }>;
  abortMultipartUpload(uploadId: string, key: string): Promise<void>;
  getStorageInfo(): Promise<StorageInfo>;
}
