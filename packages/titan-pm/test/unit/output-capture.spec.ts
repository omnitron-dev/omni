import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { OutputCapture, type ProcessOutputContext } from '../../src/output-capture.js';

describe('output captured before readiness', () => {
  it('keeps oversized Unicode lines reconstructible with bounded, linked fragments', async () => {
    const input = new PassThrough();
    const output: Array<{ text: string; context: ProcessOutputContext }> = [];
    new OutputCapture('worker', (text, _stream, context) => output.push({ text, context })).attach(input, 'stderr');
    const original = 'Ошибка🛰'.repeat(60_000);
    input.end(original + '\n');
    await new Promise(resolve => setImmediate(resolve));
    expect(output.map(row => row.text).join('')).toBe(original);
    expect(output.every(row => Buffer.byteLength(row.text) <= 256 * 1024)).toBe(true);
    expect(new Set(output.map(row => row.context.fragmentOf)).size).toBe(1);
    expect(output.map(row => row.context.fragmentIndex)).toEqual(output.map((_row, index) => index));
    expect(output.at(-1)!.context.fragment).toBe(false);
  });

  it('preserves split UTF-8, blank lines and the final unterminated line', async () => {
    const input = new PassThrough();
    const output: Array<{ text: string; context: ProcessOutputContext }> = [];
    new OutputCapture('worker', (text, _stream, context) => output.push({ text, context })).attach(input, 'stderr');
    const bytes = Buffer.from('Ошибка 🛰\r\n\n    at boot\nlast');
    for (let i = 0; i < bytes.length; i++) input.write(bytes.subarray(i, i + 1));
    input.end();
    await new Promise(resolve => setImmediate(resolve));
    expect(output.map(row => row.text)).toEqual(['Ошибка 🛰', '', '    at boot', 'last']);
    expect(new Set(output.map(row => row.context.id)).size).toBe(4);
    expect(output.every(row => row.context.stream === 'stderr' && row.context.processId === 'worker')).toBe(true);
  });

  it('backpressures a rejected frame and retries its original ID/time without duplicating accepted lines', async () => {
    const input = new PassThrough();
    const attempts: ProcessOutputContext[] = [];
    const accepted: string[] = [];
    let failing = true;
    const capture = new OutputCapture('worker', (text, _stream, context) => {
      attempts.push(context);
      if (failing) throw new Error('storage unavailable');
      accepted.push(text);
    });
    capture.attach(input, 'stdout');
    input.write('one\ntwo\n');
    expect(input.isPaused()).toBe(true);
    failing = false;
    capture.retry();
    expect(accepted).toEqual(['one', 'two']);
    expect(attempts[1]).toBe(attempts[0]);
    input.end();
    await new Promise(resolve => setImmediate(resolve));
  });

  it('dates a line at its first byte, independently of later reads', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-31T01:00:00Z'));
      const input = new PassThrough();
      const times: string[] = [];
      new OutputCapture('worker', (_line, _stream, context) => times.push(context.capturedAt)).attach(input, 'stdout');
      input.write('first');
      vi.advanceTimersByTime(3000);
      input.write('\nsecond\n');
      expect(times).toEqual(['2026-10-31T01:00:00.000Z', '2026-10-31T01:00:03.000Z']);
      input.end();
    } finally { vi.useRealTimers(); }
  });
});
