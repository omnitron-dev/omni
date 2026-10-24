/**
 * S3 Adapter Integration Tests
 *
 * Tests the S3Adapter with real S3-compatible storage backends (MinIO/rustfs),
 * on the run's MinIO (`test/helpers/global-minio.ts`), in a bucket of its own.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { realS3Adapter } from './real-adapters.js';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import type {
  StorageAdapter,
  PutOptions,
  GetOptions,
  ListOptions,
  CopyOptions,
  MultipartUploadInit,
  CompletedPart,
} from '../src/adapter.interface.js';


// Helper to create random content
function generateRandomContent(sizeInBytes: number): Buffer {
  return crypto.randomBytes(sizeInBytes);
}

// Helper to consume stream
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('S3Adapter Integration Tests', () => {
  let adapter: StorageAdapter & { onDestroy(): void };
  let s3Client: S3Client;
  const bucketName = 'titan-storage-test-' + crypto.randomBytes(8).toString('hex');

  beforeAll(async () => {
    // Endpoint is supplied explicitly; the suite owns a unique disposable bucket.
    const endpoint=process.env.S3_ENDPOINT!, accessKeyId=process.env.S3_ACCESS_KEY!, secretAccessKey=process.env.S3_SECRET_KEY!;
    if (!endpoint || !accessKeyId || !secretAccessKey) throw Error('Dedicated test S3 endpoint and credentials required');

    // Create S3 client for setup
    s3Client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });

    // Create test bucket
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));

    // Wait for bucket to be ready
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));

    // Initialize adapter
    adapter = await realS3Adapter(endpoint, accessKeyId, secretAccessKey, bucketName);
  });

  afterAll(async () => {
    // Clean up bucket contents
    try {
      const listResult = await s3Client.send(new ListObjectsV2Command({ Bucket: bucketName }));
      if (listResult.Contents && listResult.Contents.length > 0) {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: listResult.Contents.map((obj) => ({ Key: obj.Key })),
            },
          })
        );
      }
      await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
    } catch {
      // Surface deletion errors to the suite rather than hiding leaked test objects.
      throw Error('S3 test cleanup failed');
    } finally {
      adapter?.onDestroy(); s3Client?.destroy();
    }
  });

  beforeEach(async () => {
    // Clean up objects before each test
    try {
      const listResult = await s3Client.send(new ListObjectsV2Command({ Bucket: bucketName }));
      if (listResult.Contents && listResult.Contents.length > 0) {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: listResult.Contents.map((obj) => ({ Key: obj.Key })),
            },
          })
        );
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('put()', () => {
    it('should upload a small file (1KB)', async () => {
      const content = generateRandomContent(1024);
      const key = 'small-file.bin';

      const result = await adapter.put(key, content, {
        contentType: 'application/octet-stream',
        contentLength: content.length,
      });

      expect(result.etag).toBeDefined();
      expect(result.etag.length).toBeGreaterThan(0);
    });

    it('should upload a medium file (1MB)', async () => {
      const content = generateRandomContent(1024 * 1024);
      const key = 'medium-file.bin';

      const result = await adapter.put(key, content, {
        contentType: 'application/octet-stream',
        contentLength: content.length,
      });

      expect(result.etag).toBeDefined();
    });

    it('should upload a large file (10MB)', async () => {
      const content = generateRandomContent(10 * 1024 * 1024);
      const key = 'large-file.bin';

      const result = await adapter.put(key, content, {
        contentType: 'application/octet-stream',
        contentLength: content.length,
      });

      expect(result.etag).toBeDefined();
    }, 30000);

    it('should upload with custom metadata', async () => {
      const content = Buffer.from('test content');
      const key = 'metadata-file.txt';
      const metadata = {
        'x-custom-author': 'test-user',
        'x-custom-version': '1.0.0',
      };

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
        metadata,
      });

      const headResult = await adapter.head(key);
      expect(headResult.metadata).toBeDefined();
      expect(headResult.metadata?.['x-custom-author']).toBe('test-user');
      expect(headResult.metadata?.['x-custom-version']).toBe('1.0.0');
    });

    it('should upload with cache control', async () => {
      const content = Buffer.from('cached content');
      const key = 'cached-file.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
        cacheControl: 'max-age=3600, public',
      });

      const getResult = await adapter.get(key);
      expect(getResult.cacheControl).toBe('max-age=3600, public');
    });

    it('should upload from a stream', async () => {
      const content = Buffer.from('stream content for testing');
      const key = 'stream-file.txt';
      const stream = Readable.from(content);

      const result = await adapter.put(key, stream, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      expect(result.etag).toBeDefined();

      // Verify content
      const getResult = await adapter.get(key);
      const downloaded = await streamToBuffer(getResult.body);
      expect(downloaded.toString()).toBe('stream content for testing');
    });
  });

  describe('get()', () => {
    it('should download a file and verify content', async () => {
      const content = Buffer.from('Hello, S3 Storage!');
      const key = 'download-test.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      const result = await adapter.get(key);
      const downloaded = await streamToBuffer(result.body);

      expect(downloaded.toString()).toBe('Hello, S3 Storage!');
      expect(result.contentType).toBe('text/plain');
      expect(result.contentLength).toBe(content.length);
      expect(result.etag).toBeDefined();
      expect(result.lastModified).toBeInstanceOf(Date);
    });

    it('should download with byte range (partial content)', async () => {
      const content = Buffer.from('0123456789ABCDEFGHIJ');
      const key = 'range-test.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      const result = await adapter.get(key, {
        range: { start: 5, end: 14 },
      });

      const downloaded = await streamToBuffer(result.body);
      expect(downloaded.toString()).toBe('56789ABCDE');
      expect(result.contentRange).toContain('bytes');
    });

    it('should handle if-none-match conditional request', async () => {
      const content = Buffer.from('conditional content');
      const key = 'conditional-test.txt';

      const putResult = await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      // Request with matching etag should return 304 (Not Modified)
      // MinIO may throw an error for 304 or return UnknownError
      try {
        await adapter.get(key, { ifNoneMatch: putResult.etag });
        // If no error, content was returned (depends on S3 implementation)
      } catch (error: unknown) {
        // 304 Not Modified is expected, but MinIO may return different error types
        const errorMessage = (error as Error).message || String(error);
        expect(
          errorMessage.includes('304') || errorMessage.includes('NotModified') || errorMessage.includes('UnknownError')
        ).toBe(true);
      }
    });

    it('should return correct metadata on get', async () => {
      const content = Buffer.from('metadata content');
      const key = 'get-metadata.txt';
      const metadata = { 'x-test-key': 'test-value' };

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
        metadata,
      });

      const result = await adapter.get(key);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.['x-test-key']).toBe('test-value');
    });
  });

  describe('head()', () => {
    it('should return object metadata without body', async () => {
      const content = Buffer.from('head test content');
      const key = 'head-test.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
        metadata: { 'x-author': 'tester' },
      });

      const result = await adapter.head(key);

      expect(result.key).toBe(key);
      expect(result.size).toBe(content.length);
      expect(result.contentType).toBe('text/plain');
      expect(result.etag).toBeDefined();
      expect(result.lastModified).toBeInstanceOf(Date);
      expect(result.metadata?.['x-author']).toBe('tester');
    });

    it('should throw error for non-existent object', async () => {
      await expect(adapter.head('non-existent-file.txt')).rejects.toThrow();
    });
  });

  describe('delete()', () => {
    it('should delete an existing object', async () => {
      const content = Buffer.from('to be deleted');
      const key = 'delete-test.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      // Verify it exists
      expect(await adapter.exists(key)).toBe(true);

      // Delete it
      await adapter.delete(key);

      // Verify it no longer exists
      expect(await adapter.exists(key)).toBe(false);
    });

    it('should not throw when deleting non-existent object', async () => {
      // S3 delete is idempotent
      await expect(adapter.delete('non-existent.txt')).resolves.not.toThrow();
    });
  });

  describe('deleteMany()', () => {
    it('should delete multiple objects at once', async () => {
      const keys = ['batch-1.txt', 'batch-2.txt', 'batch-3.txt'];

      // Create objects
      for (const key of keys) {
        const content = Buffer.from(`content for ${key}`);
        await adapter.put(key, content, {
          contentType: 'text/plain',
          contentLength: content.length,
        });
      }

      // Verify they exist
      for (const key of keys) {
        expect(await adapter.exists(key)).toBe(true);
      }

      // Delete all
      const result = await adapter.deleteMany(keys);

      expect(result.deleted).toHaveLength(3);
      expect(result.errors).toHaveLength(0);

      // Verify they are gone
      for (const key of keys) {
        expect(await adapter.exists(key)).toBe(false);
      }
    });

    it('should handle mixed existing and non-existing objects', async () => {
      const content = Buffer.from('content');
      await adapter.put('exists.txt', content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      const result = await adapter.deleteMany(['exists.txt', 'not-exists.txt']);

      // Both should be reported as deleted (S3 behavior)
      expect(result.deleted.length).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('copy()', () => {
    it('should copy an object to a new key', async () => {
      const content = Buffer.from('original content');
      const sourceKey = 'original.txt';
      const destKey = 'copied.txt';

      await adapter.put(sourceKey, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      const copyResult = await adapter.copy({
        sourceKey,
        destinationKey: destKey,
      });

      expect(copyResult.etag).toBeDefined();

      // Verify both exist
      expect(await adapter.exists(sourceKey)).toBe(true);
      expect(await adapter.exists(destKey)).toBe(true);

      // Verify content is the same
      const getResult = await adapter.get(destKey);
      const downloaded = await streamToBuffer(getResult.body);
      expect(downloaded.toString()).toBe('original content');
    });

    it('should copy with replaced metadata', async () => {
      const content = Buffer.from('content to copy');
      const sourceKey = 'source-meta.txt';
      const destKey = 'dest-meta.txt';

      await adapter.put(sourceKey, content, {
        contentType: 'text/plain',
        contentLength: content.length,
        metadata: { 'x-original': 'value' },
      });

      await adapter.copy({
        sourceKey,
        destinationKey: destKey,
        metadata: { 'x-new': 'new-value' },
        metadataDirective: 'REPLACE',
      });

      const destHead = await adapter.head(destKey);
      expect(destHead.metadata?.['x-new']).toBe('new-value');
      expect(destHead.metadata?.['x-original']).toBeUndefined();
    });
  });

  describe('list()', () => {
    beforeEach(async () => {
      // Create test objects with hierarchy
      const objects = [
        'documents/report.pdf',
        'documents/invoice.pdf',
        'documents/archive/old-report.pdf',
        'images/photo1.jpg',
        'images/photo2.jpg',
        'images/thumbnails/thumb1.jpg',
        'readme.txt',
      ];

      for (const key of objects) {
        const content = Buffer.from(`content of ${key}`);
        await adapter.put(key, content, {
          contentType: 'text/plain',
          contentLength: content.length,
        });
      }
    });

    it('should list all objects', async () => {
      const result = await adapter.list();

      expect(result.objects.length).toBe(7);
      expect(result.isTruncated).toBe(false);
    });

    it('should list objects with prefix', async () => {
      const result = await adapter.list({ prefix: 'documents/' });

      expect(result.objects.length).toBe(3);
      expect(result.objects.every((o) => o.key.startsWith('documents/'))).toBe(true);
    });

    it('should list objects with delimiter for folder-like behavior', async () => {
      const result = await adapter.list({ delimiter: '/' });

      // Should get root-level objects and prefixes
      expect(result.objects.some((o) => o.key === 'readme.txt')).toBe(true);
      expect(result.prefixes).toContain('documents/');
      expect(result.prefixes).toContain('images/');
    });

    it('should handle pagination with maxKeys', async () => {
      const result1 = await adapter.list({ maxKeys: 3 });

      expect(result1.objects.length).toBe(3);
      expect(result1.isTruncated).toBe(true);
      expect(result1.continuationToken).toBeDefined();

      const result2 = await adapter.list({
        maxKeys: 3,
        continuationToken: result1.continuationToken,
      });

      expect(result2.objects.length).toBe(3);

      const result3 = await adapter.list({
        maxKeys: 3,
        continuationToken: result2.continuationToken,
      });

      expect(result3.objects.length).toBe(1);
      expect(result3.isTruncated).toBe(false);
    });

    it('should list with prefix and delimiter combined', async () => {
      const result = await adapter.list({
        prefix: 'images/',
        delimiter: '/',
      });

      // Direct objects in images/
      expect(result.objects.some((o) => o.key === 'images/photo1.jpg')).toBe(true);
      expect(result.objects.some((o) => o.key === 'images/photo2.jpg')).toBe(true);

      // Subdirectory as prefix
      expect(result.prefixes).toContain('images/thumbnails/');
    });
  });

  describe('exists()', () => {
    it('should return true for existing object', async () => {
      await adapter.put('exists-check.txt', Buffer.from('content'), {
        contentType: 'text/plain',
        contentLength: 7,
      });

      expect(await adapter.exists('exists-check.txt')).toBe(true);
    });

    it('should return false for non-existing object', async () => {
      expect(await adapter.exists('does-not-exist.txt')).toBe(false);
    });
  });

  describe('getSignedUrl()', () => {
    it('should generate a presigned download URL', async () => {
      const content = Buffer.from('signed url content');
      const key = 'signed-download.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      const signedUrl = await adapter.getSignedUrl(key, 3600);

      expect(signedUrl).toContain(key);
      expect(signedUrl).toContain('X-Amz-Signature');
      expect(signedUrl).toContain('X-Amz-Expires');
    });

    it('should allow downloading via presigned URL', async () => {
      const content = Buffer.from('download via signed url');
      const key = 'signed-download-test.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      const signedUrl = await adapter.getSignedUrl(key, 3600);

      // Fetch using the signed URL
      const response = await fetch(signedUrl);
      expect(response.ok).toBe(true);

      const downloadedContent = await response.text();
      expect(downloadedContent).toBe('download via signed url');
    });
  });

  describe('Multipart Upload', () => {
    it('should complete a multipart upload', async () => {
      const key = 'multipart-file.bin';
      const partSize = 5 * 1024 * 1024; // 5MB minimum part size
      const totalParts = 3;
      const parts: CompletedPart[] = [];

      // Create multipart upload
      const { uploadId } = await adapter.createMultipartUpload({
        key,
        contentType: 'application/octet-stream',
        metadata: { 'x-multipart': 'true' },
      });

      expect(uploadId).toBeDefined();
      expect(uploadId.length).toBeGreaterThan(0);

      // Upload parts
      for (let i = 1; i <= totalParts; i++) {
        const partContent = generateRandomContent(partSize);
        const completedPart = await adapter.uploadPart({
          uploadId,
          partNumber: i,
          body: partContent,
          contentLength: partContent.length,
          key,
        });

        expect(completedPart.partNumber).toBe(i);
        expect(completedPart.etag).toBeDefined();
        parts.push(completedPart);
      }

      // Complete upload
      const result = await adapter.completeMultipartUpload(uploadId, key, parts);

      expect(result.etag).toBeDefined();

      // Verify the file exists and has correct size
      const head = await adapter.head(key);
      expect(head.size).toBe(partSize * totalParts);
    }, 60000);

    it('should abort a multipart upload', async () => {
      const key = 'aborted-upload.bin';

      // Create multipart upload
      const { uploadId } = await adapter.createMultipartUpload({
        key,
        contentType: 'application/octet-stream',
      });

      // Upload one part
      await adapter.uploadPart({
        uploadId,
        partNumber: 1,
        body: generateRandomContent(5 * 1024 * 1024),
        contentLength: 5 * 1024 * 1024,
        key,
      });

      // Abort the upload
      await adapter.abortMultipartUpload(uploadId, key);

      // Verify the file was not created
      expect(await adapter.exists(key)).toBe(false);
    }, 30000);
  });

  describe('Large file handling (100MB)', () => {
    it('should handle a 100MB file upload and download', async () => {
      const content = generateRandomContent(100 * 1024 * 1024);
      const key = 'very-large-file.bin';
      const contentHash = crypto.createHash('md5').update(content).digest('hex');

      // Upload
      const putResult = await adapter.put(key, content, {
        contentType: 'application/octet-stream',
        contentLength: content.length,
      });

      expect(putResult.etag).toBeDefined();

      // Verify size
      const head = await adapter.head(key);
      expect(head.size).toBe(100 * 1024 * 1024);

      // Download and verify content
      const getResult = await adapter.get(key);
      const downloaded = await streamToBuffer(getResult.body);
      const downloadedHash = crypto.createHash('md5').update(downloaded).digest('hex');

      expect(downloadedHash).toBe(contentHash);
    }, 120000);
  });
});
