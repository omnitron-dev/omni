import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Environment } from '../../../src/core/environment';
import { MemoryStorage } from '../../../src/storage/memory';

describe('Environment Persistence', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-persist-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('File operations', () => {
    it('should load environment from file', async () => {
      const filePath = path.join(tempDir, 'test.yaml');
      const data = {
        name: 'test',
        config: { foo: 'bar', nested: { value: 42 } }
      };

      await fs.writeFile(filePath, JSON.stringify(data));

      const env = await Environment.fromFile(filePath);

      expect(env.get('foo')).toBe('bar');
      expect(env.get('nested.value')).toBe(42);
    });

    it('should save environment to file', async () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' }
      });

      const filePath = path.join(tempDir, 'saved.yaml');
      await env.save(filePath);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('foo: bar');
    });

    it('should save and load roundtrip', async () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar', nested: { value: 42 } }
      });

      const filePath = path.join(tempDir, 'roundtrip.yaml');
      await env.save(filePath);

      const loaded = await Environment.fromFile(filePath);
      expect(loaded.get('foo')).toBe('bar');
      expect(loaded.get('nested.value')).toBe(42);
    });

    it('should throw error when saving without path', async () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' }
      });

      await expect(env.save()).rejects.toThrow('No path specified');
    });
  });

  describe('Storage backend', () => {
    it('should use custom storage backend', async () => {
      const storage = new MemoryStorage();
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' }
      });

      env.setStorage(storage);

      await env.save('test-path');
      expect(await storage.exists('test-path')).toBe(true);
    });

    it('should load with custom storage', async () => {
      const storage = new MemoryStorage();
      await storage.write('test-path', {
        name: 'test',
        config: { foo: 'bar' }
      });

      const env = Environment.create({ name: 'temp', config: {} });
      env.setStorage(storage);
      await env.load('test-path');

      expect(env.get('foo')).toBe('bar');
    });
  });
});
