import { describe, expect, it } from 'vitest';
import { deepDiff } from '../../../src/utils/deep-diff';

describe('deepDiff', () => {
  it('should detect added properties', () => {
    const before = { a: 1 };
    const after = { a: 1, b: 2 };

    const diff = deepDiff(before, after);

    expect(diff.added).toHaveProperty('b', 2);
  });

  it('should detect modified properties', () => {
    const before = { a: 1 };
    const after = { a: 2 };

    const diff = deepDiff(before, after);

    expect(diff.modified).toHaveProperty('a');
    expect(diff.modified?.a).toEqual({ before: 1, after: 2 });
  });

  it('should detect deleted properties', () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1 };

    const diff = deepDiff(before, after);

    expect(diff.deleted).toContain('b');
  });

  it('should detect nested changes', () => {
    const before = { nested: { a: 1, b: 2 } };
    const after = { nested: { a: 1, b: 3, c: 4 } };

    const diff = deepDiff(before, after);

    expect(diff.modified).toHaveProperty('nested.b');
    expect(diff.added).toHaveProperty('nested.c');
  });

  it('should handle null values', () => {
    const before = { a: 1 };
    const after = null;

    const diff = deepDiff(before, after);

    expect(diff.deleted).toContain('root');
  });

  it('should detect array changes', () => {
    const before = { arr: [1, 2, 3] };
    const after = { arr: [1, 2, 3, 4] };

    const diff = deepDiff(before, after);

    expect(diff.modified).toHaveProperty('arr');
  });
});
