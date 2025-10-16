import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemStorage } from '../../../src/storage/filesystem';

describe('FileSystemStorage', () => {
  let storage: FileSystemStorage;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-test-'));
    storage = new FileSystemStorage({ basePath: tempDir, encoding: 'json' });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('CRUD operations', () => {
    it('should write and read JSON data', async () => {
      const data = { foo: 'bar', nested: { value: 42 } };
      await storage.write('test.json', data);

      const result = await storage.read('test.json');
      expect(result).toEqual(data);
    });

    it('should check if file exists', async () => {
      await storage.write('test.json', { foo: 'bar' });

      expect(await storage.exists('test.json')).toBe(true);
      expect(await storage.exists('non-existent.json')).toBe(false);
    });

    it('should delete file', async () => {
      await storage.write('test.json', { foo: 'bar' });
      await storage.delete('test.json');

      expect(await storage.exists('test.json')).toBe(false);
    });

    it('should create nested directories', async () => {
      const data = { foo: 'bar' };
      await storage.write('nested/deep/test.json', data);

      const result = await storage.read('nested/deep/test.json');
      expect(result).toEqual(data);
    });
  });

  describe('YAML encoding', () => {
    it('should write and read YAML data', async () => {
      const yamlStorage = new FileSystemStorage({ basePath: tempDir, encoding: 'yaml' });
      const data = { foo: 'bar', nested: { value: 42 } };

      await yamlStorage.write('test.yaml', data);
      const result = await yamlStorage.read('test.yaml');

      expect(result).toEqual(data);
    });
  });

  describe('List operations', () => {
    it('should list files with prefix', async () => {
      await storage.write('test1.json', { value: 1 });
      await storage.write('test2.json', { value: 2 });
      await storage.write('other.json', { value: 3 });

      const results = await storage.list('test');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });
});
