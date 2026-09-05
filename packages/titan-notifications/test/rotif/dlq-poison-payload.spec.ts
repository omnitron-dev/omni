import { Redis } from 'ioredis';
import { delay } from '@omnitron-dev/common';

import { NotificationManager } from '../../src/rotif/rotif.js';
import type { RotifMessage } from '../../src/rotif/rotif.js';
import { getTestRedisConfig, isRedisInMockMode } from './helpers/test-utils.js';

const skipTests = isRedisInMockMode();
if (skipTests) {
  console.log('⏭️ Skipping dlq-poison-payload.spec.ts - requires real Redis');
}
const describeOrSkip = skipTests ? describe.skip : describe;

/**
 * The DLQ consumer must survive a payload it cannot parse.
 *
 * This is not a hypothetical input. `move-to-dlq.lua` writes ARGV[4] — the
 * verbatim `payloadStr` — into the DLQ entry's `payload` field, and the main
 * consumer loop routes a message there precisely BECAUSE `JSON.parse` rejected
 * it ("Move unparseable message to DLQ instead of silently acknowledging").
 * So the guarded half of the code deliberately feeds unparseable payloads to
 * the DLQ stream, and the DLQ subscriber is the half that has to read them.
 */
describeOrSkip('NotificationManager - DLQ poison payload', () => {
  const dlqKey = 'rotif:dlq:poison-payload-spec';
  let manager: NotificationManager;
  let raw: Redis;

  beforeAll(async () => {
    const config = getTestRedisConfig(1);
    raw = new Redis({ host: config.host, port: config.port, db: config.db });
    await raw.del(dlqKey);

    // One poison entry, then a well-formed one. A single `xreadgroup` with
    // COUNT 1000 returns both in the same batch, so the second entry's fate is
    // decided by what the first one does to the loop. Seeded here rather than
    // in the first test so that neither test depends on the other having run.
    await raw.xadd(dlqKey, '*', 'channel', 'orders.created', 'payload', '{"broken', 'error', 'Unexpected end of JSON input', 'timestamp', '1', 'attempt', '3');
    await raw.xadd(dlqKey, '*', 'channel', 'orders.created', 'payload', '{"ok":true}', 'error', 'handler threw', 'timestamp', '2', 'attempt', '3');

    manager = new NotificationManager({
      redis: { host: config.host, port: config.port, db: config.db },
      blockInterval: 100,
      dlqKey,
    });
    await manager.waitUntilReady();
  });

  afterAll(async () => {
    await manager.stopAll();
    await raw.del(dlqKey);
    await raw.quit();
  });

  it('delivers the entries that follow an unparseable one instead of dropping the batch', async () => {
    const seen: RotifMessage[] = [];
    await manager.subscribeToDLQ(async (msg) => {
      seen.push(msg);
    });

    const deadline = Date.now() + 10_000;
    while (seen.length < 2 && Date.now() < deadline) {
      await delay(100);
    }

    // Before the fix `JSON.parse` threw out of the per-record loop, past the
    // per-message try (which wraps only the handler call), into the stream-level
    // catch. That logs "[DLQ] Processing error", sleeps 500ms and re-reads with
    // '>', which never returns entries already moved to the PEL — so the poison
    // entry AND every entry behind it in its batch were silently lost from the
    // one surface whose job is to not lose things.
    const channels = seen.map((m) => m.channel);
    expect(channels).toEqual(['orders.created', 'orders.created']);

    // The unparseable entry is still delivered: the DLQ handler is the operator's
    // view of what failed, and "it did not arrive" is the wrong way to report a
    // message whose defect is exactly that its body is malformed.
    expect(seen[0]!.payload).toBe('{"broken');
    expect(seen[1]!.payload).toEqual({ ok: true });
  }, 30_000);

  it('lists the unparseable entry with its raw body rather than as an empty object', async () => {
    // The DLQ listing is the operator's read-only view of the same stream.
    // It already guarded the parse — but defaulted to `{}`, reporting "empty
    // body" for a message whose defect is that its body is malformed.
    const messages = await manager.getDLQMessages({ limit: 10 });
    const poison = messages.find((m) => m.error === 'Unexpected end of JSON input');

    expect(poison).toBeDefined();
    expect(poison!.payload).toBe('{"broken');
  }, 30_000);
});
