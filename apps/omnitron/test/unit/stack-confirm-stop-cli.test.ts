import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';
import { stackConfirmStopCommand } from '../../src/commands/stack.js';

const rpc = vi.hoisted(() => ({ getStack: vi.fn(), listNodes: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => ({
  service: async (name: string) => name === 'OmnitronProject' ? { getStack: rpc.getStack } : { listNodes: rpc.listNodes },
  disconnect: rpc.disconnect,
}) }));
const originalExit = process.exitCode;
const operation = '12345678-1234-4123-8123-123456789abc';
const node = { id: 'source', host: '192.0.2.10', daemonPort: 9700, isLocal: false };
const observed = { node: node.id, outcome: 'stopped', operationId: 'peer-stop', observedAt: '2026-01-03T12:00:00Z' };
const address = node.host + ':' + node.daemonPort;
let out: string;
let error: string;
beforeEach(() => {
  process.exitCode = 0;
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  out = ''; error = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { out += String(chunk); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { error += String(chunk); return true; });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); resetEnvCache(); process.exitCode = originalExit; });

async function read(stop = {}, inventory = [node], stack = {}) {
  rpc.listNodes.mockResolvedValue(inventory);
  rpc.getStack.mockResolvedValue({ name: 'prod', status: 'stopped',
    stopOperation: { id: operation, phase: 'stopped', nodes: [observed], ...stop }, ...stack });
  await stackConfirmStopCommand('example', 'prod', { operation, sourceNode: node.id, sourceHost: node.host });
  expect(rpc.getStack).toHaveBeenCalledWith({ project: 'example', stack: 'prod' });
  expect(rpc.disconnect).toHaveBeenCalledOnce();
}

it.each([observed, { ...observed, node: address }, { ...observed, node: address, nodeId: node.id },
  { ...observed, node: 'local', authority: { nodeId: node.id } }])('binds the observed full stop to the enrolled source', async ack => {
  await read({ nodes: [ack] });
  expect(process.exitCode).toBe(0);
  expect(JSON.parse(out)).toEqual({ ok: true, data: { project: 'example', stack: 'prod', operation, sourceNode: 'source', sourceIp: node.host } });
});

it.each([{ id: 'superseded' }, { phase: 'stopping' }, { keepInfrastructure: true }, { supersededAt: 'now' }, { nodes: [] },
  { nodes: [observed, { ...observed, node: 'peer', outcome: 'unknown' }] },
  { nodes: [{ ...observed, node: 'elsewhere' }] }, { nodes: [{ ...observed, node: 'local', nodeId: node.id }] },
  { nodes: [{ ...observed, authority: { nodeId: 'elsewhere' } }] }, { nodes: [{ ...observed, nodeId: 'elsewhere' }] },
  { nodes: [{ ...observed, node: node.host + ':9701' }] }, { nodes: [{ ...observed, operationId: undefined }] },
  { nodes: [{ ...observed, observedAt: undefined }] }, { nodes: [observed, { ...observed, node: address }] }]
)('refuses an incomplete or superseded stop', async stop => {
  await read(stop);
  expect(process.exitCode).toBe(1);
  expect(out).toBe('');
  expect(error).toContain('approved full stack stop');
});

it.each([[], [node, { ...node, id: 'alias' }], [node, { ...node, host: '192.0.2.11' }],
  [{ ...node, host: '192.0.2.12' }], [{ ...node, daemonPort: 0 }], [{ ...node, isLocal: true }]]
  .map(inventory => ({ inventory })))('refuses missing, changed or ambiguous enrollment', async ({ inventory }) => {
  await read({}, inventory);
  expect(process.exitCode).toBe(1);
  expect(out).toBe('');
});

it('refuses a running stack even when a stopped receipt is present', async () => {
  await read({}, [node], { status: 'running' });
  expect(process.exitCode).toBe(1);
  expect(out).toBe('');
});
