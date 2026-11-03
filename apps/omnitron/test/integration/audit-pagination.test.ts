import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, type KyselyPlugin, type QueryId } from 'kysely';
import { AuditService, scrubDetails } from '../../src/services/audit.service.js';
import type { AuditQuery } from '../../src/shared/dto/audit.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const postgres = await requiresTestPostgres(
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test'
);
const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instant = (microseconds: string) => `2026-11-03T12:00:00.${microseconds}Z`;

describe('structured audit privacy', () => {
  it('redacts credentials through nested arrays while preserving diagnostic facts', () => {
    const details = {
      attempts: [{ node: 'worker-01', ok: false, elapsedMs: 125, context: [
        { password: 'private-one', authorization: 'private-two', resource: '/srv/project' },
        ['postgres://reader:private-three@db:5432/service', { api_key: 'private-four', count: 2 }],
      ] }],
      reason: 'connect refused', enabled: false, missing: null,
    };
    const output = scrubDetails(details);
    expect(output).toEqual({
      attempts: [{ node: 'worker-01', ok: false, elapsedMs: 125, context: [
        { password: '[redacted]', authorization: '[redacted]', resource: '/srv/project' },
        ['postgres://***@db:5432/service', { api_key: '[redacted]', count: 2 }],
      ] }], reason: 'connect refused', enabled: false, missing: null,
    });
    expect(JSON.stringify(output)).not.toMatch(/private-(?:one|two|three|four)/);
    expect(details.attempts[0]!.context[0]).toHaveProperty('password', 'private-one');
  });

  it('handles cycles and repeated references without inventing cycles for siblings', () => {
    const common = { node: 'console0', count: 3, credentials: 'private-shared' };
    const cycle: Record<string, unknown> = { ok: true };
    cycle['self'] = cycle;
    expect(scrubDetails({ rows: [common, common, cycle] })).toEqual({ rows: [
      { node: 'console0', count: 3, credentials: '[redacted]' },
      { node: 'console0', count: 3, credentials: '[redacted]' },
      { ok: true, self: '[circular]' },
    ] });
  });

  it('bounds depth, array length and total work without exposing later credential payloads', () => {
    let deep: unknown = { token: 'private-deep' };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    const output = scrubDetails({ deep, rows: Array.from({ length: 110 }, (_, n) => ({ n, secret: 'private-array' })) });
    expect(JSON.stringify(output)).toContain('[truncated]');
    expect(JSON.stringify(output)).not.toMatch(/private-(?:deep|array)/);
    expect((output?.['rows'] as unknown[]).length).toBeLessThanOrEqual(101);
  });
});

