import { describe, expect, it } from 'vitest';
import { SourceText } from '../src/compiler/source-text.js';

describe('source coordinate composition', () => {
  it('maps exact ranges after expansion, contraction, deletion and a nested fragment', () => {
    const original = '\uFEFFbefore\r\n  <Long>α😀</Long>\r\n  after\r\n';
    const root = SourceText.original(original);
    const body = root.slice(original.indexOf('<Long>'));
    const masked = body.rewrite([{ start: 0, end: '<Long>α😀</Long>'.length, value: '<x>' }]);
    const after = masked.value.indexOf('after');
    expect(masked.position(after, after + 5)).toEqual({
      start: { offset: original.indexOf('after'), line: 3, column: 3 },
      end: { offset: original.indexOf('after') + 5, line: 3, column: 8 },
    });
    const expanded = masked.rewrite([{ start: 0, end: 3, value: '<long-placeholder />' }]);
    const shifted = expanded.value.indexOf('after');
    expect(expanded.slice(shifted).position(0, 5)).toEqual(masked.position(after, after + 5));
    expect(expanded.position(0, '<long-placeholder />'.length)).toEqual(body.position(0, '<Long>α😀</Long>'.length));
  });

  it('keeps cursors ordered at removed boundaries and inside synthetic spans', () => {
    const source = SourceText.original('ab---cd').rewrite([{ start: 2, end: 5, value: '' }]);
    expect(source.position(2, 2)).toEqual({
      start: { line: 1, column: 6, offset: 5 },
      end: { line: 1, column: 6, offset: 5 },
    });
    const masked = SourceText.original('original').rewrite([{ start: 0, end: 8, value: 'placeholder' }]);
    expect(masked.position(3, 3)).toEqual({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    });
    const empty = SourceText.original('abc').rewrite([{ start: 0, end: 3, value: '' }]);
    expect(empty.position(0, 0)).toEqual({
      start: { line: 1, column: 4, offset: 3 },
      end: { line: 1, column: 4, offset: 3 },
    });
  });

  it('rejects unmappable ranges and overlapping edits instead of returning plausible coordinates', () => {
    const source = SourceText.original('source');
    expect(() => source.slice(-1)).toThrow(RangeError);
    expect(() => source.position(2, 1)).toThrow(RangeError);
    expect(() => source.position(0, 7)).toThrow(RangeError);
    expect(() =>
      source.rewrite([
        { start: 1, end: 4, value: '' },
        { start: 3, end: 5, value: '' },
      ])
    ).toThrow('ordered and disjoint');
  });
});
