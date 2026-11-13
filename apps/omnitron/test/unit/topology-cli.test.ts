import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setEnvOverride, resetEnvCache } from '../../src/shared/env-config.js';
import { topologyCommand } from '../../src/commands/topology.js';
import { stackReleaseAdmissionCommand, stackStartCommand } from '../../src/commands/stack.js';
const api = vi.hoisted(() => ({ getTopologyWorkspace: vi.fn(), saveTopologyDraft: vi.fn(), refreshTopologyMetadata: vi.fn(),
  checkRelease: vi.fn(), reviewStackStart: vi.fn(), disconnect: vi.fn(async () => {}) }));
vi.mock('../../src/daemon/daemon-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/daemon/daemon-client.js')>(),
  createDaemonClient: () => ({ service: async () => api, disconnect: api.disconnect }),
}));
afterEach(() => { vi.restoreAllMocks(); resetEnvCache(); });
describe('portable topology CLI documents', () => {
  it('refreshes declarations for a complete project through the administrative RPC', async () => {
    api.refreshTopologyMetadata.mockResolvedValue({ refreshed: 3, failures: [] });
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((value: any) => { output += String(value); return true; });
    await topologyCommand('refresh', 'sample');
    expect(api.refreshTopologyMetadata).toHaveBeenCalledWith({ project: 'sample' });
    expect(JSON.parse(output)).toEqual({ ok: true, data: { refreshed: 3, failures: [] } });
  });
  it('sends the selected stack and exact candidate to the same administrative RPC', async () => {
    api.refreshTopologyMetadata.mockResolvedValue({ refreshed: 2, failures: [] });
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await topologyCommand('refresh', 'sample', 'research/local', 'release-b');
    expect(api.refreshTopologyMetadata).toHaveBeenLastCalledWith({ project: 'sample', stack: 'research/local', release: 'release-b' });
    expect(JSON.parse(String(output.mock.lastCall?.[0]))).toEqual({ ok: true, data: { refreshed: 2, failures: [] } });
  });
  it('identifies the same administrative remediation before the stop and during preservation review', async () => {
    const because = 'A stop is required', declarationReason = 'api: bootstrap declarations have not been captured';
    api.checkRelease.mockResolvedValue({ ok: false, state: 'requires-stop', because, declarations: 'refresh-required', declarationReason });
    api.reviewStackStart.mockResolvedValue({ protocol: 1, infrastructure: 'preserve', digest: null,
      targets: [{ node: 'preflight', reason: declarationReason, refreshDeclarations: { release: 'release-b' } }] });
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const previous = process.exitCode;
    try {
      await stackReleaseAdmissionCommand('sample', 'research/local', 'release-b', true);
      const admission = JSON.parse(String(output.mock.lastCall?.[0])).data;
      expect(admission).toMatchObject({ state: 'requires-stop', prepared: true, declarationReason,
        action: "omnitron topology refresh 'sample' 'research/local' --release 'release-b'" });
      await stackStartCommand('sample', 'research/local', { release: 'release-b', dryRun: true });
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(String(output.mock.lastCall?.[0])).data.action).toBe(admission.action);
    } finally { process.exitCode = previous; }
  });
  it('exports raw JSON in normal mode and round-trips it through the draft command', async () => {
    const spec = { version: 1, type: 'local', apps: ['api'], nodes: [] };
    api.getTopologyWorkspace.mockResolvedValue({ revision: 'current', desired: spec, draft: null });
    api.saveTopologyDraft.mockResolvedValue({ revision: 1, spec });
    setEnvOverride({ OMNITRON_OUTPUT: 'human' });
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((value: any) => { output += String(value); return true; });
    await topologyCommand('export', 'sample', 'dev');
    expect(JSON.parse(output)).toEqual(spec);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'topology-cli-'));
    try {
      const file = path.join(directory, 'target.json');
      await fs.writeFile(file, output);
      await topologyCommand('draft', 'sample', 'dev', file);
      expect(api.saveTopologyDraft).toHaveBeenCalledWith({ project: 'sample', stack: 'dev', baseRevision: 'current', expectedDraft: null, spec });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it('uses the common result envelope when JSON mode is explicitly requested', async () => {
    const spec = { version: 1, type: 'local', apps: [], nodes: [] };
    api.getTopologyWorkspace.mockResolvedValue({ desired: spec, draft: null });
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((value: any) => { output += String(value); return true; });
    await topologyCommand('export', 'sample', 'dev');
    expect(JSON.parse(output)).toEqual({ ok: true, data: spec });
  });
});
