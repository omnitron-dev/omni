import { describe, expect, it } from 'vitest';
import { RestartWindow } from '../src/restart-window.js';

describe('actual restart attempts in a sliding elapsed window', () => {
  it('counts bursts, expires rare attempts at the boundary, and refreshes without lifetime state', () => {
    const window = new RestartWindow();
    expect(window.recent(100, 0)).toBe(0);
    expect(window.record(100, 0)).toBe(1); expect(window.record(100, 50)).toBe(2);
    expect(window.recent(100, 99)).toBe(2); expect(window.recent(100, 100)).toBe(1);
    expect(window.recent(100, 150)).toBe(0);
    expect(window.record(100, 151)).toBe(1); window.clear(); expect(window.recent(100, 151)).toBe(0);
  });
  it('coalesces unlimited same-millisecond calls and prunes expired buckets', () => {
    const window = new RestartWindow();
    for (let i = 0; i < 10000; i++) window.record(10, 1);
    expect(window.recent(10, 1)).toBe(10000);
    expect((window as unknown as { buckets: Map<number, number> }).buckets.size).toBe(1);
    expect(window.recent(10, 11)).toBe(0);
    expect((window as unknown as { buckets: Map<number, number> }).buckets.size).toBe(0);
  });
  it('rejects non-finite clocks without poisoning subsequent expiry', () => {
    const window = new RestartWindow(); window.record(100, 0);
    for (const bad of [NaN, Infinity, -Infinity, 'invalid' as unknown as number]) {
      expect(() => window.recent(100, bad)).toThrow('finite');
      expect(() => window.record(100, bad)).toThrow('finite');
    }
    expect(window.recent(100, 99)).toBe(1); expect(window.recent(100, 100)).toBe(0);
  });
});
