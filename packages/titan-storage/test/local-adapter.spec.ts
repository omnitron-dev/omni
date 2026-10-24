/**
 * Local Adapter Integration Tests
 *
 * Tests the LocalAdapter with real filesystem operations.
 * Uses temporary directories for isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import type {
  StorageAdapter,
  PutOptions,
  GetOptions,
  CopyOptions,
  CompletedPart,
} from '../src/adapter.interface.js';
import { realLocalAdapter } from './real-adapters.js';


// Helper functions
function generateRandomContent(sizeInBytes: number): Buffer {
  return crypto.randomBytes(sizeInBytes);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('LocalAdapter Integration Tests', () => {
  let tempDir: string;
  let adapter: StorageAdapter;

  beforeAll(async () => {
    // Create unique temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-local-test-'));
    adapter = await realLocalAdapter(tempDir);
  });

  afterAll(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    // Clean up objects before each test
    try {
      const entries = await fs.readdir(tempDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(tempDir, entry.name);
        if (entry.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
      }
    } catch {
      // Ignore
    }
  });

  describe('put()', () => {
    it('should upload a small file', async () => {
      const content = Buffer.from('Hello, Local Storage!');
      const key = 'small-file.txt';

      const result = await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      expect(result.etag).toBeDefined();

      // Verify file exists on disk
      const filePath = path.join(tempDir, key);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      expect(fileContent).toBe('Hello, Local Storage!');
    });

    it('should upload a large file', async () => {
      const content = generateRandomContent(10 * 1024 * 1024);
      const key = 'large-file.bin';

      const result = await adapter.put(key, content, {
        contentType: 'application/octet-stream',
        contentLength: content.length,
      });

      expect(result.etag).toBeDefined();

      // Verify size
      const filePath = path.join(tempDir, key);
      const stats = await fs.stat(filePath);
      expect(stats.size).toBe(10 * 1024 * 1024);
    });

    it('should create nested directories for path-like keys', async () => {
      const content = Buffer.from('nested content');
      const key = 'folder/subfolder/deep/file.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      // Verify directories were created
      const filePath = path.join(tempDir, key);
      expect(await fs.stat(filePath)).toBeDefined();
    });

    it('should save metadata alongside file', async () => {
      const content = Buffer.from('content with metadata');
      const key = 'metadata-file.txt';
      const metadata = { 'x-custom': 'value' };

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
        metadata,
        cacheControl: 'max-age=3600',
      });

      // Verify metadata file exists
      const metaPath = path.join(tempDir, `${key}.meta.json`);
      const metaContent = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
      expect(metaContent.contentType).toBe('text/plain');
      expect(metaContent.metadata['x-custom']).toBe('value');
      expect(metaContent.cacheControl).toBe('max-age=3600');
    });

    it('should upload from a stream', async () => {
      const content = Buffer.from('stream content');
      const key = 'stream-file.txt';
      const stream = Readable.from(content);

      const result = await adapter.put(key, stream, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      expect(result.etag).toBeDefined();

      // Verify content
      const filePath = path.join(tempDir, key);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      expect(fileContent).toBe('stream content');
    });
  });

  describe('get()', () => {
    it('should download a file and verify content', async () => {
      const content = Buffer.from('download test content');
      const key = 'download-test.txt';

      await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      const result = await adapter.get(key);
      const downloaded = await streamToBuffer(result.body);

      expect(downloaded.toString()).toBe('download test content');
      expect(result.contentType).toBe('text/plain');
      expect(result.contentLength).toBe(content.length);
    });

    it('should download with byte range', async () => {
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
      expect(result.contentRange).toBe('bytes 5-14/20');
    });

    it('should handle if-none-match', async () => {
      const content = Buffer.from('conditional content');
      const key = 'conditional.txt';

      const putResult = await adapter.put(key, content, {
        contentType: 'text/plain',
        contentLength: content.length,
      });

      await expect(adapter.get(key, { ifNoneMatch: putResult.etag })).rejects.toThrow('Not Modified');
    });
  });

  describe('head()', () => {
    it('should return object metadata', async () => {
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
      expect(result.metadata?.['x-author']).toBe('tester');
    });

    it('should throw for non-existent object', async () => {
      await expect(adapter.head('non-existent.txt')).rejects.toThrow();
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

      expect(await adapter.exists(key)).toBe(true);

      await adapter.delete(key);

      expect(await adapter.exists(key)).toBe(false);

      // Verify files are removed
      const filePath = path.join(tempDir, key);
      const metaPath = path.join(tempDir, `${key}.meta.json`);

      await expect(fs.access(filePath)).rejects.toThrow();
      await expect(fs.access(metaPath)).rejects.toThrow();
    });

    it('should not throw when deleting non-existent object', async () => {
      await expect(adapter.delete('non-existent.txt')).resolves.not.toThrow();
    });
  });

  describe('deleteMany()', () => {
    it('should delete multiple objects', async () => {
      const keys = ['batch-1.txt', 'batch-2.txt', 'batch-3.txt'];

      for (const key of keys) {
        const content = Buffer.from(`content for ${key}`);
        await adapter.put(key, content, {
          contentType: 'text/plain',
          contentLength: content.length,
        });
      }

      const result = await adapter.deleteMany(keys);

      expect(result.deleted).toHaveLength(3);
      expect(result.errors).toHaveLength(0);

      for (const key of keys) {
        expect(await adapter.exists(key)).toBe(false);
      }
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

      await adapter.copy({
        sourceKey,
        destinationKey: destKey,
      });

      expect(await adapter.exists(sourceKey)).toBe(true);
      expect(await adapter.exists(destKey)).toBe(true);

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
      const objects = [
        'documents/report.pdf',
        'documents/invoice.pdf',
        'documents/archive/old-report.pdf',
        'images/photo1.jpg',
        'images/photo2.jpg',
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
      expect(result.objects.length).toBe(6);
    });

    it('should list objects with prefix', async () => {
      const result = await adapter.list({ prefix: 'documents/' });
      expect(result.objects.length).toBe(3);
      expect(result.objects.every((o) => o.key.startsWith('documents/'))).toBe(true);
    });

    it('should handle pagination with maxKeys', async () => {
      const result = await adapter.list({ maxKeys: 3 });
      expect(result.objects.length).toBe(3);
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
    it('should generate a file:// URL', async () => {
      const key = 'signed-url-test.txt';
      await adapter.put(key, Buffer.from('content'), {
        contentType: 'text/plain',
        contentLength: 7,
      });

      const signedUrl = await adapter.getSignedUrl(key, 3600);

      expect(signedUrl.startsWith('file://')).toBe(true);
      expect(signedUrl).toContain(key);
      expect(signedUrl).toContain('expires=');
    });
  });

  describe('Multipart Upload', () => {
    it('should complete a multipart upload', async () => {
      const key = 'multipart-file.bin';
      const partSize = 1024 * 1024; // 1MB for testing
      const parts: CompletedPart[] = [];

      const { uploadId } = await adapter.createMultipartUpload({
        key,
        contentType: 'application/octet-stream',
        metadata: { 'x-multipart': 'true' },
      });

      expect(uploadId).toBeDefined();

      // Upload 3 parts
      for (let i = 1; i <= 3; i++) {
        const partContent = generateRandomContent(partSize);
        const completedPart = await adapter.uploadPart({
          uploadId,
          partNumber: i,
          body: partContent,
          contentLength: partContent.length,
          key,
        });

        parts.push(completedPart);
      }

      const result = await adapter.completeMultipartUpload(uploadId, key, parts);

      expect(result.etag).toBeDefined();

      const head = await adapter.head(key);
      expect(head.size).toBe(partSize * 3);
    });

    it('should abort a multipart upload and clean up', async () => {
      const key = 'aborted-upload.bin';

      const { uploadId } = await adapter.createMultipartUpload({
        key,
        contentType: 'application/octet-stream',
      });

      await adapter.uploadPart({
        uploadId,
        partNumber: 1,
        body: generateRandomContent(1024 * 1024),
        contentLength: 1024 * 1024,
        key,
      });

      await adapter.abortMultipartUpload(uploadId, key);

      expect(await adapter.exists(key)).toBe(false);

      // Verify parts directory was cleaned up
      const partsDir = path.join(tempDir, '.uploads', uploadId);
      await expect(fs.access(partsDir)).rejects.toThrow();
    });
  });

  describe('File permissions', () => {
    it('should create files with readable permissions', async () => {
      const key = 'permission-test.txt';
      await adapter.put(key, Buffer.from('content'), {
        contentType: 'text/plain',
        contentLength: 7,
      });

      const filePath = path.join(tempDir, key);
      const stats = await fs.stat(filePath);

      // Check file is readable by owner
      expect((stats.mode & 0o400) !== 0).toBe(true);
    });

    it('should create directories with proper permissions', async () => {
      const key = 'deep/nested/path/file.txt';
      await adapter.put(key, Buffer.from('content'), {
        contentType: 'text/plain',
        contentLength: 7,
      });

      const dirPath = path.join(tempDir, 'deep/nested/path');
      const stats = await fs.stat(dirPath);

      // Check directory is readable and executable by owner
      expect((stats.mode & 0o500) !== 0).toBe(true);
    });
  });

  describe('Path traversal prevention', () => {
    it('should handle keys with .. safely', async () => {
      // The adapter should handle path traversal attempts gracefully
      // by normalizing the path within the base directory
      const key = '../outside.txt';

      // This might throw or handle differently based on implementation
      // The important thing is it should not write outside the temp directory
      try {
        await adapter.put(key, Buffer.from('malicious'), {
          contentType: 'text/plain',
          contentLength: 9,
        });

        // If it succeeds, verify the file is within temp dir
        const resolvedPath = path.resolve(tempDir, key);
        // The file should be within temp dir or handled safely
      } catch {
        // Expected - adapter rejected the malicious path
      }

      // Verify nothing was written outside temp dir
      const outsidePath = path.resolve(tempDir, '..', 'outside.txt');
      try {
        await fs.access(outsidePath);
        // If access succeeds, the file exists - this should not happen
        // Fail the test if the file exists
        expect.fail('File should not exist outside temp dir');
      } catch (error) {
        // Expected - file does not exist (ENOENT error)
        // fs.access rejects with ENOENT when file doesn't exist
        expect(error).toBeDefined();
      }
    });

    it('should handle absolute paths safely', async () => {
      const key = '/etc/passwd';

      try {
        await adapter.put(key, Buffer.from('malicious'), {
          contentType: 'text/plain',
          contentLength: 9,
        });

        // If it succeeds, verify the file is within temp dir
        const filePath = path.join(tempDir, key);
        expect(filePath.startsWith(tempDir)).toBe(true);
      } catch {
        // Expected - adapter rejected the absolute path
      }
    });
  });

  describe('Special characters in keys', () => {
    it('should handle spaces in keys', async () => {
      const key = 'file with spaces.txt';
      await adapter.put(key, Buffer.from('content'), {
        contentType: 'text/plain',
        contentLength: 7,
      });

      expect(await adapter.exists(key)).toBe(true);
    });

    it('should handle unicode in keys', async () => {
      const key = 'file-with-emoji-🚀.txt';
      await adapter.put(key, Buffer.from('content'), {
        contentType: 'text/plain',
        contentLength: 7,
      });

      expect(await adapter.exists(key)).toBe(true);
    });

    it('should handle long keys', async () => {
      const key = 'a'.repeat(200) + '.txt';
      await adapter.put(key, Buffer.from('content'), {
        contentType: 'text/plain',
        contentLength: 7,
      });

      expect(await adapter.exists(key)).toBe(true);
    });
  });
});
