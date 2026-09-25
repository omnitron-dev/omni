/**
 * A conflict the server kept to itself.
 *
 * The HTTP server records a refusal without request logging only for 401, 403,
 * 404 and 429; everything else below 500 was «the caller's own business». A
 * database refusal is not: `toTitanError` turns SQLSTATE 23 into 409
 * `DATABASE_CONSTRAINT` and SQLSTATE 22 into 400 `DATABASE_INPUT`, statuses
 * that read like the caller's mistake while what raised them is the server's
 * own invariant. On daos/test (2026-09-25) a new user's first page got
 * DATABASE_CONSTRAINT from a race in messaging's identity creation — two
 * concurrent requests, one unique index — and messaging's log had no line
 * about it (found by omni-be).
 *
 * Held here: a database refusal is witnessed with its code and its cause (the
 * constraint), on both copies of the logging decision; a business 409 and a
 * validation 400 stay quiet, as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { HttpServer, isWitnessedRefusal } from '../../src/netron/transport/http/server.js';
import { Definition } from '../../src/netron/definition.js';
import { contract } from '../../src/validation/contract.js';
import { createMockLogger } from './test-utils.js';
import { nextTestPort } from '../utils/index.js';

const SERVER = readFileSync(new URL('../../src/netron/transport/http/server.ts', import.meta.url), 'utf8');

describe('which refusals are witnessed', () => {
  it('the four statuses, and anything the database refused', () => {
    for (const status of [401, 403, 404, 429]) expect(isWitnessedRefusal(status, String(status))).toBe(true);
    expect(isWitnessedRefusal(409, 'DATABASE_CONSTRAINT')).toBe(true);
    expect(isWitnessedRefusal(400, 'DATABASE_INPUT')).toBe(true);
  });

  it('not a business conflict, nor a validation error — those are the caller’s', () => {
    expect(isWitnessedRefusal(409, 'ALREADY_PINNED')).toBe(false);
    expect(isWitnessedRefusal(400, 'VALIDATION_ERROR')).toBe(false);
    expect(isWitnessedRefusal(409, undefined)).toBe(false);
  });

  it('both copies of the logging decision ask the same question', () => {
    // The fast path and the full path log the same way, written twice; a rule
    // changed in one of them is how they came to differ before.
    expect(SERVER.match(/isWitnessedRefusal\(httpError\.status, errorCode\)/g)?.length).toBe(2);
    expect(SERVER).not.toMatch(/WITNESSED_REFUSALS\.has\(httpError\.status\)/);
  });
});

describe('a unique violation answered over HTTP', () => {
  let server: HttpServer | undefined;

  afterEach(async () => {
    await server?.close?.();
    server = undefined;
  });

  it('is logged with its code and the constraint, not only answered', async () => {
    const port = nextTestPort();
    server = new HttpServer({ port, host: 'localhost' } as any);
    const logger = createMockLogger();
    const driver = Object.assign(new Error('duplicate key value violates unique constraint "idx_identities_user_id"'), {
      code: '23505',
      severity: 'ERROR',
    });
    const instance = { upsert: vi.fn(async () => Promise.reject(driver)) };
    const def = new Definition('svc-id', 'peer-id', {
      name: 'Identity',
      version: '1.0.0',
      description: 'Identity',
      contract: contract({ upsert: { input: z.any(), output: z.any() } }),
      methods: { upsert: { description: 'get or create' } },
      properties: {},
    });
    const stub: any = { definition: def, instance, call: vi.fn(async () => instance.upsert()) };
    server.setPeer({
      stubs: new Map([['svc-id', stub]]),
      netron: { id: 'test-netron' },
      logger,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as any);
    await server.listen();

    const res = await fetch(`http://localhost:${port}/netron/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'r1', service: 'Identity@1.0.0', method: 'upsert', input: {}, timestamp: Date.now() }),
    });
    const body = (await res.json()) as { error?: { code?: string } };

    expect(res.status).toBe(409);
    expect(body.error?.code).toBe('DATABASE_CONSTRAINT');
    const warned = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.filter(([, msg]) => msg === 'Netron error');
    expect(warned).toHaveLength(1);
    expect(warned[0]![0]).toMatchObject({ status: 409, errorCode: 'DATABASE_CONSTRAINT' });
    expect(String(warned[0]![0].cause)).toContain('idx_identities_user_id');
  });
});
