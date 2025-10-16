import { describe, expect, it, beforeEach } from 'vitest';
import { Environment } from '../../../src/core/environment';

describe('Environment - Algebraic Operations', () => {
  describe('union', () => {
    it('should combine all keys from both environments', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { c: 3, d: 4 },
      });

      const result = env1.union(env2);

      expect(result.get('a')).toBe(1);
      expect(result.get('b')).toBe(2);
      expect(result.get('c')).toBe(3);
      expect(result.get('d')).toBe(4);
    });

    it('should override values from left with right environment', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { b: 20, c: 3 },
      });

      const result = env1.union(env2);

      expect(result.get('a')).toBe(1);
      expect(result.get('b')).toBe(20); // Overridden by env2
      expect(result.get('c')).toBe(3);
    });

    it('should handle nested objects', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: {
          nested: { a: 1, b: 2 },
          top: 'value1',
        },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: {
          nested: { b: 20, c: 3 },
          top2: 'value2',
        },
      });

      const result = env1.union(env2);

      expect(result.get('nested.a')).toBe(1);
      expect(result.get('nested.b')).toBe(20);
      expect(result.get('nested.c')).toBe(3);
      expect(result.get('top')).toBe('value1');
      expect(result.get('top2')).toBe('value2');
    });

    it('should handle empty environments', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: {},
      });

      const result = env1.union(env2);

      expect(result.get('a')).toBe(1);
    });

    it('should create new environment with correct name', () => {
      const env1 = Environment.create({ name: 'base', config: {} });
      const env2 = Environment.create({ name: 'other', config: {} });

      const result = env1.union(env2);

      expect(result.name).toBe('base-union');
      expect(result.id).not.toBe(env1.id);
    });
  });

  describe('intersect', () => {
    it('should return only common keys', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2, c: 3 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { b: 20, c: 30, d: 4 },
      });

      const result = env1.intersect(env2);

      expect(result.has('a')).toBe(false);
      expect(result.get('b')).toBe(2); // Value from env1
      expect(result.get('c')).toBe(3); // Value from env1
      expect(result.has('d')).toBe(false);
    });

    it('should handle nested objects', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: {
          nested: { a: 1, b: 2, c: 3 },
          top: 'value1',
        },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: {
          nested: { b: 20, c: 30 },
          other: 'value2',
        },
      });

      const result = env1.intersect(env2);

      expect(result.has('top')).toBe(false);
      expect(result.has('other')).toBe(false);
      expect(result.has('nested.a')).toBe(false);
      expect(result.get('nested.b')).toBe(2);
      expect(result.get('nested.c')).toBe(3);
    });

    it('should return empty environment when no common keys', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { c: 3, d: 4 },
      });

      const result = env1.intersect(env2);

      expect(result.toObject()).toEqual({});
    });

    it('should handle arrays correctly', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { arr: [1, 2, 3], common: 'value' },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { arr: [4, 5, 6], common: 'value2' },
      });

      const result = env1.intersect(env2);

      expect(result.get('arr')).toEqual([1, 2, 3]);
      expect(result.get('common')).toBe('value');
    });

    it('should handle empty environments', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: {},
      });

      const result = env1.intersect(env2);

      expect(result.toObject()).toEqual({});
    });
  });

  describe('subtract', () => {
    it('should return keys only in first environment', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2, c: 3 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { b: 20, c: 30, d: 4 },
      });

      const result = env1.subtract(env2);

      expect(result.get('a')).toBe(1);
      expect(result.has('b')).toBe(false);
      expect(result.has('c')).toBe(false);
      expect(result.has('d')).toBe(false);
    });

    it('should handle nested objects', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: {
          nested: { a: 1, b: 2, c: 3 },
          top: 'value1',
        },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: {
          nested: { b: 20 },
          other: 'value2',
        },
      });

      const result = env1.subtract(env2);

      expect(result.get('top')).toBe('value1');
      expect(result.get('nested.a')).toBe(1);
      expect(result.get('nested.c')).toBe(3);
      expect(result.has('nested.b')).toBe(false);
      expect(result.has('other')).toBe(false);
    });

    it('should return all keys when subtracting empty environment', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: {},
      });

      const result = env1.subtract(env2);

      expect(result.toObject()).toEqual({ a: 1, b: 2 });
    });

    it('should return empty environment when all keys are common', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { a: 10, b: 20, c: 30 },
      });

      const result = env1.subtract(env2);

      expect(result.toObject()).toEqual({});
    });
  });

  describe('symmetricDifference', () => {
    it('should return keys in either but not both', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2, c: 3 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { b: 20, c: 30, d: 4 },
      });

      const result = env1.symmetricDifference(env2);

      expect(result.get('a')).toBe(1);
      expect(result.has('b')).toBe(false);
      expect(result.has('c')).toBe(false);
      expect(result.get('d')).toBe(4);
    });

    it('should handle nested objects', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: {
          nested: { a: 1, b: 2 },
          top1: 'value1',
        },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: {
          nested: { b: 20, c: 3 },
          top2: 'value2',
        },
      });

      const result = env1.symmetricDifference(env2);

      expect(result.get('top1')).toBe('value1');
      expect(result.get('top2')).toBe('value2');
      expect(result.get('nested.a')).toBe(1);
      expect(result.get('nested.c')).toBe(3);
      expect(result.has('nested.b')).toBe(false);
    });

    it('should return all keys when no overlap', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { c: 3, d: 4 },
      });

      const result = env1.symmetricDifference(env2);

      expect(result.toObject()).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    });

    it('should return empty when all keys overlap', () => {
      const env1 = Environment.create({
        name: 'env1',
        config: { a: 1, b: 2 },
      });

      const env2 = Environment.create({
        name: 'env2',
        config: { a: 10, b: 20 },
      });

      const result = env1.symmetricDifference(env2);

      expect(result.toObject()).toEqual({});
    });
  });
});

