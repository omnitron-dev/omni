/**
 * `/netron/batch` executed handlers with no middleware at all.
 *
 * `handleBatchRequest` called `method.handler(...)` directly, in both its
 * parallel and its sequential branch. No pipeline meant no
 * `NetronAuthMiddleware`, so any method gated only by its decorator —
 * which is what an admin endpoint is — ran for whoever could reach the
 * port.
 *
 * Verified against a live deployment before the fix: an unauthenticated
 * POST to `/api/main/netron/batch` through the public gateway returned a
 * marketplace backend's full admin shop listing, while the identical
 * call to `/netron/invoke` answered 401.
 *
 * The single-invoke path had already been fixed once for this class of
 * bug — T#35, a fast-path predicate that skipped the pipeline — and the
 * batch path was never brought along. This pins them together: whatever
 * middleware sees on one, it must see on the other.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Netron } from '../../../../src/netron/netron.js';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { Service, Public } from '../../../../src/decorators/core.js';
import { createMockLogger } from '../../test-utils.js';
import { nextTestPort } from '../../../utils/index.js';
import { MiddlewareStage } from '../../../../src/netron/transport/http/middleware/index.js';

@Service('gated@1.0.0')
class GatedService {
  @Public()
  secret(): string {
    return 'the-goods';
  }
}

describe('batch invocations run the middleware pipeline', () => {
  let server: Netron;
  let url: string;
  const seen: Array<{ stage: string; method: string }> = [];

  beforeAll(async () => {
    const port = nextTestPort();
    url = `http://localhost:${port}`;
    server = new Netron(createMockLogger(), { id: 'batch-pipeline-server' });
    server.registerTransport('http', () => new HttpTransport());
    server.registerTransportServer('http', { name: 'http', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new GatedService());

    // Stand in for NetronAuthMiddleware: record every invocation it is
    // given a chance to see, and refuse the ones marked forbidden.
    const httpServer = (server as any).transportServers?.get('http') ?? (server as any).httpServer;
    const pipeline = httpServer?.globalPipeline ?? (httpServer as any)?.['globalPipeline'];
    pipeline.use(
      async (ctx: any, next: () => Promise<void>) => {
        seen.push({ stage: 'PRE_INVOKE', method: ctx.methodName });
        if (ctx.metadata.get('x-refuse') === 'yes') {
          const err: any = new Error('Refused by middleware');
          err.code = 'FORBIDDEN';
          throw err;
        }
        await next();
      },
      { name: 'test-gate' },
      MiddlewareStage.PRE_INVOKE,
    );
  });

  afterAll(async () => {
    await server?.stop();
  });

  async function post(path: string, payload: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    return res.json() as Promise<any>;
  }

  const batch = (parallel: boolean) => ({
    id: crypto.randomUUID(),
    options: { parallel },
    requests: [{ id: 'r1', service: 'gated@1.0.0', method: 'secret', input: {} }],
  });

  it('the control: middleware sees a single invoke', async () => {
    seen.length = 0;
    const r = await post('/netron/invoke', {
      id: crypto.randomUUID(),
      service: 'gated@1.0.0',
      method: 'secret',
      input: {},
    });
    expect(r.success).toBe(true);
    expect(seen.map((s) => s.method)).toEqual(['secret']);
  });

  it('middleware sees a parallel batch too', async () => {
    seen.length = 0;
    const r = await post('/netron/batch', batch(true));
    expect(r.responses[0].success).toBe(true);
    expect(seen.map((s) => s.method), 'a batched call must not skip the pipeline').toEqual(['secret']);
  });

  it('middleware sees a sequential batch too', async () => {
    seen.length = 0;
    const r = await post('/netron/batch', batch(false));
    expect(r.responses[0].success).toBe(true);
    expect(seen.map((s) => s.method)).toEqual(['secret']);
  });

  it('a refusal in middleware stops a parallel batched call', async () => {
    const r = await post('/netron/batch', batch(true), { 'x-refuse': 'yes' });
    expect(r.responses[0].success, 'the handler must not have run').toBe(false);
    expect(r.responses[0].data).toBeUndefined();
  });

  it('a refusal in middleware stops a sequential batched call', async () => {
    const r = await post('/netron/batch', batch(false), { 'x-refuse': 'yes' });
    expect(r.responses[0].success).toBe(false);
    expect(r.responses[0].data).toBeUndefined();
  });
});
