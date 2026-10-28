import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  stream: vi.fn(async () => [
    {
      timestamp: new Date(),
      app: 'sample/prod/mail',
      level: 'warn',
      message: 'mail.delivery retrying',
      nodeId: 'remote-id',
      metadata: { deliveryId: 'opaque-id' },
    },
  ]),
  inspect: vi.fn(),
  json: vi.fn(() => true),
  error: vi.fn(),
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    whyUnreachable: async () => null,
    inspect: state.inspect,
    service: async (name: string) =>
      name === 'OmnitronNodes'
        ? { listNodes: async () => [{ id: 'remote-id', name: 'worker-1', host: 'example.test' }] }
        : { streamLogs: state.stream },
    disconnect: async () => {},
  }),
}));
vi.mock('../../src/commands/output.js', () => ({
  emitJson: state.json,
  emitError: state.error,
  isJsonMode: () => false,
}));
import { logsCommand } from '../../src/commands/logs.js';

afterEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
});
describe('explicit node log scope', () => {
  it('uses Console RPC with the registry ID, never a local app capture', async () => {
    await logsCommand('sample/prod/mail', { node: 'worker-1', level: 'warn' });
    expect(state.inspect).not.toHaveBeenCalled();
    expect(state.stream).toHaveBeenCalledWith({
      app: 'sample/prod/mail',
      nodeId: 'remote-id',
      level: ['warn', 'error', 'fatal'],
      tail: 50,
    });
    expect(state.json).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'stored',
        count: 1,
        nodes: [{ id: 'remote-id', name: 'worker-1' }],
        entries: [expect.objectContaining({ data: { deliveryId: 'opaque-id', sourceNode: 'remote-id' } })],
      })
    );
  });
  it('fails closed for an unknown node and a local-file override', async () => {
    await logsCommand('sample/prod/mail', { node: 'missing' });
    expect(state.error).toHaveBeenCalled();
    expect(state.stream).not.toHaveBeenCalled();
    await logsCommand('sample/prod/mail', { node: 'worker-1', file: true });
    expect(state.stream).not.toHaveBeenCalled();
  });
});
