import { describe, expect, it } from 'vitest';
import { parseTwoslashAnnotations } from '../src/highlight/twoslash.js';

describe('Twoslash using the actual compiler libraries', () => {
  it.each([
    ['const value = [1, 2].at(-1);', 'number | undefined'],
    ['const value = Object.fromEntries([["key", 1]]);', '[k: string]: number'],
    ['const value = new AbortController().signal;', 'AbortSignal'],
    ['const value = [...new Map<string, number>()];', '[string, number][]'],
    ['const value = Promise.all([Promise.resolve(1), "x"] as const);', 'Promise<[number, "x"]>'],
  ])('resolves standard library types for %s', (code, type) => {
    const result = parseTwoslashAnnotations(code + '\n//    ^?');
    expect(result.actualErrors).toEqual([]);
    expect(result.errorsValid).toBe(true);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]!.text.replace(/\s+/g, ' ')).toContain(type);
  });

  it('uses the marked symbol instead of guessing the first identifier', () => {
    const source = 'const first = 1, second = "different";';
    const column = source.indexOf('second');
    const result = parseTwoslashAnnotations(source + '\n//' + ' '.repeat(column - 2) + '^?');
    expect(result.annotations[0]!.text).toContain('const second: "different"');
    expect(result.annotations[0]!.column).toBe(column);
    expect(() => parseTwoslashAnnotations(source + '\n//' + ' '.repeat(source.length) + '^?')).toThrow(
      'No TypeScript symbol'
    );
  });

  it('does not conceal invalid or unmeasured snippets as successful analysis', () => {
    const result = parseTwoslashAnnotations('// @noErrors\nconst value: number = "bad";');
    expect(result.annotations).toEqual([]);
    expect(result.actualErrors).toContain(2322);
    expect(result.errorsValid).toBe(false);
    expect(() => parseTwoslashAnnotations('x'.repeat(128 * 1024 + 1))).toThrow('128 KiB');
    expect(() => parseTwoslashAnnotations('\n'.repeat(2000))).toThrow('2000 lines');
    expect(() => parseTwoslashAnnotations('// @errors: invalid\nconst value = 1;')).toThrow('@errors directive');
  });

  it.each([
    ['node:os', 2591],
    ['@omnitron-dev/lumen-ast', 2307],
  ] as const)('does not resolve the host module %s', (specifier, code) => {
    const result = parseTwoslashAnnotations(`import * as value from ${JSON.stringify(specifier)};`);
    expect(result.actualErrors).toContain(code);
    expect(result.errorsValid).toBe(false);
  });
});
