/**
 * `checkPublishedPorts` — the container whose ports the host cannot reach.
 *
 * The check exists because Docker's `running`, its network attachment and
 * its healthcheck are all statements about the INSIDE of the container,
 * and all three can pass while the host-side publishing is gone. What is
 * pinned here is mostly the restraint: the conditions under which the check
 * says nothing matter more than the one under which it speaks, because a
 * diagnostic that fires on a container that is merely still starting trains
 * an operator to ignore it.
 */

import net from 'node:net';

import { describe, it, expect, afterEach } from 'vitest';

import { Findings, checkPublishedPorts, directorySize, biggestSubdirectories } from '../../src/commands/doctor.js';
import type { ContainerState } from '../../src/infrastructure/types.js';

/** A real listener, so "reachable" is observed rather than mocked. */
async function listener(): Promise<{ port: number; close: () => void }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, close: () => server.close() };
}

/** A port nothing is listening on: bound, read, released. */
async function deadPort(): Promise<number> {
  const l = await listener();
  l.close();
  return l.port;
}

const open: net.Server[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

function container(over: Partial<ContainerState>): ContainerState {
  return {
    name: 'omnitron-pg',
    image: 'postgres:17',
    status: 'running',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    ...over,
  };
}

describe('checkPublishedPorts', () => {
  it('says nothing when the published port answers', async () => {
    const l = await listener();
    try {
      const findings = new Findings();
      await checkPublishedPorts(findings, container({ ports: { '5432/tcp': l.port } }));
      expect(findings.all()).toEqual([]);
    } finally {
      l.close();
    }
  });

  it('calls a healthy container with an unreachable port an error, and prescribes recreation', async () => {
    const port = await deadPort();
    const findings = new Findings();

    await checkPublishedPorts(findings, container({ ports: { '5432/tcp': port }, health: 'healthy' }));

    const [finding] = findings.all();
    expect(finding?.id).toBe('infra.port-unreachable');
    // Healthy INSIDE while unreachable from the host localises the fault to
    // the publishing, which a restart does not rebuild — only creation does.
    expect(finding?.severity).toBe('error');
    expect(finding?.remedy).toMatch(/docker rm -f/);
    expect(finding?.remedy).toMatch(/[Rr]estarting is not enough/);
    expect(finding?.evidence.join(' ')).toContain(String(port));
  });

  it('drops to a warning, naming both causes, when there is no healthcheck', async () => {
    const port = await deadPort();
    const findings = new Findings();

    await checkPublishedPorts(findings, container({ ports: { '5432/tcp': port }, health: 'none' }));

    const [finding] = findings.all();
    // Without a healthcheck the same evidence cannot distinguish "the
    // process never bound" from "the publishing broke". Saying so is the
    // honest reading; picking one would be a guess presented as a diagnosis.
    expect(finding?.severity).toBe('warning');
    expect(finding?.remedy).toMatch(/[Ee]ither/);
    expect(finding?.remedy).toMatch(/never bound/);
  });

  it('stays quiet while the container is still starting', async () => {
    const port = await deadPort();
    const findings = new Findings();

    await checkPublishedPorts(findings, container({ ports: { '5432/tcp': port }, health: 'starting' }));

    expect(findings.all()).toEqual([]);
  });

  it('stays quiet inside the settle window even without a healthcheck', async () => {
    const port = await deadPort();
    const findings = new Findings();

    await checkPublishedPorts(
      findings,
      container({ ports: { '5432/tcp': port }, startedAt: new Date().toISOString() })
    );

    expect(findings.all()).toEqual([]);
  });

  it('ignores UDP publishing', async () => {
    // A TCP connect to a UDP-published port fails by construction, so
    // probing one would report every UDP service as broken forever.
    const port = await deadPort();
    const findings = new Findings();

    await checkPublishedPorts(findings, container({ name: 'coturn', ports: { '3478/udp': port } }));

    expect(findings.all()).toEqual([]);
  });

  it('says nothing about a container that publishes nothing', async () => {
    const findings = new Findings();
    await checkPublishedPorts(findings, container({ ports: undefined }));
    expect(findings.all()).toEqual([]);
  });

  it('reports every unreachable port, not just the first', async () => {
    const a = await deadPort();
    const b = await deadPort();
    const findings = new Findings();

    await checkPublishedPorts(findings, container({ ports: { '5432/tcp': a, '5433/tcp': b } }));

    const [finding] = findings.all();
    expect(finding?.title).toContain(String(a));
    expect(finding?.title).toContain(String(b));
  });
});

describe('directorySize', () => {
  it('sums a tree', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-size-'));
    try {
      fs.writeFileSync(path.join(root, 'a'), 'x'.repeat(100));
      fs.mkdirSync(path.join(root, 'nested'));
      fs.writeFileSync(path.join(root, 'nested', 'b'), 'y'.repeat(50));

      expect(directorySize(root)).toBe(150);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns 0 for a directory that does not exist rather than throwing', () => {
    // The check calls this on a log directory that may never have been
    // created. A throw here would be reported as "the disk-space check could
    // not complete", replacing a real finding with a diagnostic about itself.
    expect(directorySize('/nonexistent-omnitron-logs-xyz')).toBe(0);
  });

  it('stops at its entry budget instead of walking an unbounded tree', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-budget-'));
    try {
      for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(root, `f${i}`), 'z'.repeat(10));

      // With room for four entries the total must be short of the true 100:
      // the budget is a real ceiling, not a value the walk exceeds anyway.
      const bounded = directorySize(root, { entries: 4 });
      expect(bounded).toBeLessThan(100);
      expect(directorySize(root)).toBe(100);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('biggestSubdirectories', () => {
  it('names what is actually holding the space, largest first', async () => {
    // The reason this exists rather than a hard-coded directory name: the
    // check used to report omnitron's LOG directory as the consumer, because
    // that is the plausible one for a tool that writes logs. Measured on this
    // host, logs were 163 MiB of a 7.4 GiB footprint while build artefacts
    // held 4.4 GiB — so the evidence pointed at the one directory that was
    // already rotating correctly.
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-dirs-'));
    try {
      const write = (dir: string, bytes: number) => {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
        fs.writeFileSync(path.join(root, dir, 'blob'), 'x'.repeat(bytes));
      };
      write('logs', 10);
      write('projects', 1000);
      write('backups', 500);
      write('data', 1);
      fs.writeFileSync(path.join(root, 'loose-file'), 'y'.repeat(9999));

      const top = biggestSubdirectories(root, 3);

      expect(top.map((d) => d.name)).toEqual(['projects', 'backups', 'logs']);
      expect(top[0]!.bytes).toBe(1000);
      // A loose file is not a subdirectory and must not appear, however big.
      expect(top.some((d) => d.name === 'loose-file')).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns nothing for a directory it cannot read', () => {
    expect(biggestSubdirectories('/nonexistent-omnitron-home-xyz', 3)).toEqual([]);
  });

  it('skips empty subdirectories rather than listing them at zero', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-empty-'));
    try {
      fs.mkdirSync(path.join(root, 'empty'));
      fs.mkdirSync(path.join(root, 'full'));
      fs.writeFileSync(path.join(root, 'full', 'blob'), 'z'.repeat(100));

      expect(biggestSubdirectories(root, 5).map((d) => d.name)).toEqual(['full']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
