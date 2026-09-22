/**
 * A refusal nobody wrote down.
 *
 * `HttpServer` logged a 5xx as `error` and everything below it only when
 * `options.logging` was on. That flag means «request/response logging» and
 * defaults to FALSE — no daos app sets it — so a refused call left no record
 * anywhere.
 *
 * Measured on the dev stand 2026-09-22, before this: `POST :3001/netron/invoke`
 * for `{"service":"Auth","method":"zzz_nonexistent"}` answered 404 with
 * `Method zzz_nonexistent not found in service Auth`, and the app's log grew
 * by **zero bytes** — no entry, no trace of the probe's id. On a closed
 * platform that is the wrong half to lose: «who was refused and for what» is
 * the part worth keeping, and «who was served» is the part that would drown
 * it. It also made an absence unreadable — a refusal that leaves no trace is
 * indistinguishable from a request that never arrived, and we spent an
 * evening mistaking one for the other elsewhere.
 *
 * So four statuses are now recorded whatever `logging` says: 401 and 403 (the
 * security record), 404 (someone mapping the surface), 429 (a budget nobody
 * can see engaging reads like a budget that never engages). Everything else
 * below 500 stays behind the flag: a form's validation error is the caller's
 * own business and travels in their response.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod';

import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import type { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import { contract } from '../../../../src/validation/contract.js';
import { nextTestPort } from '../../../utils/index.js';

describe('a refusal nothing wrote down', () => {
  let server: HttpServer;
  let baseUrl: string;
  const warn = vi.fn();
  const error = vi.fn();

  function setup() {
    warn.mockClear();
    error.mockClear();

    const port = nextTestPort();
    baseUrl = `http://localhost:${port}`;
    // `logging` deliberately left unset — this is the default every app runs.
    server = new HttpServer({ port, host: 'localhost' });

    const mockPeer = {
      stubs: new Map(),
      netron: {},
      logger: { warn, error, info: vi.fn(), debug: vi.fn() },
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as LocalPeer;

    const def = new Definition('svc-id', 'peer-id', {
      name: 'Vault',
      version: '1.0.0',
      description: 'Vault',
      contract: contract({ ping: { input: z.object({}).passthrough(), output: z.any() } }),
      methods: { ping: { description: 'ping' } },
      properties: {},
    });
    (mockPeer as unknown as { stubs: Map<string, unknown> }).stubs.set('svc-id', {
      definition: def,
      call: vi.fn(async () => ({ ok: true })),
    });

    server.setPeer(mockPeer);
    return server;
  }

  async function invoke(body: unknown) {
    const r = await fetch(`${baseUrl}/netron/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }

  afterEach(async () => {
    if (server) await server.close();
  });

  it('records a method that does not exist, with logging off', async () => {
    await setup().listen();

    const r = await invoke({
      id: 'probe-404',
      version: '1.0',
      service: 'Vault@1.0.0',
      method: 'zzz_nonexistent',
      input: {},
      timestamp: Date.now(),
    });

    expect(r.status).toBe(404);
    expect(warn).toHaveBeenCalled();
    // The record has to name what was asked for, or it cannot be read later.
    const fields = JSON.stringify(warn.mock.calls);
    expect(fields).toContain('zzz_nonexistent');
  });

  it('records a service that does not exist', async () => {
    await setup().listen();

    const r = await invoke({
      id: 'probe-svc',
      version: '1.0',
      service: 'NoSuchService@1.0.0',
      method: 'ping',
      input: {},
      timestamp: Date.now(),
    });

    expect(r.status).toBe(404);
    expect(warn).toHaveBeenCalled();
  });

  it('still leaves an ordinary validation refusal to the flag', async () => {
    // The control in the other direction: turning every 4xx into a log line
    // would drown the four that matter. A bad shape answers the caller and
    // says nothing to the log while `logging` is off.
    await setup().listen();

    const r = await invoke({ id: 'probe-400', version: '1.0', timestamp: Date.now() });

    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect(warn).not.toHaveBeenCalled();
  });
});
