import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { planBareMetal, withMarker, type BareMetalSpec } from '../../src/infrastructure/bare-metal-plan.js';
import { applyBareMetal, localHost, observeBareMetal, type HostRunner } from '../../src/infrastructure/bare-metal-runner.js';
import { fileState } from '../../src/infrastructure/host-inspection.js';
import { provisioningVerdict, summariseProvisioning } from '../../src/infrastructure/provisioning-outcome.js';
import { InfrastructureRpcService } from '../../src/services/infrastructure.rpc-service.js';
import * as runner from '../../src/infrastructure/bare-metal-runner.js';

const spec: BareMetalSpec = { name: 'example', systemdUnit: 'example', configFile: '/etc/example.conf', configContent: 'fixture=1\n' };
const ok = { ok: true, stdout: '', stderr: '' };
const logger = { info: vi.fn(), error: vi.fn() } as never;

function fixture(): HostRunner {
  return { ...localHost(), run: vi.fn(async () => ({ ...ok, stdout: 'LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled' })),
    readFile: vi.fn(async () => withMarker('fixture=1\n')), privateConfigEvidence: vi.fn(async () => null),
    shell: vi.fn(async () => ok), exists: vi.fn(async () => true), writeFile: vi.fn() };
}

describe('observing a declared host file', () => {
  it.each(['EACCES', 'EPERM', 'EIO'])('refuses the entire service on %s reading its config', async code => {
    const host = fixture();
    host.readFile = async () => { throw Object.assign(Error('file unavailable'), { code }); };
    const observed = await observeBareMetal(spec, host);
    expect(fileState(spec.configContent, observed.configContent)).toBe('unreadable');
    expect(planBareMetal(spec, observed)).toMatchObject({ actions: [], refusals: [expect.stringMatching(/could not be read/)] });
  });

  it('honors unreadable unit files and keeps readable legacy files on the ordinary path', async () => {
    const host = fixture();
    const files = { ...spec, unitFile: '/etc/service.unit', unitContent: 'public unit' };
    host.readFile = async path => {
      if (path === files.unitFile) throw Error('unreadable');
      return withMarker(files.configContent!);
    };
    const observed = await observeBareMetal(files, host);
    expect(fileState(files.configContent, observed.configContent)).toBe('matches');
    expect(planBareMetal(files, observed)).toMatchObject({ actions: [], refusals: [expect.stringMatching(/unit file/)] });
    expect(planBareMetal(spec, await observeBareMetal(spec, fixture())).actions.map(a => a.type)).toEqual(['enable-unit', 'start-unit']);
  });

  it('does not refresh package indices for a service that is already refused', async () => {
    const host = fixture();
    const declaration = { ...spec, apt: { latest: ['example'] } };
    const refresh = vi.fn(async () => {});
    host.readFile = async () => { throw Error('permission denied'); };
    expect(planBareMetal(declaration, await observeBareMetal(declaration, host, refresh)).actions).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('distinguishes genuine absence from dangling paths and non-regular files', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'host-file-'));
    try {
      const host = localHost();
      expect(await host.readFile(join(tmp, 'missing', 'config'))).toBeNull();
      const link = join(tmp, 'link');
      await symlink(join(tmp, 'absent'), link);
      await expect(host.readFile(link)).rejects.toThrow();
      await expect(host.readFile(join(link, 'config'))).rejects.toThrow();
      await expect(host.readFile(tmp)).rejects.toThrow();
      const fifo = join(tmp, 'pipe');
      await promisify(execFile)('mkfifo', [fifo]);
      await expect(host.readFile(fifo)).rejects.toThrow(/regular/);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });

  it('preserves a file that appears after an absence observation and stops before enable/start', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'host-file-'));
    try {
      const configFile = join(tmp, 'config');
      const declaration = { ...spec, configFile };
      const host = { ...fixture(), readFile: localHost().readFile, writeFile: localHost().writeFile };
      const plan = planBareMetal(declaration, await observeBareMetal(declaration, host));
      expect(plan.actions[0]).toMatchObject({ type: 'write-config', absent: true });
      await writeFile(configFile, 'belongs to the independent installer');
      const result = await applyBareMetal(plan.actions, host, logger, declaration.name);
      expect(result.failed?.action.type).toBe('write-config');
      expect(result.applied).toEqual([]);
      expect(await readFile(configFile, 'utf8')).toBe('belongs to the independent installer');
      expect(await readdir(tmp)).toEqual(['config']);
      expect(host.run).toHaveBeenCalledTimes(1); // systemctl show only
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
});

describe('private installer evidence in normal provisioning', () => {
  const verified = { state: 'verified-private', receipt: 'same installer receipt' } as const;
  it('includes settled host-only services in stack readiness while an empty or incomplete stack stays unready', () => {
    const empty = summariseProvisioning([], {});
    expect(provisioningVerdict(empty, { settled: [], failed: [] }).ready).toBe(false);
    expect(provisioningVerdict(empty, { settled: ['example'], awaitingObservation: ['example'], failed: [] }).ready).toBe(false);
    expect(provisioningVerdict(empty, { settled: ['example'], failed: [] })).toEqual({ ready: true, detail: 'Host services ready (example)' });
    expect(provisioningVerdict(summariseProvisioning([{ name: 'missing' }], {}), { settled: ['example'], failed: [] }).ready).toBe(false);
  });
  it.each(['refused', 'error'])('does not fall through to reading bytes when verification is %s', async state => {
    const host = fixture();
    host.privateConfigEvidence = async () => {
      if (state === 'error') throw Error('unavailable');
      return { state: 'unreadable' };
    };
    expect(planBareMetal(spec, await observeBareMetal(spec, host)).actions).toEqual([]);
    expect(host.readFile).not.toHaveBeenCalled();
  });

  it('rechecks the same evidence inside the public provisionStack path before each dependent action', async () => {
    const host = fixture();
    let checks = 0;
    host.privateConfigEvidence = async () => ++checks <= 2 ? verified : { ...verified, receipt: 'replacement' };
    const actualHost = vi.spyOn(runner, 'localHost').mockReturnValue(host);
    try {
      const unrelatedContainers = { resumeStack() {}, provision: async () => ({ services: {}, ready: true }), getDesiredServices: () => [] };
      const service = new InfrastructureRpcService(() => null, () => unrelatedContainers as never);
      const verdict = await service.provisionStack({ config: {}, services: { example: { env: {}, ports: {},
        bareMetal: { configFile: spec.configFile!, configTemplate: spec.configContent!, systemdUnit: spec.systemdUnit! } } },
        overrides: { example: { provisioning: 'bareMetal' } } });
      expect(verdict.ready).toBe(false);
      expect(verdict.failed).toContainEqual(expect.objectContaining({ name: 'example', error: expect.stringMatching(/changed since inspection/) }));
      expect(host.readFile).not.toHaveBeenCalled();
      expect(host.writeFile).not.toHaveBeenCalled();
      expect(vi.mocked(host.run).mock.calls.map(call => call[0][1])).toEqual(['show', 'enable']);
    } finally { actualHost.mockRestore(); }
  });
});
