import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryStorage } from '../../../src/storage/memory';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  describe('CRUD operations', () => {
    it('should write and read data', async () => {
      const data = { foo: 'bar' };
      await storage.write('test/path', data);

      const result = await storage.read('test/path');
      expect(result).toEqual(data);
    });

    it('should throw error when reading non-existent path', async () => {
      await expect(storage.read('non-existent')).rejects.toThrow('Path not found');
    });

    it('should check if path exists', async () => {
      await storage.write('test/path', { foo: 'bar' });

      expect(await storage.exists('test/path')).toBe(true);
      expect(await storage.exists('non-existent')).toBe(false);
    });

    it('should delete data', async () => {
      await storage.write('test/path', { foo: 'bar' });
      await storage.delete('test/path');

      expect(await storage.exists('test/path')).toBe(false);
    });

    it('should throw error when deleting non-existent path', async () => {
      await expect(storage.delete('non-existent')).rejects.toThrow('Path not found');
    });
  });

  describe('Bulk operations', () => {
    it('should read many paths', async () => {
      await storage.write('path1', { value: 1 });
      await storage.write('path2', { value: 2 });
      await storage.write('path3', { value: 3 });

      const results = await storage.readMany(['path1', 'path2', 'path3']);
      expect(results).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
    });

    it('should write many entries', async () => {
      await storage.writeMany([
        { path: 'path1', data: { value: 1 } },
        { path: 'path2', data: { value: 2 } },
        { path: 'path3', data: { value: 3 } },
      ]);

      expect(await storage.read('path1')).toEqual({ value: 1 });
      expect(await storage.read('path2')).toEqual({ value: 2 });
      expect(await storage.read('path3')).toEqual({ value: 3 });
    });
  });

  describe('List operations', () => {
    it('should list paths with prefix', async () => {
      await storage.write('test/path1', { value: 1 });
      await storage.write('test/path2', { value: 2 });
      await storage.write('other/path', { value: 3 });

      const results = await storage.list('test/');
      expect(results).toHaveLength(2);
      expect(results).toContain('test/path1');
      expect(results).toContain('test/path2');
    });

    it('should return empty array for non-matching prefix', async () => {
      await storage.write('test/path', { value: 1 });

      const results = await storage.list('other/');
      expect(results).toEqual([]);
    });
  });

  describe('Watch operations', () => {
    it('should notify on write (create)', async () => {
      const events: any[] = [];
      const disposable = storage.watch('test/path', (event) => {
        events.push(event);
      });

      await storage.write('test/path', { foo: 'bar' });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('created');
      expect(events[0].path).toBe('test/path');

      disposable.dispose();
    });

    it('should notify on write (modify)', async () => {
      await storage.write('test/path', { foo: 'bar' });

      const events: any[] = [];
      const disposable = storage.watch('test/path', (event) => {
        events.push(event);
      });

      await storage.write('test/path', { foo: 'baz' });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('modified');

      disposable.dispose();
    });

    it('should notify on delete', async () => {
      await storage.write('test/path', { foo: 'bar' });

      const events: any[] = [];
      const disposable = storage.watch('test/path', (event) => {
        events.push(event);
      });

      await storage.delete('test/path');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('deleted');

      disposable.dispose();
    });

    it('should stop notifying after dispose', async () => {
      const events: any[] = [];
      const disposable = storage.watch('test/path', (event) => {
        events.push(event);
      });

      await storage.write('test/path', { foo: 'bar' });
      expect(events).toHaveLength(1);

      disposable.dispose();

      await storage.write('test/path', { foo: 'baz' });
      expect(events).toHaveLength(1); // No new event
    });
  });

  describe('Clear operation', () => {
    it('should clear all data', async () => {
      await storage.write('path1', { value: 1 });
      await storage.write('path2', { value: 2 });

      storage.clear();

      expect(await storage.exists('path1')).toBe(false);
      expect(await storage.exists('path2')).toBe(false);
    });
  });
});
