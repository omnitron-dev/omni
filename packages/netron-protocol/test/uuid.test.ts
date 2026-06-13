import { describe, it, expect } from 'vitest';
import { uuid } from '../src/index.js';

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid (UUIDv7)', () => {
  it('produces a well-formed v7 UUID (version nibble 7, variant 8-b)', () => {
    expect(uuid()).toMatch(UUID_V7_RE);
  });

  it('is unique across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(uuid());
    expect(seen.size).toBe(10_000);
  });

  it('is time-ordered (monotonically non-decreasing as strings within a run)', () => {
    const a = uuid();
    const b = uuid();
    // v7 is lexicographically sortable by time; same-ms ties break by sequence.
    expect(a < b).toBe(true);
  });
});
