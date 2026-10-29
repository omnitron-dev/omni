import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const { service } = vi.hoisted(() => ({ service: { getRunStatus: vi.fn(), listPipelines: vi.fn() } }));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({ service: async () => service, disconnect: async () => {} }),
}));
import { pipelineListCommand, pipelineStatusCommand } from '../../src/commands/pipeline.js';
import { hasEmittedJson } from '../../src/commands/output.js';

beforeEach(() => {
  vi.resetAllMocks();
  process.exitCode = undefined;
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
  process.exitCode = undefined;
});

async function capture(run: () => Promise<void>) {
  const out: string[] = [],
    err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  await run();
  return { out: out.join(''), err: err.join(''), exitCode: process.exitCode };
}

describe('pipeline CLI uses the shared machine output protocol', () => {
  it.each(['success', 'running', 'failed', 'cancelled', 'interrupted'])(
    'returns one record for a %s run',
    async (status) => {
      const run = { id: 'run-id', status, steps: [] };
      service.getRunStatus.mockResolvedValue(run);
      const output = await capture(() => pipelineStatusCommand(run.id));
      expect(JSON.parse(output.out)).toEqual({ ok: true, data: run });
      expect(output.err).toBe('');
      expect(hasEmittedJson()).toBe(true);
      expect(output.exitCode).toBe(['failed', 'cancelled', 'interrupted'].includes(status) ? 1 : undefined);
    }
  );
  it('reports missing runs as structured failures', async () => {
    service.getRunStatus.mockResolvedValue(null);
    const output = await capture(() => pipelineStatusCommand('missing'));
    expect(output.out).toBe('');
    expect(JSON.parse(output.err)).toMatchObject({ ok: false, error: expect.stringContaining('not found') });
    expect(output.exitCode).toBe(1);
  });
  it('preserves an empty list as data', async () => {
    service.listPipelines.mockResolvedValue([]);
    const output = await capture(pipelineListCommand);
    expect(JSON.parse(output.out)).toEqual({ ok: true, data: { pipelines: [] } });
    expect(output.err).toBe('');
  });
});
