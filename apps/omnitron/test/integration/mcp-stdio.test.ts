import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { expect, it, vi } from 'vitest';
import { CLI_VERSION } from '../../src/config/defaults.js';
import { McpBridge } from '../../src/mcp/mcp-bridge.js';

it('negotiates the installed server, validates calls and cancels one request while another completes', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const client = new Client({ name: 'stdio-consumer', version: '1' });
  const bridge = new McpBridge(input, output);
  const read = vi.fn(async ({ name }) => name);
  let entered!: () => void, receivedAbort!: () => void;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const stopped = new Promise<void>(resolve => { receivedAbort = resolve; });
  bridge.registerTools([
    { name: 'project.read', description: 'Read a project', handler: read,
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'project.watch', description: 'Wait for a project event', inputSchema: { type: 'object' },
      handler: async (_args, signal) => {
        if (!signal) throw Error('Missing cancellation signal');
        signal.addEventListener('abort', receivedAbort, { once: true });
        entered();
        await stopped;
        signal.throwIfAborted();
      } },
  ]);
  const running = bridge.start();
  const controller = new AbortController();
  try {
    await client.connect(new StdioServerTransport(output, input));
    expect(client.getServerVersion()).toMatchObject({ name: 'omnitron', version: CLI_VERSION });
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['project.read', 'project.watch']);
    const invalid = await client.callTool({ name: 'project.read', arguments: { name: 1 } })
      .then(result => result.isError, error => /Invalid arguments/.test(String(error)));
    expect(invalid).toBe(true);
    expect(read).not.toHaveBeenCalled();
    const watching = client.callTool({ name: 'project.watch' }, { signal: controller.signal });
    const interrupted = expect(watching).rejects.toThrow();
    await active;
    const reply = await client.callTool({ name: 'project.read', arguments: { name: 'example' } });
    expect(reply.content).toEqual([{ type: 'text', text: 'example' }]);
    controller.abort();
    await Promise.all([interrupted, stopped]);
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    controller.abort();
    await client.close();
    input.end();
    try { await running; } finally { input.destroy(); output.destroy(); }
  }
});
