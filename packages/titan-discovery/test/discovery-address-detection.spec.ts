/**
 * Address detection — the three strategies detectAddress() documents.
 *
 * This file used to be eighteen lines: an unconditional `describe.skip`
 * around one empty test named "should skip all tests - ioredis-mock
 * dependency not available". It had never run and had nothing to run. The
 * stated blocker was also wrong — detectAddress() reads env vars and
 * os.networkInterfaces() and touches Redis not at all; the Redis instance
 * only has to exist for the constructor's null check.
 *
 * Precedence per the source: HOST/TITAN_HOST wins, then the first external
 * (non-internal) IPv4 interface, then the first internal non-loopback one,
 * then localhost. Every branch below is reachable and distinct.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as os from 'node:os';

// An ESM namespace object is not configurable, so vi.spyOn(os, ...) throws
// "Cannot redefine property". The module has to be mocked outright.
let interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> | (() => never) = {};

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  const networkInterfaces = () => (typeof interfaces === 'function' ? interfaces() : interfaces);
  // discovery.service.ts uses `import os from 'node:os'` — the DEFAULT export.
  // A factory that overrides only the named export leaves the default bound to
  // the real module, and the tests then run against this machine's actual
  // interfaces while looking mocked.
  return { ...actual, networkInterfaces, default: { ...actual, networkInterfaces } };
});

const { DiscoveryService } = await import('../src/discovery.service.js');
const { createMockLogger } = await import('./test-utils.js');

/** detectAddress() runs in the constructor; Redis is only null-checked. */
function addressWith(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string {
  interfaces = ifaces;
  const service = new DiscoveryService({} as never, createMockLogger(), { autoStart: false } as never);
  return service.getAddress();
}

const ipv4 = (address: string, internal: boolean): os.NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null }) as never;

const ipv6 = (address: string): os.NetworkInterfaceInfo =>
  ({
    address,
    family: 'IPv6',
    internal: false,
    netmask: 'ffff::',
    mac: '00:00:00:00:00:00',
    cidr: null,
    scopeid: 0,
  }) as never;

describe('DiscoveryService address detection', () => {
  const saved = { HOST: process.env['HOST'], TITAN_HOST: process.env['TITAN_HOST'], PORT: process.env['PORT'], TITAN_PORT: process.env['TITAN_PORT'] };

  beforeEach(() => {
    interfaces = {};
    delete process.env['HOST'];
    delete process.env['TITAN_HOST'];
    delete process.env['PORT'];
    delete process.env['TITAN_PORT'];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('prefers HOST over any network interface', () => {
    process.env['HOST'] = 'node-7.internal';
    process.env['PORT'] = '4100';

    expect(addressWith({ eth0: [ipv4('10.0.0.5', false)] })).toBe('node-7.internal:4100');
  });

  it('accepts TITAN_HOST and TITAN_PORT', () => {
    process.env['TITAN_HOST'] = 'node-8.internal';
    process.env['TITAN_PORT'] = '4200';

    expect(addressWith({ eth0: [ipv4('10.0.0.5', false)] })).toBe('node-8.internal:4200');
  });

  it('defaults the port to 3000 when only a host is given', () => {
    process.env['HOST'] = 'node-9.internal';

    expect(addressWith({})).toBe('node-9.internal:3000');
  });

  it('prefers an external IPv4 interface over an internal one', () => {
    expect(
      addressWith({
        lo0: [ipv4('127.0.0.1', true)],
        eth0: [ipv4('192.168.1.20', false)],
      })
    ).toBe('192.168.1.20:3000');
  });

  it('ignores IPv6 addresses', () => {
    expect(
      addressWith({
        eth0: [ipv6('fe80::1'), ipv4('192.168.1.21', false)],
      })
    ).toBe('192.168.1.21:3000');
  });

  it('falls back to an internal non-loopback address', () => {
    expect(
      addressWith({
        lo0: [ipv4('127.0.0.1', true)],
        bridge0: [ipv4('10.211.55.2', true)],
      })
    ).toBe('10.211.55.2:3000');
  });

  it('falls back to localhost when only loopback is present', () => {
    expect(addressWith({ lo0: [ipv4('127.0.0.1', true)] })).toBe('localhost:3000');
  });

  it('falls back to localhost when interface detection throws', () => {
    interfaces = () => {
      throw new Error('no such device');
    };
    const service = new DiscoveryService({} as never, createMockLogger(), { autoStart: false } as never);
    expect(service.getAddress()).toBe('localhost:3000');
  });
});
