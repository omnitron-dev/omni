/**
 * The declared request-size option must be the one that works.
 *
 * `TransportOptions.maxRequestSize` is documented as "Maximum request size
 * (HTTP only). Accepts human-readable strings like '10mb', '1gb'" and was read
 * by nothing. The server took its ceiling from `maxBodySize` instead, reached
 * through `(this.options as any)` — so the knob that worked was undeclared and
 * the knob that was declared and documented did nothing. A caller raising the
 * limit to '50mb' still had requests rejected with 413 at ten megabytes.
 */

import { describe, it, expect } from 'vitest';

import { resolveMaxBodyBytes } from '../../../src/netron/transport/http/server.js';

const MB = 1024 * 1024;

describe('resolveMaxBodyBytes', () => {
  it('defaults to 10MB', () => {
    expect(resolveMaxBodyBytes({})).toBe(10 * MB);
    expect(resolveMaxBodyBytes(undefined)).toBe(10 * MB);
  });

  it('parses the human-readable forms the option documents', () => {
    expect(resolveMaxBodyBytes({ maxRequestSize: '50mb' })).toBe(50 * MB);
    expect(resolveMaxBodyBytes({ maxRequestSize: '1gb' })).toBe(1024 * MB);
    expect(resolveMaxBodyBytes({ maxRequestSize: '512kb' })).toBe(512 * 1024);
    expect(resolveMaxBodyBytes({ maxRequestSize: '2048' })).toBe(2048);
    expect(resolveMaxBodyBytes({ maxRequestSize: '1.5mb' })).toBe(Math.floor(1.5 * MB));
    expect(resolveMaxBodyBytes({ maxRequestSize: ' 20 MB ' })).toBe(20 * MB);
  });

  it('accepts a plain byte count', () => {
    expect(resolveMaxBodyBytes({ maxRequestSize: 4096 })).toBe(4096);
  });

  it('keeps honouring maxBodySize for callers already using it', () => {
    expect(resolveMaxBodyBytes({ maxBodySize: 3 * MB })).toBe(3 * MB);
  });

  it('prefers the declared option when both are present', () => {
    expect(resolveMaxBodyBytes({ maxRequestSize: '20mb', maxBodySize: 3 * MB })).toBe(20 * MB);
  });

  it('falls back to the default rather than widening the limit on garbage', () => {
    // An unparseable value must never be read as "no limit" — that turns a
    // typo in configuration into an unbounded request body.
    expect(resolveMaxBodyBytes({ maxRequestSize: 'ten megabytes' })).toBe(10 * MB);
    expect(resolveMaxBodyBytes({ maxRequestSize: '0mb' })).toBe(10 * MB);
    expect(resolveMaxBodyBytes({ maxRequestSize: -1 })).toBe(10 * MB);
  });
});
