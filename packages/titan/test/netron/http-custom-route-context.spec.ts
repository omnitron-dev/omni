import { describe, it, expect } from 'vitest';
import { HttpServer } from '../../src/netron/transport/http/server.js';

describe('native HTTP protocol adapter connection context', () => {
  const server = () => new HttpServer({ host: '127.0.0.1', port: 0, cors: false, customRoutes: [async (_request, context) =>
    Response.json({ remoteAddress: context.remoteAddress, immutable: Object.isFrozen(context) })] });

  it('preserves the host-supplied address independently of caller headers', async () => {
    const http = server();
    try {
      const response = await http.handleRequest(new Request('http://localhost/adapter', {
        headers: { 'x-forwarded-for': '203.0.113.99', 'x-remote-address': '203.0.113.98' },
      }), '192.0.2.20');
      expect(await response.json()).toEqual({ remoteAddress: '192.0.2.20', immutable: true });
    } finally { await http.close(); }
  });

  it('passes the actual Node socket address to a mounted adapter', async () => {
    const http = server();
    await http.listen();
    try {
      const response = await fetch(`http://127.0.0.1:${http.port}/adapter`, {
        headers: { 'x-forwarded-for': '203.0.113.99' },
      });
      expect(await response.json()).toEqual({ remoteAddress: '127.0.0.1', immutable: true });
    } finally { await http.close(); }
  });
});
