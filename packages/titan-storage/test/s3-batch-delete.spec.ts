/**
 * `DeleteObjects` takes a thousand keys. This sent as many as it was given.
 *
 * S3's batch delete caps at 1 000 keys per request and answers a longer list
 * with `MalformedXML` — the request fails whole, so the surplus is not the
 * part that is lost, everything is. The callers are folder deletes and folder
 * renames, where the key count is the number of files a person put in a
 * folder, and none of the seven call sites knew about the limit.
 *
 * The limit is a fact about the API, so the adapter answers it.
 */
import { describe, it, expect } from 'vitest';

import { S3Adapter } from '../src/s3.adapter.js';

interface Sent {
  keys: string[];
}

/** An S3 client that records the commands it is sent and answers success. */
function fakeClient() {
  const sent: Sent[] = [];
  return {
    sent,
    async send(command: { input: Record<string, unknown> }) {
      const del = (command.input as { Delete?: { Objects?: Array<{ Key: string }> } }).Delete;
      const objects = del?.Objects ?? [];
      sent.push({ keys: objects.map((o) => o.Key) });
      return { Deleted: objects.map((o) => ({ Key: o.Key })), Errors: [] };
    },
  };
}

function adapterWith(client: { send(command: { input: Record<string, unknown> }): Promise<unknown> }) {
  const adapter = new S3Adapter(
    {} as never,
    { logger: { debug() {}, info() {}, warn() {}, error() {} } } as never,
  );
  Object.assign(adapter as unknown as Record<string, unknown>, { client, bucket: 'test-bucket' });
  return adapter;
}

const keys = (n: number): string[] => Array.from({ length: n }, (_, i) => `bucket/file-${i}`);

describe('deleteMany respects the API ceiling', () => {
  it('splits 2 500 keys into three requests', async () => {
    const client = fakeClient();
    const adapter = adapterWith(client);

    const result = await adapter.deleteMany(keys(2_500));

    expect(client.sent).toHaveLength(3);
    expect(client.sent.map((c) => c.keys.length)).toEqual([1_000, 1_000, 500]);
    expect(result.deleted).toHaveLength(2_500);
    expect(new Set(result.deleted).size).toBe(2_500);
  });

  it('never puts more than a thousand keys in one request', async () => {
    const client = fakeClient();
    const adapter = adapterWith(client);

    await adapter.deleteMany(keys(4_321));

    expect(Math.max(...client.sent.map((c) => c.keys.length))).toBeLessThanOrEqual(1_000);
    expect(client.sent.reduce((a, c) => a + c.keys.length, 0)).toBe(4_321);
  });

  it('sends exactly one request at the ceiling', async () => {
    const client = fakeClient();
    const adapter = adapterWith(client);

    await adapter.deleteMany(keys(1_000));

    expect(client.sent).toHaveLength(1);
  });

  it('sends nothing at all for an empty list', async () => {
    const client = fakeClient();
    const adapter = adapterWith(client);

    const result = await adapter.deleteMany([]);

    expect(client.sent).toHaveLength(0);
    expect(result).toEqual({ deleted: [], errors: [] });
  });

  it('accumulates per-key errors across chunks', async () => {
    const sent: Sent[] = [];
    const failing = {
      async send(command: { input: Record<string, unknown> }) {
        const objects = (command.input as { Delete: { Objects: Array<{ Key: string }> } }).Delete.Objects;
        sent.push({ keys: objects.map((o) => o.Key) });
        return {
          Deleted: objects.slice(1).map((o) => ({ Key: o.Key })),
          Errors: [{ Key: objects[0]!.Key, Message: 'AccessDenied' }],
        };
      },
    };
    const adapter = adapterWith(failing);

    const result = await adapter.deleteMany(keys(2_001));

    // One failure per chunk, and all three reported — not only the last.
    expect(sent).toHaveLength(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.every((e) => e.error === 'AccessDenied')).toBe(true);
    expect(result.deleted).toHaveLength(2_001 - 3);
  });
});