describe.skipIf(!postgres.ok)('audit keyset pagination on PostgreSQL', () => {
  let own: OwnDatabase, service: AuditService;
  beforeAll(async () => {
    own = await databaseOfItsOwn(postgres.url, `audit_pages_${process.pid}_${randomUUID().replaceAll('-', '')}`);
    service = new AuditService(logger, own.db);
  }, 60_000);
  beforeEach(async () => { await own.db.deleteFrom('omnitron_audit_log').execute(); });
  afterAll(async () => { await own?.drop(); });

  async function insert(n: number, timestamp: string, fields: {
    action?: string; actorId?: string | null; actorType?: string; resourceType?: string; details?: Record<string, unknown>;
  } = {}) {
    await own.db.insertInto('omnitron_audit_log').values({
      id: id(n), action: fields.action ?? 'stack.start', actorId: fields.actorId ?? 'operator-a',
      actorType: fields.actorType ?? 'user', resourceType: fields.resourceType ?? 'stack', resourceId: 'example/dev',
      createdAt: sql<Date>`${timestamp}::timestamptz`, details: fields.details ?? null,
    }).execute();
  }

  async function seedMicroseconds() {
    for (const [n, us] of [[1, '123001'], [7, '123002'], [3, '123002'], [5, '123003'],
      [2, '123003'], [9, '123004'], [4, '123004'], [8, '123005'], [6, '123005']] as const)
      await insert(n, instant(us));
  }

  async function pages(query: AuditQuery = {}) {
    const found: string[] = [];
    let beforeId: string | undefined;
    for (let page = 0; page < 30; page++) {
      const rows = await service.list({ ...query, limit: 2, ...(beforeId ? { beforeId } : {}) });
      if (!rows.length) return found;
      found.push(...rows.map(row => row.id));
      beforeId = rows.at(-1)!.id;
    }
    throw new Error('Pagination did not terminate');
  }

  it('visits all equal-timestamp entries once in deterministic descending ID order', async () => {
    for (const n of [2, 7, 1, 5, 3, 6, 4]) await insert(n, instant('123456'));
    const found = await pages();
    expect(found).toEqual([7, 6, 5, 4, 3, 2, 1].map(id));
    expect(new Set(found).size).toBe(found.length);
  });

  it('retains database microseconds even when every public ISO timestamp is the same millisecond', async () => {
    await seedMicroseconds();
    const rows = await service.list({ limit: 20 });
    expect(new Set(rows.map(row => row.createdAt)).size).toBe(1);
    const found = await pages();
    expect(found).toEqual([8, 6, 9, 4, 5, 2, 7, 3, 1].map(id));
    expect(new Set(found).size).toBe(9);
  });

  it('preserves the original traversal when newer or higher-ID tied rows arrive between pages', async () => {
    await seedMicroseconds();
    const first = await service.list({ limit: 2 });
    expect(first.map(row => row.id)).toEqual([8, 6].map(id));
    await insert(20, instant('123006'));
    await insert(21, instant('123005'));
    const found = [...first.map(row => row.id)];
    let cursor = first.at(-1)!.id;
    for (let page = 0; page < 10; page++) {
      const rows = await service.list({ limit: 2, beforeId: cursor });
      if (!rows.length) break;
      found.push(...rows.map(row => row.id)); cursor = rows.at(-1)!.id;
    }
    expect(found).toEqual([8, 6, 9, 4, 5, 2, 7, 3, 1].map(id));
    expect((await service.list({ limit: 2 })).map(row => row.id)).toEqual([20, 21].map(id));
  });

  it('applies actor, action and resource filters independently on every page', async () => {
    for (let n = 1; n <= 16; n++) await insert(n, instant('123456'), {
      actorType: n === 12 ? 'service' : 'user', actorId: n === 14 ? 'operator-b' : 'operator-a',
      resourceType: n === 16 ? 'node' : 'stack', action: n % 2 ? 'stack.stop' : 'stack.start',
    });
    const found = await pages({ action: 'stack.start', resourceType: 'stack', actorType: 'user', actorId: 'operator-a' });
    expect(found).toEqual([10, 8, 6, 4, 2].map(id));
    // A cursor is an ordering boundary, not an implicit replacement for filters.
    expect((await service.list({ beforeId: id(9), action: 'stack.start', actorId: 'operator-a' })).map(row => row.id)).toEqual([8, 6, 4, 2].map(id));
  });

  it('explicitly refuses a missing/deleted anchor instead of returning an apparently complete page', async () => {
    await seedMicroseconds();
    await expect(service.list({ beforeId: id(99) })).rejects.toThrow('cursor is no longer available');
    const first = await service.list({ limit: 2 });
    await own.db.deleteFrom('omnitron_audit_log').where('id', '=', first[1]!.id).execute();
    await expect(service.list({ beforeId: first[1]!.id })).rejects.toThrow('cursor is no longer available');
  });

  it('refuses conflicting/invalid cursor inputs without a SQL page query', async () => {
    let statements = 0;
    const counting = new AuditService(logger, own.db.withPlugin({
      transformQuery: args => { statements++; return args.node; },
      transformResult: async args => args.result,
    }));
    await expect(counting.list({ before: instant('123456'), beforeId: id(1) })).rejects.toThrow('Use before or beforeId');
    await expect(counting.list({ beforeId: 'not-a-uuid' })).rejects.toThrow('UUID');
    expect(statements).toBe(0);
  });

  it('reports an anchor removed after an empty page statement rather than silently ending history', async () => {
    await insert(1, instant('123456'));
    const pageQueries = new Set<QueryId>();
    let deleted = false;
    const plugin: KyselyPlugin = {
      transformQuery(args) {
        // The actual PostgreSQL page result is retained. Only timing is controlled:
        // another connection deletes the anchor before the follow-up existence probe.
        if (JSON.stringify(args.node).includes('cursor')) pageQueries.add(args.queryId);
        return args.node;
      },
      async transformResult(args) {
        if (!deleted && pageQueries.has(args.queryId)) {
          expect(args.result.rows).toEqual([]);
          deleted = true;
          await own.db.deleteFrom('omnitron_audit_log').where('id', '=', id(1)).execute();
        }
        return args.result;
      },
    };
    const concurrent = new AuditService(logger, own.db.withPlugin(plugin));
    await expect(concurrent.list({ beforeId: id(1) })).rejects.toThrow('cursor is no longer available');
    expect(deleted).toBe(true);
  });

  it('keeps a nonempty page whose anchor existed in the statement snapshot even if retention deletes it before delivery', async () => {
    await seedMicroseconds();
    const pageQueries = new Set<QueryId>();
    let deleted = false;
    const concurrent = new AuditService(logger, own.db.withPlugin({
      transformQuery(args) {
        if (JSON.stringify(args.node).includes('cursor')) pageQueries.add(args.queryId);
        return args.node;
      },
      async transformResult(args) {
        if (!deleted && pageQueries.has(args.queryId)) {
          expect(args.result.rows).toHaveLength(2);
          deleted = true;
          await own.db.deleteFrom('omnitron_audit_log').where('id', '=', id(6)).execute();
        }
        return args.result;
      },
    }));
    expect((await concurrent.list({ beforeId: id(6), limit: 2 })).map(row => row.id)).toEqual([9, 4].map(id));
    expect(deleted).toBe(true);
  });

  it('redacts legacy rows on read while leaving the stored historical JSON unchanged', async () => {
    const legacy = { attempts: [{ node: 'worker-01', credentials: { password: 'old-private' },
      messages: ['Bearer old-bearer', { token: 'old-token', total: 7 }] }], elapsedMs: 55 };
    await insert(1, instant('123456'), { details: legacy });
    const rawBefore = await own.db.selectFrom('omnitron_audit_log').select('details').where('id', '=', id(1)).executeTakeFirstOrThrow();
    const row = (await service.list())[0]!;
    expect(row.details).toEqual({ attempts: [{ node: 'worker-01', credentials: '[redacted]',
      messages: ['Bearer ***', { token: '[redacted]', total: 7 }] }], elapsedMs: 55 });
    expect(JSON.stringify(row)).not.toMatch(/old-(?:private|bearer|token)/);
    expect((await service.latestPerResource('stack.start'))[0]!.details).toEqual(row.details);
    const rawAfter = await own.db.selectFrom('omnitron_audit_log').select('details').where('id', '=', id(1)).executeTakeFirstOrThrow();
    expect(rawAfter).toEqual(rawBefore);
    expect(rawAfter.details).toEqual(legacy);
  });

  it('writes cyclic nested details safely and keeps non-secret structured facts in PostgreSQL', async () => {
    const loop: Record<string, unknown> = { node: 'console0', privateKey: 'new-private', retries: 2 };
    loop['self'] = loop;
    await service.record({ action: 'node.configure', resourceType: 'node', details: { changes: [loop], ok: true } }, true);
    const raw = await own.db.selectFrom('omnitron_audit_log').select('details').executeTakeFirstOrThrow();
    expect(raw.details).toEqual({ changes: [{ node: 'console0', privateKey: '[redacted]', retries: 2, self: '[circular]' }], ok: true });
    expect((await service.list())[0]!.details).toEqual(raw.details);
  });
});
