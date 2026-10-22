import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request as httpRequest, type Server as NodeServer } from 'node:http';
import { Netron } from '../../../../src/netron/netron.js';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { Service, Public } from '../../../../src/decorators/core.js';
import { createNullLogger } from '../../../../src/types/logger.js';

let invocations = 0;
@Service({ name: 'BodyBoundary' })
class BodyBoundary {
  @Public({ auth: false })
  current() {
    return ++invocations;
  }
}
let netron: Netron, server: HttpServer, endpoint: string;
beforeAll(async () => {
  netron = new Netron(createNullLogger());
  await netron.start();
  await netron.peer.exposeService(new BodyBoundary());
  server = new HttpServer({ host: '127.0.0.1', port: 0, maxRequestSize: 1024 });
  server.setPeer(netron.peer);
  await server.listen();
  endpoint = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server?.close();
  await netron?.stop();
});
const message = (input: unknown[] = []) =>
  JSON.stringify({ id: 'body-test', service: 'BodyBoundary', method: 'current', input });
async function healthy() {
  const response = await fetch(endpoint + '/netron/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: message(),
  });
  expect(response.status).toBe(200);
  expect((await response.json()).success).toBe(true);
}
function nativeRequest(headers: Record<string, string>, write: (req: ReturnType<typeof httpRequest>) => void) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpRequest(
      endpoint + '/netron/invoke',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Request-ID': 'body-test', ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) });
          req.destroy();
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Body boundary did not respond'));
    });
    write(req);
  });
}

describe('real Node HTTP request body admission', () => {
  it('returns 413 for an oversized Content-Length without terminating the process or invoking a service', async () => {
    const before = invocations;
    const response = await fetch(endpoint + '/netron/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Request-ID': 'body-test' },
      body: message(['x'.repeat(2048)]),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((await response.json()).error.code).toBe('413');
    expect(invocations).toBe(before);
    await healthy();
  });
  it('refuses a declared oversize before the sender uploads its body', async () => {
    const before = invocations;
    const response = await nativeRequest({ 'content-length': '1048576' }, (req) => req.flushHeaders());
    expect(response.status).toBe(413);
    expect(invocations).toBe(before);
    await healthy();
  });
  it('enforces the same bound on chunked bodies and leaves subsequent connections operational', async () => {
    const before = invocations;
    const response = await nativeRequest({ 'transfer-encoding': 'chunked' }, (req) => {
      const body = message(['x'.repeat(2048)]);
      req.write(body.slice(0, 700));
      req.write(body.slice(700, 1400));
      req.end(body.slice(1400));
    });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('413');
    expect(invocations).toBe(before);
    await healthy();
  });
  it('settles a client-aborted upload without an unhandled listener rejection', async () => {
    const before = invocations;
    await new Promise<void>((resolve) => {
      const req = httpRequest(endpoint + '/netron/invoke', {
        method: 'POST',
        headers: { 'content-length': '1000' },
      });
      req.on('error', () => {});
      req.on('close', resolve);
      req.write('partial');
      setTimeout(() => req.destroy(), 20);
    });
    expect(invocations).toBe(before);
    await healthy();
  });
  it('cancels an upstream body returned after its HTTP client has already disconnected', async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cancelled = 0;
    const late = new HttpServer({
      host: '127.0.0.1',
      port: 0,
      customRoutes: [
        async () => {
          enter();
          await ready;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
              },
              cancel() {
                cancelled++;
              },
            })
          );
        },
      ],
    });
    await late.listen();
    // Observe the real server-side close, not a timing assumption based on the
    // client's local socket. The handler cannot return its body until then.
    const node = Reflect.get(late, 'server') as NodeServer;
    const closed = new Promise<void>((resolve) => {
      node.once('request', (_request, response) => response.once('close', () => resolve()));
    });
    const req = httpRequest(`http://127.0.0.1:${late.port}/late-body`);
    req.on('error', () => {});
    try {
      req.end();
      await entered;
      req.destroy();
      await closed;
      release();
      await expect.poll(() => cancelled, { timeout: 2000 }).toBe(1);
      await healthy();
    } finally {
      release();
      req.destroy();
      await late.close();
    }
  });
});
