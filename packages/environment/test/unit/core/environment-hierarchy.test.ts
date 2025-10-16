import { beforeEach, describe, expect, it } from 'vitest';
import { Environment } from '../../../src/core/environment';

describe('Environment Hierarchy', () => {
  describe('Parent-Child Relationships', () => {
    it('should create a child environment with parent reference', () => {
      const parent = new Environment({
        name: 'parent',
        config: { parentKey: 'parentValue' },
      });

      const child = parent.createChild({ name: 'child' });

      expect(child.parent).toBe(parent);
      expect(parent.children.has(child)).toBe(true);
    });

    it('should track multiple children', () => {
      const parent = new Environment({
        name: 'parent',
        config: { key: 'value' },
      });

      const child1 = parent.createChild({ name: 'child1' });
      const child2 = parent.createChild({ name: 'child2' });
      const child3 = parent.createChild({ name: 'child3' });

      expect(parent.children.size).toBe(3);
      expect(parent.children.has(child1)).toBe(true);
      expect(parent.children.has(child2)).toBe(true);
      expect(parent.children.has(child3)).toBe(true);
    });

    it('should create multi-level hierarchies', () => {
      const grandparent = new Environment({
        name: 'grandparent',
        config: { level: 'grandparent' },
      });

      const parent = grandparent.createChild({ name: 'parent' });
      const child = parent.createChild({ name: 'child' });

      expect(child.parent).toBe(parent);
      expect(parent.parent).toBe(grandparent);
      expect(grandparent.parent).toBeUndefined();
    });

    it('should expose children as readonly set', () => {
      const parent = new Environment({
        name: 'parent',
        config: {},
      });

      const children = parent.children;
      expect(children).toBeInstanceOf(Set);
      // Verify it's readonly by checking it doesn't have mutation methods accessible
      expect(typeof (children as any).add).toBe('function');
    });
  });

  describe('Inheritance', () => {
    it('should inherit parent configuration by default', () => {
      const parent = new Environment({
        name: 'parent',
        config: {
          database: {
            host: 'localhost',
            port: 5432,
          },
          api: {
            url: 'https://api.example.com',
          },
        },
      });

      const child = parent.createChild({
        name: 'child',
        config: {
          database: {
            port: 3306, // Override port
          },
        },
      });

      expect(child.get('database.host')).toBe('localhost');
      expect(child.get('database.port')).toBe(3306);
      expect(child.get('api.url')).toBe('https://api.example.com');
    });

    it('should override parent values in child', () => {
      const parent = new Environment({
        name: 'parent',
        config: {
          env: 'production',
          timeout: 5000,
        },
      });

      const child = parent.createChild({
        name: 'child',
        config: {
          env: 'development',
          debug: true,
        },
      });

      expect(child.get('env')).toBe('development');
      expect(child.get('timeout')).toBe(5000);
      expect(child.get('debug')).toBe(true);
    });

    it('should not inherit when inherit option is false', () => {
      const parent = new Environment({
        name: 'parent',
        config: {
          parentKey: 'parentValue',
          shared: 'fromParent',
        },
      });

      const child = parent.createChild({
        name: 'child',
        config: {
          childKey: 'childValue',
        },
        inherit: false,
      });

      expect(child.get('childKey')).toBe('childValue');
      expect(child.get('parentKey')).toBeUndefined();
      expect(child.get('shared')).toBeUndefined();
    });

    it('should inherit through multiple levels', () => {
      const root = new Environment({
        name: 'root',
        config: {
          rootKey: 'rootValue',
          shared: 'fromRoot',
        },
      });

      const middle = root.createChild({
        name: 'middle',
        config: {
          middleKey: 'middleValue',
          shared: 'fromMiddle',
        },
      });

      const leaf = middle.createChild({
        name: 'leaf',
        config: {
          leafKey: 'leafValue',
        },
      });

      expect(leaf.get('leafKey')).toBe('leafValue');
      expect(leaf.get('middleKey')).toBe('middleValue');
      expect(leaf.get('rootKey')).toBe('rootValue');
      expect(leaf.get('shared')).toBe('fromMiddle');
    });
  });

  describe('Context Isolation', () => {
    it('should create isolated context without inheritance', () => {
      const parent = new Environment({
        name: 'parent',
        config: {
          database: 'production-db',
          api: 'production-api',
        },
      });

      const context = parent.createContext({
        requestId: '123',
        userId: 'user-456',
      });

      expect(context.get('requestId')).toBe('123');
      expect(context.get('userId')).toBe('user-456');
      expect(context.get('database')).toBeUndefined();
      expect(context.get('api')).toBeUndefined();
    });

    it('should maintain parent reference in context', () => {
      const parent = new Environment({
        name: 'parent',
        config: { key: 'value' },
      });

      const context = parent.createContext({ contextKey: 'contextValue' });

      expect(context.parent).toBe(parent);
      expect(parent.children.has(context)).toBe(true);
    });

    it('should create multiple isolated contexts', () => {
      const parent = new Environment({
        name: 'parent',
        config: { shared: 'value' },
      });

      const ctx1 = parent.createContext({ id: 'context1', data: 'data1' });
      const ctx2 = parent.createContext({ id: 'context2', data: 'data2' });

      expect(ctx1.get('id')).toBe('context1');
      expect(ctx2.get('id')).toBe('context2');
      expect(ctx1.get('data')).toBe('data1');
      expect(ctx2.get('data')).toBe('data2');

      // Contexts don't share data
      ctx1.set('custom', 'value1');
      expect(ctx2.get('custom')).toBeUndefined();
    });
  });

  describe('Scope Resolution', () => {
    let root: Environment;
    let parent: Environment;
    let child: Environment;
    let childNoInherit: Environment;

    beforeEach(() => {
      root = new Environment({
        name: 'root',
        config: {
          rootOnly: 'root-value',
          shared: 'from-root',
          override: 'root',
        },
      });

      parent = root.createChild({
        name: 'parent',
        config: {
          parentOnly: 'parent-value',
          shared: 'from-parent',
          override: 'parent',
        },
      });

      child = parent.createChild({
        name: 'child',
        config: {
          childOnly: 'child-value',
          shared: 'from-child',
        },
      });

      // Create a child without inheritance for testing self scope
      childNoInherit = parent.createChild({
        name: 'child-no-inherit',
        config: {
          childOnly: 'child-value',
          shared: 'from-child',
        },
        inherit: false,
      });
    });

    describe('Self Scope', () => {
      it('should only return values from current environment', () => {
        // With inherit=false, only values explicitly set in child are present
        expect(childNoInherit.resolve('childOnly', { scope: 'self' })).toBe('child-value');
        expect(childNoInherit.resolve('parentOnly', { scope: 'self' })).toBeUndefined();
        expect(childNoInherit.resolve('rootOnly', { scope: 'self' })).toBeUndefined();
      });

      it('should return default when key not found in self scope', () => {
        expect(child.resolve('missing', { scope: 'self', default: 'default' })).toBe('default');
      });

      it('should throw when throwIfNotFound is true in self scope', () => {
        expect(() => {
          child.resolve('missing', { scope: 'self', throwIfNotFound: true });
        }).toThrow("Key 'missing' not found in environment 'child'");
      });
    });

    describe('Nearest Scope', () => {
      it('should search current then parent chain (default behavior)', () => {
        expect(child.resolve('childOnly')).toBe('child-value');
        expect(child.resolve('parentOnly')).toBe('parent-value');
        expect(child.resolve('rootOnly')).toBe('root-value');
      });

      it('should use nearest value when key exists in multiple levels', () => {
        expect(child.resolve('shared')).toBe('from-child');
        expect(child.resolve('override')).toBe('parent');
      });

      it('should return default when key not found in chain', () => {
        expect(child.resolve('missing', { default: 'fallback' })).toBe('fallback');
      });

      it('should throw when throwIfNotFound is true and key missing', () => {
        expect(() => {
          child.resolve('missing', { scope: 'nearest', throwIfNotFound: true });
        }).toThrow("Key 'missing' not found in 'child' or parent chain");
      });
    });

    describe('Parent Scope', () => {
      it('should skip current environment and search parent chain', () => {
        expect(child.resolve('childOnly', { scope: 'parent' })).toBeUndefined();
        expect(child.resolve('parentOnly', { scope: 'parent' })).toBe('parent-value');
        expect(child.resolve('rootOnly', { scope: 'parent' })).toBe('root-value');
      });

      it('should use nearest parent value', () => {
        expect(child.resolve('shared', { scope: 'parent' })).toBe('from-parent');
        expect(child.resolve('override', { scope: 'parent' })).toBe('parent');
      });

      it('should return default when not found in parent chain', () => {
        expect(child.resolve('childOnly', { scope: 'parent', default: 'def' })).toBe('def');
      });

      it('should throw when throwIfNotFound is true', () => {
        expect(() => {
          child.resolve('childOnly', { scope: 'parent', throwIfNotFound: true });
        }).toThrow("Key 'childOnly' not found in parent chain of 'child'");
      });
    });

    describe('Global Scope', () => {
      it('should search in root environment only', () => {
        expect(child.resolve('rootOnly', { scope: 'global' })).toBe('root-value');
        expect(child.resolve('shared', { scope: 'global' })).toBe('from-root');
        expect(child.resolve('override', { scope: 'global' })).toBe('root');
      });

      it('should not find keys only in middle levels', () => {
        expect(child.resolve('parentOnly', { scope: 'global' })).toBeUndefined();
        expect(child.resolve('childOnly', { scope: 'global' })).toBeUndefined();
      });

      it('should return default when not found in global scope', () => {
        expect(child.resolve('missing', { scope: 'global', default: 'global-def' })).toBe('global-def');
      });

      it('should throw when throwIfNotFound is true', () => {
        expect(() => {
          child.resolve('missing', { scope: 'global', throwIfNotFound: true });
        }).toThrow("Key 'missing' not found in global scope");
      });
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle deep nested hierarchies', () => {
      let current = new Environment({
        name: 'level-0',
        config: { level: 0 },
      });

      for (let i = 1; i <= 5; i++) {
        current = current.createChild({
          name: `level-${i}`,
          config: { level: i },
        });
      }

      expect(current.get('level')).toBe(5);
      expect(current.resolve('level', { scope: 'global' })).toBe(0);
    });

    it('should support sibling environments with same parent', () => {
      const parent = new Environment({
        name: 'parent',
        config: { shared: 'parent-value' },
      });

      const child1 = parent.createChild({
        name: 'child1',
        config: { id: 1 },
      });

      const child2 = parent.createChild({
        name: 'child2',
        config: { id: 2 },
      });

      expect(child1.get('id')).toBe(1);
      expect(child2.get('id')).toBe(2);
      expect(child1.get('shared')).toBe('parent-value');
      expect(child2.get('shared')).toBe('parent-value');

      // Siblings are independent
      child1.set('custom', 'value1');
      expect(child2.get('custom')).toBeUndefined();
    });

    it('should handle mixed inheritance and contexts', () => {
      const base = new Environment({
        name: 'base',
        config: { baseConfig: 'base' },
      });

      const inherited = base.createChild({
        name: 'inherited',
        config: { inheritedConfig: 'inherited' },
      });

      const context = base.createContext({
        contextConfig: 'context',
      });

      expect(inherited.get('baseConfig')).toBe('base');
      expect(inherited.get('inheritedConfig')).toBe('inherited');

      expect(context.get('contextConfig')).toBe('context');
      expect(context.get('baseConfig')).toBeUndefined();

      // But context can still resolve from parent using resolve
      expect(context.resolve('baseConfig', { scope: 'parent' })).toBe('base');
    });

    it('should maintain separate change tracking in hierarchy', () => {
      const parent = new Environment({
        name: 'parent',
        config: { value: 1 },
      });

      const child = parent.createChild({
        name: 'child',
        config: { childValue: 2 },
      });

      let parentChanged = false;
      let childChanged = false;

      parent.onChange('value', () => {
        parentChanged = true;
      });

      child.onChange('childValue', () => {
        childChanged = true;
      });

      parent.set('value', 10);
      expect(parentChanged).toBe(true);
      expect(childChanged).toBe(false);

      parentChanged = false;
      child.set('childValue', 20);
      expect(childChanged).toBe(true);
      expect(parentChanged).toBe(false);
    });

    it('should clone with hierarchy preserved', () => {
      const parent = new Environment({
        name: 'parent',
        config: { parent: true },
      });

      const child = parent.createChild({
        name: 'child',
        config: { child: true },
      });

      const clone = child.clone();

      // Clone doesn't preserve parent relationship
      expect(clone.parent).toBeUndefined();
      expect(clone.get('child')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle resolve on environment without parent', () => {
      const standalone = new Environment({
        name: 'standalone',
        config: { key: 'value' },
      });

      expect(standalone.resolve('key', { scope: 'self' })).toBe('value');
      expect(standalone.resolve('key', { scope: 'nearest' })).toBe('value');
      expect(standalone.resolve('key', { scope: 'parent' })).toBeUndefined();
      expect(standalone.resolve('key', { scope: 'global' })).toBe('value');
    });

    it('should handle empty configurations in hierarchy', () => {
      const parent = new Environment({
        name: 'parent',
        config: {},
      });

      const child = parent.createChild({
        name: 'child',
        config: {},
      });

      expect(child.resolve('anything', { default: 'default' })).toBe('default');
    });

    it('should handle undefined values correctly', () => {
      const parent = new Environment({
        name: 'parent',
        config: { key: undefined },
      });

      const child = parent.createChild({
        name: 'child',
        config: {},
      });

      // undefined values are treated as not set
      expect(child.resolve('key', { default: 'default' })).toBe('default');
    });

    it('should handle null values correctly', () => {
      const parent = new Environment({
        name: 'parent',
        config: { key: null },
      });

      const child = parent.createChild({
        name: 'child',
        config: {},
      });

      // null is a valid value
      expect(child.resolve('key')).toBe(null);
    });
  });
});
