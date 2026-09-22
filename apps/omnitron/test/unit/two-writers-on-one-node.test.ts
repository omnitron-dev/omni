/**
 * Two writers on one node.
 *
 * Every development machine is a master that deploys to the same test node,
 * and nothing made them see each other: two `stack start daos test` from two
 * machines interleaved on the node, one delivering while the other restarted.
 * The node now carries a lease (`node-deploy-lease.ts`), and this court holds
 * it to the three things a lease has to do:
 *
 *   1. REFUSE a second writer, and say who holds the node — including a lease
 *      renewed zero seconds ago, which a `||`-shaped check reads as absent;
 *   2. free itself when its holder dies, and tell the old holder it is gone;
 *   3. refuse to deploy unlocked when the node cannot lock — and treat an
 *      answer it does not recognise as a refusal, never as a lease.
 *
 * The scripts are run for real, under /bin/sh, against a temporary directory
 * standing in for `/opt/omnitron/locks`. `flock` is replaced by a no-op on
 * PATH: exclusion itself is the kernel's and is checked live on the node;
 * what is checked here is every decision the scripts make around it.
 */

import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LeaseHeldError,
  LeaseUnavailableError,
  NodeLease,
  assertTiming,
  parseAcquire,
  withNodeLeases,
  type LeaseRunner,
  type LeaseTiming,
} from '../../src/services/node-deploy-lease.js';

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
};

