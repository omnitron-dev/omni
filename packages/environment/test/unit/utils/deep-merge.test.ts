import { describe, expect, it } from 'vitest';
import { deepMerge } from '../../../src/utils/deep-merge';

describe('deepMerge', () => {
  it('should merge simple objects', () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };

    const result = deepMerge(target, source);

    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should deep merge nested objects', () => {
    const target = { nested: { a: 1, b: 2 } };
    const source = { nested: { b: 3, c: 4 } };

    const result = deepMerge(target, source);

    expect(result).toEqual({ nested: { a: 1, b: 3, c: 4 } });
  });

  it('should replace arrays by default', () => {
    const target = { arr: [1, 2, 3] };
    const source = { arr: [4, 5] };

    const result = deepMerge(target, source);

    expect(result.arr).toEqual([4, 5]);
  });

  it('should concat arrays with strategy', () => {
    const target = { arr: [1, 2, 3] };
    const source = { arr: [4, 5] };

    const result = deepMerge(target, source, { arrays: 'concat' });

    expect(result.arr).toEqual([1, 2, 3, 4, 5]);
  });

  it('should use custom resolver', () => {
    const target = { value: 10 };
    const source = { value: 20 };

    const result = deepMerge(target, source, {
      resolver: (key, left, right) => left + right
    });

    expect(result.value).toBe(30);
  });

  it('should handle null values', () => {
    const target = { a: 1 };
    const source = null;

    const result = deepMerge(target, source);

    expect(result).toEqual({ a: 1 });
  });

  it('should prefer left on conflict', () => {
    const target = { value: 'left' };
    const source = { value: 'right' };

    const result = deepMerge(target, source, { conflicts: 'prefer-left' });

    expect(result.value).toBe('left');
  });
});
