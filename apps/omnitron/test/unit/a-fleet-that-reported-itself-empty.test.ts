/**
 * `omnitron fleet status` said there were no remote servers, about a fleet of
 * two.
 *
 * There are two registries for "a remote machine" and they do not know about
 * each other: `~/.omnitron/servers.json`, written by `omnitron remote add`,
 * and the SQLite `nodes` table, written by the console's Nodes page. The
 * fleet commands read the first.
 *
 * Measured 2026-09-15 on this installation: `servers.json` does not exist,
 * and the `nodes` table holds two remote machines that the daemon
 * health-checks every minute and the console shows on its Nodes page.
 * `omnitron fleet status` printed
 *
 *     No remote servers registered. Use `omnitron remote add` to add servers.
 *
 * False about the fleet, and it directs the operator to register — a second
 * time, in a second place — machines the product already knows. Which of the
 * two registries should survive is a decision with consequences for stored
 * credentials; that is not decided here. Neither answering for the other's
 * machines is not a decision, it is a lie, and that is.
 */

import { describe, it, expect } from 'vitest';

import { mergeKnownMachines, type NodeLike } from '../../src/infrastructure/known-machines.js';
import type { ServerInfoDto } from '../../src/shared/dto/services.js';

const server = (over: Partial<ServerInfoDto> & { alias: string; host: string }): ServerInfoDto => ({
  port: 9700, tags: [], status: 'unknown', lastSeen: 0, ...over,
});

const node = (over: Partial<NodeLike> & { name: string; host: string }): NodeLike => ({
  id: `id-${over.name}`, daemonPort: 9700, tags: [], isLocal: false, ...over,
});

describe('the machines this installation knows', () => {
  it('finds the ones only the console registered', () => {
    // The case that was reported as an empty fleet.
    const found = mergeKnownMachines([], [node({ name: 'edge-1', host: '203.0.113.7' })]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'edge-1', host: '203.0.113.7', sources: ['nodes'] });
  });

  it('still finds the ones only `remote add` registered', () => {
    const found = mergeKnownMachines([server({ alias: 'prod-1', host: '198.51.100.4' })], []);

    expect(found[0]).toMatchObject({ name: 'prod-1', sources: ['servers.json'] });
  });

  it('counts a machine in both registries once', () => {
    const found = mergeKnownMachines(
      [server({ alias: 'prod-1', host: '203.0.113.7' })],
      [node({ name: 'edge-1', host: '203.0.113.7' })],
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.sources).toEqual(['servers.json', 'nodes']);
  });

  it('matches on the address, not the name', () => {
    // An alias and a node's name are chosen by a person on two different
    // occasions and need not agree; the address is what either is for.
    // Matching on the name would report one machine as two.
    const found = mergeKnownMachines(
      [server({ alias: 'the-box', host: '203.0.113.7' })],
      [node({ name: 'edge-1', host: '203.0.113.7' })],
    );

    expect(found).toHaveLength(1);
  });

  it('treats different ports on one host as different machines', () => {
    // Two daemons on one box is a real arrangement, and collapsing them would
    // hide one.
    const found = mergeKnownMachines(
      [],
      [node({ name: 'a', host: '203.0.113.7', daemonPort: 9700 }),
       node({ name: 'b', host: '203.0.113.7', daemonPort: 9800 })],
    );

    expect(found).toHaveLength(2);
  });

  it('keeps the name the fleet commands have always used', () => {
    // Renaming a machine an operator has scripts for would be a worse
    // surprise than the duplicate listing this replaces.
    const found = mergeKnownMachines(
      [server({ alias: 'prod-1', host: '203.0.113.7' })],
      [node({ name: 'edge-1', host: '203.0.113.7' })],
    );

    expect(found[0]!.name).toBe('prod-1');
  });

  it('carries the node id, because acting on a machine needs it', () => {
    // The credentials live in the node registry. A machine known through
    // `servers.json` alone cannot be deployed to, and one known through both
    // can — which is only visible if the id travels.
    const found = mergeKnownMachines(
      [server({ alias: 'prod-1', host: '203.0.113.7' })],
      [node({ name: 'edge-1', host: '203.0.113.7' })],
    );

    expect(found[0]!.nodeId).toBe('id-edge-1');
    expect(mergeKnownMachines([server({ alias: 'x', host: '1.2.3.4' })], [])[0]!.nodeId).toBeUndefined();
  });

  it('unions the tags of a machine known twice', () => {
    const found = mergeKnownMachines(
      [server({ alias: 'prod-1', host: '203.0.113.7', tags: ['eu'] })],
      [node({ name: 'edge-1', host: '203.0.113.7', tags: ['eu', 'test'] })],
    );

    expect([...found[0]!.tags].sort()).toEqual(['eu', 'test']);
  });

  it('leaves the local node out of the fleet', () => {
    // A fleet is the machines that are not this one. Including it would have
    // `fleet status` reach over the network to the daemon running the command
    // and report it as a peer.
    const found = mergeKnownMachines([], [
      node({ name: 'Local Machine', host: '127.0.0.1', isLocal: true }),
      node({ name: 'edge-1', host: '203.0.113.7' }),
    ]);

    expect(found.map((m) => m.name)).toEqual(['edge-1']);
  });

  it('is empty when both registries are', () => {
    expect(mergeKnownMachines([], [])).toEqual([]);
  });
});

describe('what the fleet commands may write back', () => {
  it('marks a servers.json machine as writable and a node as not', () => {
    // `fleet status` records what its probe found. For a `servers.json`
    // machine that is the only record there is. For a node it would be a
    // SECOND one — the health monitor already writes liveness to the node
    // registry every minute — and creating it would produce exactly the
    // duplicate entry this merge exists to prevent, from a READ command.
    const [fromServers] = mergeKnownMachines([server({ alias: 'a', host: '1.1.1.1' })], []);
    const [fromNodes] = mergeKnownMachines([], [node({ name: 'b', host: '2.2.2.2' })]);
    const [both] = mergeKnownMachines(
      [server({ alias: 'c', host: '3.3.3.3' })], [node({ name: 'c2', host: '3.3.3.3' })],
    );

    expect(fromServers!.sources.includes('servers.json')).toBe(true);
    expect(fromNodes!.sources.includes('servers.json')).toBe(false);
    // A machine in both is written back, because its servers.json entry is
    // real and would otherwise go stale.
    expect(both!.sources.includes('servers.json')).toBe(true);
  });
});
