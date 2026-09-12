/**
 * A declared input contract that cannot be evaluated must deny the request.
 *
 * `validateMethodInput` had four branches that returned the input unchecked.
 * Two of them are fine — no contract, or a contract with no input schema —
 * because nothing was promised. The other two were labelled "DEFENSIVE" and
 * were the opposite:
 *
 *   - `contract.input` present but not a Zod schema: warn, skip validation;
 *   - `safeParse` threw: log "possible contract lifecycle race condition.
 *     Allowing request without validation.", skip validation.
 *
 * The second is reachable from the wire. Measured on the zod this package
 * depends on (4.5.4), an exception thrown inside a `.refine()` callback
 * propagates out of `safeParse` instead of becoming a failed result:
 *
 *     schema.safeParse({ n: 'ok' })    -> { success: true }
 *     schema.safeParse({ n: 'boom' })  -> throws
 *
 * Refinements that call `JSON.parse`, `new URL` or `BigInt` are ordinary
 * things to write, and every one of them hands the caller a way to choose
 * which requests get validated. The handler then ran on the raw input.
 *
 * These drive the real dispatch path — a real server, a real port, a real
 * contract — and assert on the one thing that matters: the service method is
 * never reached.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import { contract } from '../../../../src/validation/contract.js';
import type { HttpRequestMessage } from '../../../../src/netron/transport/http/types.js';
import { nextTestPort } from '../../../utils/index.js';

/** A schema whose refinement throws for one particular value. */
const explosive = z
  .object({ n: z.string() })
  .refine((v) => {
    if (v.n === 'boom') throw new Error('refinement blew up');
    return true;
  });

describe('a validator that throws is not a pass', () => {
  let server: HttpServer;
  let baseUrl: string;
  let call: ReturnType<typeof vi.fn>;
  let logged: Array<[unknown, string]>;

  /** @param inputSchema what the contract declares for `store` */
  async function setupServer(inputSchema: unknown) {
    const port = nextTestPort();
    baseUrl = `http://localhost:${port}`;
    server = new HttpServer({ port, host: 'localhost' });

    call = vi.fn(async () => ({ stored: true }));
    logged = [];

    const c = contract({ store: { input: z.any(), output: z.any() } });
    // Poke the real schema in afterwards: `contract()` validates its argument,
    // and the non-schema case has to survive that.
    (c as any).definition.store.input = inputSchema;

    const def = new Definition('svc-id', 'peer-id', {
      name: 'Vault',
      version: '1.0.0',
      description: 'Vault',
      contract: c,
      methods: { store: { description: 'store' } },
      properties: {},
    });

    const peer = {
      stubs: new Map([['svc-id', { definition: def, call }]]),
      netron: {},
      logger: {
        warn: (o: unknown, m: string) => logged.push([o, m]),
        error: (o: unknown, m: string) => logged.push([o, m]),
        debug: () => {},
        info: () => {},
        child: () => peer.logger,
      },
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as LocalPeer;

    server.setPeer(peer);
    await server.listen();
  }

  async function store(input: unknown): Promise<{ status: number; body: any }> {
    const req: HttpRequestMessage = {
      id: 'r1',
      service: 'Vault@1.0.0',
      method: 'store',
      input,
      timestamp: Date.now(),
    };
    const r = await fetch(`${baseUrl}/netron/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return { status: r.status, body: await r.json() };
  }

  afterEach(async () => {
    if (server) await server.close();
  });

  it('still lets a valid payload through', async () => {
    await setupServer(explosive);

    const r = await store({ n: 'ok' });

    expect(r.body.success).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('still rejects a payload the schema merely fails', async () => {
    await setupServer(explosive);

    const r = await store({ n: 42 });

    expect(r.body.success).toBe(false);
    expect(call, 'the handler ran on input the contract rejected').not.toHaveBeenCalled();
  });

  it('refuses the request when the validator throws, instead of skipping the check', async () => {
    await setupServer(explosive);

    const r = await store({ n: 'boom' });

    expect(call, 'the handler ran on unvalidated input').not.toHaveBeenCalled();
    expect(r.body.success).toBe(false);
  });

  it('tells the client nothing about why the validator failed', async () => {
    await setupServer(explosive);

    const r = await store({ n: 'boom' });

    const wire = JSON.stringify(r.body);
    expect(wire, 'the refinement error reached the client').not.toContain('refinement blew up');
    expect(wire).not.toContain('ZodObject');
  });

  it('records the cause in the log, where an operator can reach it', async () => {
    await setupServer(explosive);

    await store({ n: 'boom' });

    const messages = logged.map(([, m]) => m).join('\n');
    expect(messages).toMatch(/Contract validation threw/);
  });

  it('refuses when the contract declares an input that is not a schema', async () => {
    // A contract built wrong, or swapped mid-flight. It used to warn and run
    // the handler anyway.
    await setupServer({ notASchema: true });

    const r = await store({ anything: 'at all' });

    expect(call, 'the handler ran with no validation available').not.toHaveBeenCalled();
    expect(r.body.success).toBe(false);
  });

  it('leaves a method with no declared input alone', async () => {
    // Nothing was promised here, so nothing is being skipped: this branch must
    // keep passing the input straight through.
    await setupServer(undefined);

    const r = await store({ free: 'form' });

    expect(r.body.success).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
