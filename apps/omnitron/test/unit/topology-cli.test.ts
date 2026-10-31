import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setEnvOverride, resetEnvCache } from '../../src/shared/env-config.js';
import { topologyCommand } from '../../src/commands/topology.js';
const api = vi.hoisted(() => ({ getTopologyWorkspace: vi.fn(), saveTopologyDraft: vi.fn(), disconnect: vi.fn(async () => {}) }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => ({ service: async () => api, disconnect: api.disconnect }) }));
afterEach(() => { vi.restoreAllMocks(); resetEnvCache(); });
describe('portable topology CLI documents', () => {
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
