/**
 * @Idempotent must key on something that identifies the call.
 *
 * `const key = args[0]?.[options.key] || options.key` fell back to the OPTION
 * NAME — a constant — whenever the argument did not carry the field. Every
 * such call then shared one cache entry for the TTL (default one hour), so the
 * first caller's result was returned to every caller after it. The decorator
 * turned from a no-op into a wrong answer.
 *
 * `parseDuration` returns 0 for anything it cannot parse, and 'ms' is exactly
 * the unit a caller reaches for first — a typo in `ttl` silently disabled the
 * whole decorator.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { Idempotent } from '../../src/decorators.js';

describe('@Idempotent with no key in the argument', () => {
  it('does not hand one caller the answer to another caller`s question', async () => {
    const seen: string[] = [];

    class Payments {
      @Idempotent({ key: 'requestId', ttl: '1h' })
      async charge(req: { amount: number }) {
        seen.push(`charge:${req.amount}`);
        return { charged: req.amount };
      }
    }

    const p = new Payments();
    const a = await p.charge({ amount: 10 });
    const b = await p.charge({ amount: 9999 });

    expect(a).toEqual({ charged: 10 });
    expect(b).toEqual({ charged: 9999 });
    expect(seen).toEqual(['charge:10', 'charge:9999']);
  });

  it('executes every time when the method takes no arguments', async () => {
    let calls = 0;

    class Ticker {
      @Idempotent({ key: 'id' })
      async tick() {
        calls++;
        return calls;
      }
    }

    const t = new Ticker();
    expect(await t.tick()).toBe(1);
    expect(await t.tick()).toBe(2);
  });

  it('executes every time when the first argument is a primitive', async () => {
    let calls = 0;

    class Lookup {
      @Idempotent({ key: 'userId' })
      async byId(id: string) {
        calls++;
        return `${id}:${calls}`;
      }
    }

    const l = new Lookup();
    expect(await l.byId('a')).toBe('a:1');
    expect(await l.byId('b')).toBe('b:2');
  });
});

describe('@Idempotent with a key present', () => {
  it('still returns the cached result for a repeated key', async () => {
    let calls = 0;

    class Orders {
      @Idempotent({ key: 'requestId', ttl: '10m' })
      async place(req: { requestId: string }) {
        calls++;
        return { id: req.requestId, calls };
      }
    }

    const o = new Orders();
    expect(await o.place({ requestId: 'r1' })).toEqual({ id: 'r1', calls: 1 });
    expect(await o.place({ requestId: 'r1' })).toEqual({ id: 'r1', calls: 1 });
    expect(await o.place({ requestId: 'r2' })).toEqual({ id: 'r2', calls: 2 });
  });

  it('treats a numeric key as its own entry, not as absent', async () => {
    let calls = 0;

    class Rows {
      @Idempotent({ key: 'rowId' })
      async get(req: { rowId: number }) {
        calls++;
        return { rowId: req.rowId, calls };
      }
    }

    const r = new Rows();
    expect(await r.get({ rowId: 0 })).toEqual({ rowId: 0, calls: 1 });
    expect(await r.get({ rowId: 0 })).toEqual({ rowId: 0, calls: 1 });
    expect(await r.get({ rowId: 1 })).toEqual({ rowId: 1, calls: 2 });
  });

  it('keeps caches separate per instance', async () => {
    let calls = 0;

    class Svc {
      @Idempotent({ key: 'k' })
      async run(req: { k: string }) {
        calls++;
        return calls;
      }
    }

    const a = new Svc();
    const b = new Svc();
    expect(await a.run({ k: 'same' })).toBe(1);
    expect(await b.run({ k: 'same' })).toBe(2);
  });
});

describe('@Idempotent and concurrency', () => {
  it('runs the body once when two identical calls overlap', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    class Slow {
      @Idempotent({ key: 'requestId' })
      async work(req: { requestId: string }) {
        calls++;
        await gate;
        return { calls };
      }
    }

    const s = new Slow();
    const first = s.work({ requestId: 'dup' });
    const second = s.work({ requestId: 'dup' });
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a).toEqual({ calls: 1 });
    expect(b).toEqual({ calls: 1 });
  });

  it('does not cache a rejection', async () => {
    let calls = 0;

    class Flaky {
      @Idempotent({ key: 'requestId' })
      async run(req: { requestId: string }) {
        calls++;
        if (calls === 1) throw new Error('transient');
        return { calls };
      }
    }

    const f = new Flaky();
    await expect(f.run({ requestId: 'x' })).rejects.toThrow('transient');
    expect(await f.run({ requestId: 'x' })).toEqual({ calls: 2 });
  });

  it('propagates a rejection to every caller waiting on the same key', async () => {
    let calls = 0;
    let fail!: (e: Error) => void;
    const gate = new Promise<never>((_, reject) => {
      fail = reject;
    });

    class Flaky {
      @Idempotent({ key: 'requestId' })
      async run(req: { requestId: string }) {
        calls++;
        return gate;
      }
    }

    const f = new Flaky();
    const first = f.run({ requestId: 'x' });
    const second = f.run({ requestId: 'x' });
    fail(new Error('boom'));

    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});

describe('@Idempotent ttl validation', () => {
  it('refuses a duration it cannot parse instead of disabling itself', () => {
    expect(() => {
      class Bad {
        @Idempotent({ key: 'id', ttl: '1500ms' })
        async run(req: { id: string }) {
          return req.id;
        }
      }
      return Bad;
    }).toThrow(/ttl/i);
  });

  it('refuses a zero duration', () => {
    expect(() => {
      class Bad {
        @Idempotent({ key: 'id', ttl: '0s' })
        async run(req: { id: string }) {
          return req.id;
        }
      }
      return Bad;
    }).toThrow(/ttl/i);
  });

  it('accepts the units it documents', () => {
    expect(() => {
      class Good {
        @Idempotent({ key: 'id', ttl: '90s' })
        async a(req: { id: string }) {
          return req.id;
        }

        @Idempotent({ key: 'id', ttl: '2d' })
        async b(req: { id: string }) {
          return req.id;
        }
      }
      return Good;
    }).not.toThrow();
  });
});
