import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import { Environment } from '../../../src/core/environment';

describe('Environment', () => {
  describe('Creation', () => {
    it('should create environment with basic options', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' },
      });

      expect(env.name).toBe('test');
      expect(env.get('foo')).toBe('bar');
    });

    it('should create environment from object', () => {
      const env = Environment.fromObject({ foo: 'bar', nested: { value: 42 } }, { name: 'test' });

      expect(env.name).toBe('test');
      expect(env.get('foo')).toBe('bar');
      expect(env.get('nested.value')).toBe(42);
    });

    it('should have auto-generated ID and timestamps', () => {
      const env = Environment.create({ name: 'test' });

      expect(env.id).toBeDefined();
      expect(env.createdAt).toBeInstanceOf(Date);
      expect(env.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('CRUD operations', () => {
    let env: Environment;

    beforeEach(() => {
      env = Environment.create({
        name: 'test',
        config: {
          app: { name: 'TestApp', port: 3000 },
          database: { host: 'localhost' },
        },
      });
    });

    it('should get values', () => {
      expect(env.get('app.name')).toBe('TestApp');
      expect(env.get('app.port')).toBe(3000);
    });

    it('should set values', () => {
      env.set('app.name', 'NewApp');
      expect(env.get('app.name')).toBe('NewApp');
    });

    it('should check if key exists', () => {
      expect(env.has('app.name')).toBe(true);
      expect(env.has('non.existent')).toBe(false);
    });

    it('should delete keys', () => {
      env.delete('app.port');
      expect(env.has('app.port')).toBe(false);
    });

    it('should update metadata on changes', () => {
      const initialCount = env.metadata.changeCount;
      env.set('new.key', 'value');
      expect(env.metadata.changeCount).toBe(initialCount + 1);
    });
  });

  describe('Merge operations', () => {
    it('should merge two environments', () => {
      const env1 = Environment.create({
        name: 'base',
        config: { a: 1, b: 2, nested: { x: 10 } },
      });

      const env2 = Environment.create({
        name: 'override',
        config: { b: 3, c: 4, nested: { y: 20 } },
      });

      const merged = env1.merge(env2);

      expect(merged.get('a')).toBe(1);
      expect(merged.get('b')).toBe(3); // Overridden
      expect(merged.get('c')).toBe(4);
      expect(merged.get('nested.x')).toBe(10);
      expect(merged.get('nested.y')).toBe(20);
    });

    it('should merge with custom strategy', () => {
      const env1 = Environment.create({
        name: 'base',
        config: { value: 1 },
      });

      const env2 = Environment.create({
        name: 'override',
        config: { value: 2 },
      });

      const merged = env1.merge(env2, { conflicts: 'prefer-left' });
      expect(merged.get('value')).toBe(1); // Left preferred
    });
  });

  describe('Diff operations', () => {
    it('should compute diff between environments', () => {
      const env1 = Environment.create({
        name: 'before',
        config: { a: 1, b: 2, c: 3 },
      });

      const env2 = Environment.create({
        name: 'after',
        config: { a: 1, b: 5, d: 4 },
      });

      const diff = env1.diff(env2);

      expect(diff.added).toHaveProperty('d');
      expect(diff.modified).toHaveProperty('b');
      expect(diff.deleted).toContain('c');
    });

    it('should have metadata in diff', () => {
      const env1 = Environment.create({ name: 'env1', config: {} });
      const env2 = Environment.create({ name: 'env2', config: {} });

      const diff = env1.diff(env2);

      expect(diff.metadata.env1Id).toBe(env1.id);
      expect(diff.metadata.env2Id).toBe(env2.id);
      expect(diff.metadata.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Patch operations', () => {
    it('should apply diff patch', () => {
      const env1 = Environment.create({
        name: 'base',
        config: { a: 1, b: 2, c: 3 },
      });

      const env2 = Environment.create({
        name: 'target',
        config: { a: 1, b: 5, d: 4 },
      });

      const diff = env1.diff(env2);
      const patched = env1.patch(diff);

      expect(patched.get('a')).toBe(1);
      expect(patched.get('b')).toBe(5);
      expect(patched.has('c')).toBe(false);
      expect(patched.get('d')).toBe(4);
    });
  });

  describe('Clone operations', () => {
    it('should clone environment', () => {
      const env = Environment.create({
        name: 'original',
        config: { foo: 'bar', nested: { value: 42 } },
      });

      const cloned = env.clone();

      expect(cloned.name).toContain('clone');
      expect(cloned.id).not.toBe(env.id);
      expect(cloned.get('foo')).toBe('bar');
      expect(cloned.get('nested.value')).toBe(42);
    });

    it('should create independent clone', () => {
      const env = Environment.create({
        name: 'original',
        config: { foo: 'bar' },
      });

      const cloned = env.clone();
      cloned.set('foo', 'baz');

      expect(env.get('foo')).toBe('bar');
      expect(cloned.get('foo')).toBe('baz');
    });
  });

  describe('Validation', () => {
    it('should validate with schema', async () => {
      const schema = z.object({
        app: z.object({
          name: z.string(),
          port: z.number(),
        }),
      });

      const env = Environment.create({
        name: 'test',
        schema,
        config: { app: { name: 'Test', port: 3000 } },
      });

      const result = await env.validate();
      expect(result.valid).toBe(true);
    });

    it('should fail validation with invalid data', async () => {
      const schema = z.object({
        port: z.number(),
      });

      const env = Environment.create({
        name: 'test',
        schema,
        config: { port: 'invalid' },
      });

      const result = await env.validate();
      expect(result.valid).toBe(false);
    });
  });

  describe('Serialization', () => {
    it('should convert to JSON', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar', nested: { value: 42 } },
      });

      const json = env.toJSON();
      expect(json).toEqual({ foo: 'bar', nested: { value: 42 } });
    });

    it('should convert to YAML', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' },
      });

      const yaml = env.toYAML();
      expect(yaml).toContain('foo: bar');
    });

    it('should convert to object', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' },
      });

      const obj = env.toObject();
      expect(obj).toEqual({ foo: 'bar' });
    });
  });

  describe('Lifecycle', () => {
    it('should activate environment', async () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' },
      });

      await env.activate();
      expect(env.isActive()).toBe(true);
    });

    it('should deactivate environment', async () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' },
      });

      await env.activate();
      await env.deactivate();
      expect(env.isActive()).toBe(false);
    });

    it('should validate before activation', async () => {
      const schema = z.object({
        required: z.string(),
      });

      const env = Environment.create({
        name: 'test',
        schema,
        config: { wrong: 'value' },
      });

      await expect(env.activate()).rejects.toThrow('Validation failed');
    });
  });

  describe('Change callbacks', () => {
    it('should notify on change', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' },
      });

      const changes: any[] = [];
      env.onChange('foo', (newVal, oldVal, path) => {
        changes.push({ newVal, oldVal, path });
      });

      env.set('foo', 'baz');

      expect(changes).toHaveLength(1);
      expect(changes[0].newVal).toBe('baz');
      expect(changes[0].oldVal).toBe('bar');
      expect(changes[0].path).toBe('foo');
    });

    it('should stop notifying after dispose', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' },
      });

      const changes: any[] = [];
      const disposable = env.onChange('foo', (newVal) => {
        changes.push(newVal);
      });

      env.set('foo', 'baz');
      expect(changes).toHaveLength(1);

      disposable.dispose();
      env.set('foo', 'qux');
      expect(changes).toHaveLength(1); // No new change
    });
  });
});
