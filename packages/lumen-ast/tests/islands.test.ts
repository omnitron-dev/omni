import { describe, expect, it, vi } from 'vitest';
import { MAX_ISLAND_PROPS_BYTES, parseHydrationTrigger, parseIslandProps, serializeIslandProps } from '../src/islands/index.js';

describe('shared SSR and browser island metadata', () => {
  it('round-trips JSON values and repeated references without changing their data', () => {
    const shared = { label: 'Общий <текст> & "quotes"', values: [1, null, true, 1.25] };
    const input = { left: shared, right: shared, array: [shared, shared] };
    const json = serializeIslandProps(input);
    expect(json).not.toContain('[Circular]');
    const decoded = parseIslandProps(json);
    expect(decoded).toEqual(input);
    expect((decoded['array'] as unknown[]).map(value => value)).toEqual([shared, shared]);
  });

  it('rejects values JSON would drop or coerce and never calls accessors or toJSON hooks', () => {
    for (const value of [1n, undefined, () => 1, Symbol('x'), new Date(), new Map(), Number.NaN, Infinity, -0])
      expect(() => serializeIslandProps({ value })).toThrow();
    const getter = vi.fn(() => 42);
    expect(() => serializeIslandProps(Object.defineProperty({}, 'value', { enumerable: true, get: getter }))).toThrow('data properties');
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => ({}));
    expect(() => serializeIslandProps({ toJSON })).toThrow();
    expect(toJSON).not.toHaveBeenCalled();
    expect(() => serializeIslandProps({ [Symbol('secret')]: 42 })).toThrow('symbol');
    expect(() => serializeIslandProps(Object.defineProperty({}, 'hidden', { value: 42 }))).toThrow('data properties');
    expect(() => serializeIslandProps({ sparse: Array(2) })).toThrow('dense');
    expect(() => serializeIslandProps({ extra: Object.assign([1], { extra: 2 }) })).toThrow('additional');
  });

  it('rejects actual cycles, malformed JSON and non-object roots', () => {
    const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
    expect(() => serializeIslandProps(cycle)).toThrow('cycles');
    for (const serialized of ['{', 'null', '[]', '42', '"text"', '{"value":1e400}'])
      expect(() => parseIslandProps(serialized)).toThrow();
  });

  it('bounds encoded bytes, depth and expansion of shared references', () => {
    const code = '\n'.repeat(64 * 1024);
    expect(parseIslandProps(serializeIslandProps({ code }))).toEqual({ code });
    expect(() => serializeIslandProps({ code: 'x'.repeat(MAX_ISLAND_PROPS_BYTES) })).toThrow('256 KiB');
    expect(() => parseIslandProps(' '.repeat(MAX_ISLAND_PROPS_BYTES + 1))).toThrow('256 KiB');
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 66; i++) deep = { child: deep };
    expect(() => serializeIslandProps(deep)).toThrow('nested');
    let expanding: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) expanding = { left: expanding, right: expanding };
    expect(() => serializeIslandProps(expanding)).toThrow('256 KiB');
  });

  it('requires a declared trigger instead of turning malformed metadata into eager loading', () => {
    for (const trigger of ['load', 'visible', 'interaction', 'idle', 'onReady', 'oncustom-action'])
      expect(parseHydrationTrigger(trigger)).toBe(trigger);
    for (const trigger of ['', 'unknown', 'on', 'on click', null, 42]) expect(() => parseHydrationTrigger(trigger)).toThrow('trigger');
  });
});