let root: string;
let fakeBin: string;
let bareBin: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-lease-'));
  fakeBin = path.join(root, 'bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // A PATH with every tool the scripts use and no flock at all.
  bareBin = path.join(root, 'bare');
  fs.mkdirSync(bareBin);
  for (const tool of ['date', 'stat', 'grep', 'touch', 'mv', 'cat', 'mkdir', 'rm']) {
    const where = execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
    fs.symlinkSync(where, path.join(bareBin, tool));
  }
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A "node": a lock directory, reached by running the script locally. */
function node(name: string, pathEnv?: string): { dir: string; timing: LeaseTiming; run: LeaseRunner } {
  const dir = fs.mkdtempSync(path.join(root, `${name}-`));
  const timing: LeaseTiming = { dir, leaseSec: 120, renewEveryMs: 30_000 };
  const run: LeaseRunner = (script) =>
    new Promise((resolve, reject) => {
      execFile(
        '/bin/sh',
        ['-c', script],
        { env: { ...process.env, PATH: pathEnv ?? `${fakeBin}:${process.env['PATH'] ?? ''}` } },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
  return { dir, timing, run };
}

const leaseFile = (dir: string) => path.join(dir, 'deploy.lease');

/** Pretend the holder stopped renewing `seconds` ago. */
function age(dir: string, seconds: number): void {
  const then = new Date(Date.now() - seconds * 1000);
  fs.utimesSync(leaseFile(dir), then, then);
}

describe('a second writer is refused', () => {
  it('and is told who holds the node — a lease renewed 0 s ago is held, not absent', async () => {
    const n = node('refused');
    const first = new NodeLease('203.0.113.7:9700', n.run, 'daos/test', n.timing);
    const second = new NodeLease('203.0.113.7:9700', n.run, 'daos/test', n.timing);

    expect(await first.acquire()).toEqual({ kind: 'acquired', lapsed: null });
    const answer = await second.acquire();

    expect(answer.kind).toBe('held');
    if (answer.kind !== 'held') return;
    expect(answer.holder?.token).toBe(first.record.token);
    expect(answer.holder?.stack).toBe('daos/test');
    expect(answer.idleSec).toBeGreaterThanOrEqual(0);
    expect(answer.idleSec).toBeLessThan(120);
    await first.release();
  });

  it('gives the node to the second writer once the first gives it back', async () => {
    const n = node('handover');
    const first = new NodeLease('n', n.run, 'daos/test', n.timing);
    const second = new NodeLease('n', n.run, 'daos/test', n.timing);

    await first.acquire();
    // Renew and release act on their own token only.
    expect((await second.release()).kind).toBe('not-held');
    expect(fs.existsSync(leaseFile(n.dir))).toBe(true);
    expect(await first.release()).toEqual({ kind: 'released' });
    expect(fs.existsSync(leaseFile(n.dir))).toBe(false);

    expect((await second.acquire()).kind).toBe('acquired');
    await second.release();
  });

  it('the same attempt asking again keeps its lease', async () => {
    const n = node('retry');
    const lease = new NodeLease('n', n.run, 'daos/test', n.timing);
    await lease.acquire();
    expect(await lease.acquire()).toEqual({ kind: 'acquired', lapsed: null });
    await lease.release();
  });
});

describe('a holder that died frees the node by itself', () => {
  it('a lease unrenewed past its term is taken over, and the takeover names the old holder', async () => {
    const n = node('lapsed');
    const dead = new NodeLease('n', n.run, 'daos/test', n.timing);
    const next = new NodeLease('n', n.run, 'daos/test', n.timing);

    await dead.acquire();
    age(n.dir, 200);
    const answer = await next.acquire();

    expect(answer.kind).toBe('acquired');
    if (answer.kind !== 'acquired') return;
    expect(answer.lapsed?.previous?.token).toBe(dead.record.token);
    expect(answer.lapsed?.idleSec).toBeGreaterThanOrEqual(120);
    await next.release();
  });

  it('one second short of the term is still held', async () => {
    const n = node('edge');
    const first = new NodeLease('n', n.run, 'daos/test', n.timing);
    await first.acquire();
    age(n.dir, 115);
    expect((await new NodeLease('n', n.run, 'daos/test', n.timing).acquire()).kind).toBe('held');
    await first.release();
  });

  it('the old holder finds out before it changes anything else on the node', async () => {
    const n = node('woke');
    const asleep = new NodeLease('203.0.113.7:9700', n.run, 'daos/test', n.timing);
    const other = new NodeLease('203.0.113.7:9700', n.run, 'daos/test', n.timing);

    await asleep.acquire();
    age(n.dir, 200);
    await other.acquire();

    await expect(asleep.confirm('delivering 6 artifact(s)')).rejects.toThrow(
      /Stopped before delivering 6 artifact\(s\) on 203\.0\.113\.7:9700: .*taken over by .* pid \d+/,
    );
    // And it does not take the node back by releasing it.
    expect((await asleep.release()).kind).toBe('not-held');
    expect(fs.existsSync(leaseFile(n.dir))).toBe(true);
    await other.release();
  });

  it('a holder whose lease was NOT taken over confirms and carries on', async () => {
    const n = node('confirmed');
    const lease = new NodeLease('n', n.run, 'daos/test', n.timing);
    await lease.acquire();
    age(n.dir, 60);
    await expect(lease.confirm('joining the mesh')).resolves.toBeUndefined();
    await lease.release();
  });
});

describe('a node that cannot lock refuses the deployment', () => {
  it('no flock on the node: refused with the reason, nothing written', async () => {
    const n = node('noflock', bareBin);
    const lease = new NodeLease('203.0.113.7:9700', n.run, 'daos/test', n.timing);

    await expect(lease.acquire()).rejects.toThrow(LeaseUnavailableError);
    await expect(lease.acquire()).rejects.toThrow(/no flock\(1\)/);
    expect(fs.existsSync(leaseFile(n.dir))).toBe(false);
  });

  it('an answer nobody recognises is a refusal, never a lease', () => {
    expect(() => parseAcquire('n', '')).toThrow(LeaseUnavailableError);
    expect(() => parseAcquire('n', 'Welcome to Ubuntu 24.04\n')).toThrow(/not recognised/);
    expect(() => parseAcquire('n', 'NETWORK-FS nfs4\n')).toThrow(/network filesystem \(nfs4\)/);
  });

  it('a timing that one missed renewal could lose is refused before anything runs', () => {
    const ok: LeaseTiming = { dir: '/opt/omnitron/locks', leaseSec: 120, renewEveryMs: 60_000 };
    expect(() => assertTiming(ok)).not.toThrow();
    expect(() => assertTiming({ ...ok, leaseSec: 0 })).toThrow(/positive/);
    expect(() => assertTiming({ ...ok, leaseSec: 120.5 })).toThrow(/whole number/);
    expect(() => assertTiming({ ...ok, renewEveryMs: 61_000 })).toThrow(/at most half/);
    expect(() => assertTiming({ ...ok, renewEveryMs: 0 })).toThrow(/positive/);
    expect(() => assertTiming({ ...ok, dir: 'locks' })).toThrow(/absolute/);
  });
});

describe('a deployment takes every node first and gives them all back', () => {
  it('one held node refuses the whole deployment, and the node already taken is given back', async () => {
    const a = node('stack-a');
    const b = node('stack-b');
    const squatter = new NodeLease('b', b.run, 'daos/test', b.timing);
    await squatter.acquire();
    let deployed = false;

    await expect(
      withNodeLeases(
        [
          { node: 'b', run: b.run },
          { node: 'a', run: a.run },
        ],
        'daos/test',
        silentLogger,
        async () => {
          deployed = true;
        },
        a.timing,
      ),
    ).rejects.toThrow(LeaseHeldError);

    expect(deployed).toBe(false);
    // `a` sorts first and was taken before `b` refused; it must not stay taken.
    expect(fs.existsSync(leaseFile(a.dir))).toBe(false);
    await squatter.release();
  });

  it('a node that cannot be reached is left out, and the rest are deployed', async () => {
    const a = node('reach-a');
    const seen: Array<{ a: boolean; b: boolean; why: string | undefined }> = [];

    await withNodeLeases(
      [
        { node: 'a', run: a.run },
        { node: 'b', run: async () => Promise.reject(new Error('ssh root@10.0.0.9: connect ECONNREFUSED')) },
      ],
      'daos/test',
      silentLogger,
      async (leases) => {
        seen.push({ a: leases.has('a'), b: leases.has('b'), why: leases.unreachable.get('b') });
        await leases.confirm('a', 'provisioning');
        await expect(leases.confirm('b', 'provisioning')).rejects.toThrow(/does not hold its lease/);
      },
      a.timing,
    );

    expect(seen).toEqual([{ a: true, b: false, why: expect.stringMatching(/ECONNREFUSED/) }]);
    expect(fs.existsSync(leaseFile(a.dir))).toBe(false);
  });

  it('a node that answers and cannot lock refuses everything', async () => {
    const a = node('lock-a');
    await expect(
      withNodeLeases(
        [
          { node: 'a', run: a.run },
          { node: 'b', run: async () => 'NO-FLOCK\n' },
        ],
        'daos/test',
        silentLogger,
        async () => {},
        a.timing,
      ),
    ).rejects.toThrow(/Cannot lock b for deployment: the node has no flock/);
    expect(fs.existsSync(leaseFile(a.dir))).toBe(false);
  });

  it('gives the leases back even when the deployment throws', async () => {
    const a = node('throws');
    await expect(
      withNodeLeases([{ node: 'a', run: a.run }], 'daos/test', silentLogger, async () => {
        expect(fs.existsSync(leaseFile(a.dir))).toBe(true);
        throw new Error('delivery failed');
      }, a.timing),
    ).rejects.toThrow('delivery failed');
    expect(fs.existsSync(leaseFile(a.dir))).toBe(false);
  });
});
