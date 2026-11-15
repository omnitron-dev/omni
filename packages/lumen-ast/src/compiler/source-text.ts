import type { Point, Position } from '../ast/types.js';

export interface SourceEdit {
  start: number;
  end: number;
  value: string;
}
interface Span {
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
  copied: boolean;
}
type Edge = 'start' | 'end';

/** One coordinate space for all syntax rewrites. Storage follows edits/lines,
 * not document characters; nested fragments compose with their parent map. */
export class SourceText {
  private constructor(
    readonly value: string,
    private readonly lines: readonly number[],
    private readonly parent?: SourceText,
    private readonly spans: readonly Span[] = [],
    private readonly anchor = 0
  ) {}

  static original(value: string): SourceText {
    const lines = [0];
    for (const match of value.matchAll(/\r\n|\r|\n/g)) lines.push(match.index + match[0].length);
    return new SourceText(value, lines);
  }

  slice(start: number, end = this.value.length): SourceText {
    this.checkRange(start, end);
    return new SourceText(
      this.value.slice(start, end),
      this.lines,
      this,
      [{ start: 0, end: end - start, sourceStart: start, sourceEnd: end, copied: true }],
      start
    );
  }

  rewrite(edits: readonly SourceEdit[]): SourceText {
    if (!edits.length) return this;
    const chunks: string[] = [],
      spans: Span[] = [];
    let source = 0,
      generated = 0;
    const append = (value: string, start: number, end: number, copied: boolean) => {
      if (!value.length) return;
      chunks.push(value);
      spans.push({ start: generated, end: generated + value.length, sourceStart: start, sourceEnd: end, copied });
      generated += value.length;
    };
    for (const edit of edits) {
      this.checkRange(edit.start, edit.end);
      if (edit.start < source) throw new Error('Source edits must be ordered and disjoint');
      append(this.value.slice(source, edit.start), source, edit.start, true);
      append(edit.value, edit.start, edit.end, false);
      source = edit.end;
    }
    append(this.value.slice(source), source, this.value.length, true);
    return new SourceText(chunks.join(''), this.lines, this, spans, source);
  }

  position(start: number, end: number): Position {
    this.checkRange(start, end);
    const first = this.point(this.offset(start, 'start'));
    return { start: first, end: start === end ? { ...first } : this.point(this.offset(end, 'end')) };
  }

  private checkRange(start: number, end: number): void {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.value.length
    )
      throw new RangeError('Source range is outside its coordinate space');
  }

  private offset(value: number, edge: Edge): number {
    if (!this.parent) return value;
    if (!this.spans.length) return this.parent.offset(this.anchor, edge);
    let low = 0,
      high = this.spans.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1,
        span = this.spans[middle]!;
      if (span.end < value || (edge === 'start' && span.end === value)) low = middle + 1;
      else high = middle;
    }
    const span = this.spans[low]!;
    const mapped = span.copied
      ? span.sourceStart + Math.max(0, Math.min(value - span.start, span.end - span.start))
      : value <= span.start
        ? span.sourceStart
        : value >= span.end
          ? span.sourceEnd
          : edge === 'start'
            ? span.sourceStart
            : span.sourceEnd;
    return this.parent.offset(mapped, edge);
  }

  private point(offset: number): Point {
    let low = 0,
      high = this.lines.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.lines[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - this.lines[low]! + 1, offset };
  }
}
