/**
 * `omnitron list` said the application had crashed. It was serving requests.
 *
 * Measured on the development daemon, four failures in thirty-one seconds:
 *
 *     Restart failed — Netron service failed to start: listen EADDRINUSE:
 *     address already in use 0.0.0.0:3005.
 *
 * The daemon then reported `daos/dev/messaging — crashed, RST 5`, both
 * children `stopped` with no pid, and answered `Max restarts exceeded` to
 * every `omnitron restart`. Meanwhile port 3005 was held by a live process
 * whose parent was the daemon itself: a child of its own that it had stopped
 * accounting for, still answering on the port its replacement needed.
 *
 * Every statement the daemon made was true of its records. None was true of
 * the machine, and the operator had no way to tell which they were reading —
 * the error names the address it could not have and never says who has it.
 *
 * Three readings settle it: the address out of the message, the listener out
 * of the operating system, and the listener's parent. "Somebody else's
 * server" and "my own previous instance" call for opposite responses and are
 * indistinguishable from inside the error.
 */

import { describe, it, expect } from 'vitest';

import {
  addressInUse,
  holderCommand,
  parseHolders,
  explainConflict,
} from '../../src/orchestrator/port-conflict.js';

describe('the address an EADDRINUSE could not have', () => {
  it('reads the one the daemon actually logged', () => {
    const message =
      'Netron service failed to start: listen EADDRINUSE: address already in use 0.0.0.0:3005. ' +
      'The application cannot serve RPC, so it is not started.';

    expect(addressInUse(message)).toEqual({ host: '0.0.0.0', port: 3005 });
  });

  it('reads a loopback and an IPv6 address', () => {
    expect(addressInUse('listen EADDRINUSE: address already in use 127.0.0.1:9229')?.port).toBe(9229);
    expect(addressInUse('listen EADDRINUSE: address already in use :::8080')?.port).toBe(8080);
  });

  it('says nothing about an error that is not this one', () => {
    expect(addressInUse('listen EACCES: permission denied 0.0.0.0:80')).toBeNull();
    expect(addressInUse('connect ECONNREFUSED 127.0.0.1:5432')).toBeNull();
    expect(addressInUse('')).toBeNull();
  });

  it('refuses a port number that is not one', () => {
    expect(addressInUse('listen EADDRINUSE: address already in use 0.0.0.0:99999')).toBeNull();
  });
});

describe('finding the listener', () => {
  it('asks each platform in its own language', () => {
    expect(holderCommand(3005, 'linux')).toEqual({ file: 'ss', args: ['-ltnpH', 'sport = :3005'] });
    expect(holderCommand(3005, 'darwin').file).toBe('lsof');
    expect(holderCommand(3005, 'darwin').args).toContain('-iTCP:3005');
  });

  it('reads what lsof actually prints', () => {
    // Captured from `lsof -nP -iTCP:3005 -sTCP:LISTEN -Fpc` on this machine.
    const output = 'p35448\ncnode\nf24\nn*:3005\n';

    expect(parseHolders(output, 'darwin')).toEqual([{ pid: 35448, command: 'node' }]);
  });

  it('reads what ss actually prints', () => {
    // Captured from the test node, where the apps listen on 3001–3007.
    const output =
      'LISTEN 0      511          0.0.0.0:3005      0.0.0.0:*    users:(("node",pid=989927,fd=28))\n';

    expect(parseHolders(output, 'linux')).toEqual([{ pid: 989927, command: 'node' }]);
  });

  it('reads two listeners on one port, and an empty answer as empty', () => {
    const twice = 'p100\ncnode\nf3\nn*:3005\np101\ncnode\nf3\nn*:3005\n';

    expect(parseHolders(twice, 'darwin').map((h) => h.pid)).toEqual([100, 101]);
    expect(parseHolders('', 'darwin')).toEqual([]);
    expect(parseHolders('', 'linux')).toEqual([]);
  });
});

describe('what the holder is to this daemon', () => {
  const holder = { pid: 58022, command: 'node' };
  const base = { port: 3005, holders: [holder], daemonPid: 43809 };

  it('names our own child that nothing claims — the case that was measured', () => {
    const verdict = explainConflict({
      ...base,
      parentOf: () => 43809,
      owned: new Set<number>(),
    });

    expect(verdict.kind).toBe('ours-unaccounted');
    expect(verdict.because).toContain('58022');
    expect(verdict.because).toContain('half-failed');
  });

  it('separates a child the daemon still accounts for', () => {
    // A restart racing its own predecessor's shutdown is an ordinary, brief
    // condition; a leftover nobody claims is not, and they need different
    // answers from whoever reads the log.
    const verdict = explainConflict({
      ...base,
      parentOf: () => 43809,
      owned: new Set([58022]),
    });

    expect(verdict.kind).toBe('ours-owned');
  });

  it('will not claim somebody else‘s process', () => {
    const verdict = explainConflict({
      ...base,
      parentOf: () => 1,
      owned: new Set<number>(),
    });

    expect(verdict.kind).toBe('foreign');
    expect(verdict.because).toContain('not this daemon');
  });

  it('treats a parent it cannot read as not ours', () => {
    const verdict = explainConflict({
      ...base,
      parentOf: () => undefined,
      owned: new Set<number>(),
    });

    expect(verdict.kind).toBe('foreign');
  });

  it('reports an empty answer as a finding of its own', () => {
    const verdict = explainConflict({
      ...base,
      holders: [],
      parentOf: () => 43809,
      owned: new Set<number>(),
    });

    expect(verdict.kind).toBe('unknown');
    expect(verdict.because).toContain('exited between');
  });
});
