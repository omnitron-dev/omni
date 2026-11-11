import type { IncomingMessage, ServerResponse } from 'node:http';
import { LumenMcpServer } from './mcp-server.js';

export async function handleHttpMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  mcpServer: LumenMcpServer
): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  });

  req.on('end', async () => {
    try {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const json = JSON.parse(rawBody);
      const rpcResponse = await mcpServer.handleRequest(json);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(rpcResponse));
    } catch (err: any) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error', data: err?.message },
        })
      );
    }
  });
}