describe('Environment - Functional Transformations', () => {
  describe('map', () => {
    it('should transform all primitive values', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2, c: 3 },
      });

      const result = env.map((value) => value * 2);

      expect(result.get('a')).toBe(2);
      expect(result.get('b')).toBe(4);
      expect(result.get('c')).toBe(6);
    });

    it('should provide key path to mapping function', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2 },
      });

      const keys: string[] = [];
      env.map((value, key) => {
        keys.push(key);
        return value;
      });

      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    it('should handle nested objects', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          nested: { a: 1, b: 2 },
          top: 5,
        },
      });

      const result = env.map((value) => {
        if (typeof value === 'number') {
          return value * 10;
        }
        return value;
      });

      expect(result.get('nested.a')).toBe(10);
      expect(result.get('nested.b')).toBe(20);
      expect(result.get('top')).toBe(50);
    });

    it('should handle arrays', () => {
      const env = Environment.create({
        name: 'test',
        config: { arr: [1, 2, 3] },
      });

      const result = env.map((value) => {
        if (typeof value === 'number') {
          return value * 2;
        }
        return value;
      });

      expect(result.get('arr')).toEqual([2, 4, 6]);
    });

    it('should transform string values', () => {
      const env = Environment.create({
        name: 'test',
        config: { greeting: 'hello', name: 'world' },
      });

      const result = env.map((value) => {
        if (typeof value === 'string') {
          return value.toUpperCase();
        }
        return value;
      });

      expect(result.get('greeting')).toBe('HELLO');
      expect(result.get('name')).toBe('WORLD');
    });

    it('should handle empty environment', () => {
      const env = Environment.create({
        name: 'test',
        config: {},
      });

      const result = env.map((value) => value * 2);

      expect(result.toObject()).toEqual({});
    });
  });

  describe('filter', () => {
    it('should filter values by predicate', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2, c: 3, d: 4 },
      });

      const result = env.filter((value) => value > 2);

      expect(result.has('a')).toBe(false);
      expect(result.has('b')).toBe(false);
      expect(result.get('c')).toBe(3);
      expect(result.get('d')).toBe(4);
    });

    it('should provide key path to predicate', () => {
      const env = Environment.create({
        name: 'test',
        config: { prefix_a: 1, prefix_b: 2, other: 3 },
      });

      const result = env.filter((_, key) => key.startsWith('prefix'));

      expect(result.get('prefix_a')).toBe(1);
      expect(result.get('prefix_b')).toBe(2);
      expect(result.has('other')).toBe(false);
    });

    it('should handle nested objects', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          nested: { a: 1, b: 10, c: 5 },
          top: 20,
        },
      });

      const result = env.filter((value) => {
        if (typeof value === 'number') {
          return value >= 10;
        }
        return true;
      });

      expect(result.has('nested.a')).toBe(false);
      expect(result.get('nested.b')).toBe(10);
      expect(result.has('nested.c')).toBe(false);
      expect(result.get('top')).toBe(20);
    });

    it('should handle arrays', () => {
      const env = Environment.create({
        name: 'test',
        config: { arr: [1, 2, 3, 4, 5] },
      });

      const result = env.filter((value) => {
        if (typeof value === 'number') {
          return value % 2 === 0;
        }
        return true;
      });

      expect(result.get('arr')).toEqual([2, 4]);
    });

    it('should return empty when nothing matches', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2, c: 3 },
      });

      const result = env.filter(() => false);

      expect(result.toObject()).toEqual({});
    });

    it('should filter by type', () => {
      const env = Environment.create({
        name: 'test',
        config: { str: 'hello', num: 42, bool: true },
      });

      const result = env.filter((value) => typeof value === 'number');

      expect(result.has('str')).toBe(false);
      expect(result.get('num')).toBe(42);
      expect(result.has('bool')).toBe(false);
    });
  });

  describe('reduce', () => {
    it('should reduce to sum', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2, c: 3 },
      });

      const sum = env.reduce((acc, value) => {
        if (typeof value === 'number') {
          return acc + value;
        }
        return acc;
      }, 0);

      expect(sum).toBe(6);
    });

    it('should reduce to array of keys', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2, c: 3 },
      });

      const keys = env.reduce((acc, _, key) => {
        acc.push(key);
        return acc;
      }, [] as string[]);

      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).toContain('c');
    });

    it('should reduce nested objects', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          nested: { a: 1, b: 2 },
          top: 3,
        },
      });

      const sum = env.reduce((acc, value) => {
        if (typeof value === 'number') {
          return acc + value;
        }
        return acc;
      }, 0);

      expect(sum).toBe(6);
    });

    it('should reduce to object', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2, c: 3 },
      });

      const result = env.reduce(
        (acc, value, key) => {
          if (typeof value === 'number') {
            acc[key] = value * 2;
          }
          return acc;
        },
        {} as Record<string, number>
      );

      expect(result).toEqual({ a: 2, b: 4, c: 6 });
    });

    it('should handle arrays', () => {
      const env = Environment.create({
        name: 'test',
        config: { arr: [1, 2, 3] },
      });

      const sum = env.reduce((acc, value) => {
        if (typeof value === 'number') {
          return acc + value;
        }
        return acc;
      }, 0);

      expect(sum).toBe(6);
    });

    it('should return initial value for empty environment', () => {
      const env = Environment.create({
        name: 'test',
        config: {},
      });

      const result = env.reduce((acc) => acc + 1, 100);

      expect(result).toBe(100);
    });

    it('should count values by type', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 'string', c: true, d: 2, e: 'another' },
      });

      const counts = env.reduce(
        (acc, value) => {
          const type = typeof value;
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      expect(counts.number).toBe(2);
      expect(counts.string).toBe(2);
      expect(counts.boolean).toBe(1);
    });
  });

  describe('flatMap', () => {
    it('should expand values to multiple pairs', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2 },
      });

      const result = env.flatMap((value, key) => [
        [key, value],
        [`${key}_doubled`, (value as number) * 2],
      ]);

      expect(result.get('a')).toBe(1);
      expect(result.get('a_doubled')).toBe(2);
      expect(result.get('b')).toBe(2);
      expect(result.get('b_doubled')).toBe(4);
    });

    it('should handle nested path creation', () => {
      const env = Environment.create({
        name: 'test',
        config: { value: 10 },
      });

      const result = env.flatMap((value) => [
        ['original.value', value],
        ['doubled.value', (value as number) * 2],
        ['tripled.value', (value as number) * 3],
      ]);

      expect(result.get('original.value')).toBe(10);
      expect(result.get('doubled.value')).toBe(20);
      expect(result.get('tripled.value')).toBe(30);
    });

    it('should handle empty arrays', () => {
      const env = Environment.create({
        name: 'test',
        config: { a: 1, b: 2 },
      });

      const result = env.flatMap((value, key) => {
        if (key === 'a') {
          return [];
        }
        return [[key, value]];
      });

      expect(result.has('a')).toBe(false);
      expect(result.get('b')).toBe(2);
    });

    it('should transform key names', () => {
      const env = Environment.create({
        name: 'test',
        config: { oldName: 'value' },
      });

      const result = env.flatMap((value, key) => [['newName', value]]);

      expect(result.has('oldName')).toBe(false);
      expect(result.get('newName')).toBe('value');
    });

    it('should handle complex transformations', () => {
      const env = Environment.create({
        name: 'test',
        config: { config: { port: 3000 } },
      });

      const result = env.flatMap((value, key) => {
        if (key === 'config.port') {
          return [
            ['server.http.port', value],
            ['server.https.port', (value as number) + 443],
          ];
        }
        return [[key, value]];
      });

      expect(result.get('server.http.port')).toBe(3000);
      expect(result.get('server.https.port')).toBe(3443);
    });
  });
});

