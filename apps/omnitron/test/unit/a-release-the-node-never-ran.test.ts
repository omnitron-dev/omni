/**
 * A release the node never ran.
 *
 * A release carries its omni packages, built from the omni commit its gates
 * ran against; on the node, the remote deployer links every `@omnitron-dev/*`
 * of the application to the node DAEMON's own instead, because the
 * application is loaded into the daemon's process. So what an application
 * runs is the daemon's omni. On daos/test (2026-09-25) a release gated on omni
 * de454a80 ran under a daemon from 311bddb1 — admitted, deployed and attested
 * 37 of 37, while the fixes it was built to ship were not on the node.
 *
 * Held here: admission asks each node's daemon which omni it was built from,
 * and refuses a release gated on another — or on a node that does not say —
 * naming the node, both commits and the way out, before anything moves.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { commitOfDaemonVersion, refuseForeignOmni } from '../../src/release/daemon-omni.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';
import { ProjectService } from '../../src/services/project.service.js';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'node-never-ran-')));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

const RELEASE_OMNI = 'de454a80a3bda744387f2439101b30fc735c0ae6';
const daemon = (sha: string) => `0.2.0+local.${sha.slice(0, 12)}.202609251029`;

describe('the omni a daemon version names', () => {
  it('reads the commit from a local build, and nothing from a version without one', () => {
    expect(commitOfDaemonVersion('0.2.0+local.de454a80a3bd.202609251029')).toBe('de454a80a3bd');
    expect(commitOfDaemonVersion('0.2.0')).toBeNull();
    expect(commitOfDaemonVersion('0.2.0+local.nocommit.202609251029')).toBeNull();
    expect(commitOfDaemonVersion(null)).toBeNull();
  });
});

describe('a release and the daemons it would run under', () => {
  it('goes where every daemon is its omni', () => {
    expect(refuseForeignOmni(RELEASE_OMNI, [{ host: 'a', version: daemon(RELEASE_OMNI) }])).toBeNull();
  });

  it('is refused where a daemon is another omni, naming the node, both commits and the way out', () => {
    const why = refuseForeignOmni(RELEASE_OMNI, [{ host: '37.27.130.185', version: daemon('311bddb1e8d2') }]);
    expect(why).toMatch(/37\.27\.130\.185's daemon runs omni 311bddb1 \(0\.2\.0\+local\.311bddb1e8d2\.\d+\)/);
    expect(why).toMatch(/gated on omni de454a80/);
    expect(why).toMatch(/omnitron fleet upgrade <node>/);
  });

  it('is refused where a node does not say, or says a version with no commit', () => {
    expect(
      refuseForeignOmni(RELEASE_OMNI, [{ host: 'b', version: null, error: 'Slave b:9700 not connected' }])
    ).toMatch(/b did not say which omni its daemon runs \(Slave b:9700 not connected\)/);
    expect(refuseForeignOmni(RELEASE_OMNI, [{ host: 'c', version: '0.2.0' }])).toMatch(
      /c's daemon 0\.2\.0 names no omni commit/
    );
  });
});

describe('admission asks the node before anything moves', () => {
  function setup(answer: () => Promise<unknown>) {
    const dir = fs.mkdtempSync(path.join(scratch, 'project-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'omnitron.config.ts'), 'export default {};\n');
    git('add', '.');
    git('commit', '-qm', 'one');
    const commit = git('rev-parse', 'HEAD');

    const id = `daos-${crypto.randomBytes(4).toString('hex')}`;
    const store = path.join(scratch, `store-${id}`);
    fs.mkdirSync(path.join(store, id, 'artifacts'), { recursive: true });
    const body = 'main-tarball';
    fs.writeFileSync(path.join(store, id, 'artifacts', 'main-0.0.1.tar.gz'), body);
    const manifest: ReleaseManifest = {
      id,
      project: { repo: 'gitlab', commit, onRemote: true },
      omni: { repo: 'github', commit: RELEASE_OMNI, onRemote: true },
      artifacts: [
        {
          app: 'main',
          version: '0.0.1',
          sha256: crypto.createHash('sha256').update(body).digest('hex'),
          bytes: body.length,
        },
      ],
      gates: [{ name: 'build', status: 'passed' }],
      builtWith: { omnitron: '0.2.0', packages: [] },
      builtAt: '2026-09-25T10:00:00.000Z',
      builtBy: 'test',
    };
    fs.writeFileSync(path.join(store, id, 'manifest.json'), JSON.stringify(manifest));

    const invokeOnSlave = vi.fn(answer);
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      audit: { record: vi.fn(async () => {}) },
      registry: { get: () => ({ name: 'daos', path: dir }), list: () => [] },
      stackStates: new Map(),
      startsInFlight: new Map(),
      loadProjectConfig: vi.fn(async () => ({ apps: [{ name: 'main', script: 'x' }] })),
      resolveStacks: () => ({
        test: {
          type: 'remote',
          apps: 'all',
          nodes: [{ host: '37.27.130.185', port: 9700 }],
          release: { mode: 'required' },
        },
      }),
      startRemoteStack: vi.fn(async () => ({ nodes: 1, reached: 1, skipped: [] })),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type: 'remote', apps: [{ name: 'main', status: 'online' }] }),
      emit: vi.fn(),
      releaseStore: async () => store,
      slaveConnector: { invokeOnSlave },
    });
    return { id, svc, invokeOnSlave };
  }

  it('refuses a release gated on one omni for a node whose daemon is another, and ships nothing', async () => {
    const { id, svc, invokeOnSlave } = setup(async () => ({ version: daemon('311bddb1e8d2'), pid: 1, uptime: 1 }));
    await expect(svc.startStack('daos', 'test', { source: 'operator', release: id })).rejects.toThrow(
      /37\.27\.130\.185's daemon runs omni 311bddb1 .* gated on omni de454a80/
    );
    expect(invokeOnSlave).toHaveBeenCalledWith('37.27.130.185', 9700, 'OmnitronDaemon', 'ping', []);
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });

  it('refuses when the node cannot be asked', async () => {
    const { id, svc } = setup(async () => {
      throw new Error('Slave 37.27.130.185:9700 not connected');
    });
    await expect(svc.startStack('daos', 'test', { source: 'operator', release: id })).rejects.toThrow(
      /did not say which omni its daemon runs \(Slave 37\.27\.130\.185:9700 not connected\)/
    );
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });

  it("admits it onto a node whose daemon is the release's omni — the control", async () => {
    const { id, svc } = setup(async () => ({ version: daemon(RELEASE_OMNI), pid: 1, uptime: 1 }));
    await svc.startStack('daos', 'test', { source: 'operator', release: id });
    expect(svc.startRemoteStack).toHaveBeenCalledTimes(1);
  });
});