describe('Environment - Operations Edge Cases', () => {
  it('should handle operations on empty environments', () => {
    const env1 = Environment.create({ name: 'env1', config: {} });
    const env2 = Environment.create({ name: 'env2', config: {} });

    expect(env1.union(env2).toObject()).toEqual({});
    expect(env1.intersect(env2).toObject()).toEqual({});
    expect(env1.subtract(env2).toObject()).toEqual({});
    expect(env1.symmetricDifference(env2).toObject()).toEqual({});
  });

  it('should handle null and undefined values', () => {
    const env = Environment.create({
      name: 'test',
      config: { nullVal: null, undefVal: undefined, normal: 'value' },
    });

    const mapped = env.map((value) => (value === null ? 'was-null' : value));

    expect(mapped.get('nullVal')).toBe('was-null');
    expect(mapped.get('normal')).toBe('value');
  });

  it('should handle boolean values', () => {
    const env = Environment.create({
      name: 'test',
      config: { flag1: true, flag2: false, other: 'value' },
    });

    const filtered = env.filter((value) => typeof value === 'boolean');

    expect(filtered.get('flag1')).toBe(true);
    expect(filtered.get('flag2')).toBe(false);
    expect(filtered.has('other')).toBe(false);
  });

  it('should preserve immutability', () => {
    const original = Environment.create({
      name: 'original',
      config: { a: 1, b: 2 },
    });

    const mapped = original.map((value) => (value as number) * 2);

    expect(original.get('a')).toBe(1);
    expect(mapped.get('a')).toBe(2);
  });

  it('should handle deeply nested structures', () => {
    const env = Environment.create({
      name: 'test',
      config: {
        level1: {
          level2: {
            level3: {
              value: 42,
            },
          },
        },
      },
    });

    const result = env.map((value) => {
      if (typeof value === 'number') {
        return value * 2;
      }
      return value;
    });

    expect(result.get('level1.level2.level3.value')).toBe(84);
  });

  it('should handle mixed data types', () => {
    const env = Environment.create({
      name: 'test',
      config: {
        str: 'hello',
        num: 42,
        bool: true,
        arr: [1, 2, 3],
        obj: { nested: 'value' },
      },
    });

    const sum = env.reduce((acc, value) => {
      if (typeof value === 'number') {
        return acc + value;
      }
      return acc;
    }, 0);

    // Should sum: 42 + 1 + 2 + 3 = 48
    expect(sum).toBe(48);
  });
});
