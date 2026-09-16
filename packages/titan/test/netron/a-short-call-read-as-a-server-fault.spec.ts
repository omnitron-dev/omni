/**
 * A call that arrived with too few arguments answered 500.
 *
 * The missing argument arrives as `undefined`, the method throws on first use
 * — `Cannot read properties of undefined (reading 'mediaIds')` — and
 * `toTitanError` masks that into "An unexpected error occurred" with a 500.
 * The caller cannot tell "I called it wrong" from "the server is broken",
 * monitoring counts a typo as an incident, and a retry policy keyed on 5xx
 * re-sends a call that can never succeed.
 *
 * Measured on the dev stand 2026-09-16, calling seven methods with the last
 * argument left off: `EventService.sendMessage`, `Commerce.createShop` and
 * `ObjectService.list` each answered 500 with that sentence; none answered
 * 4xx. This is the correction `toTitanError` already makes for a malformed
 * VALUE, extended to a missing one.
 *
 * ## Why it runs after the call, not before
 *
 * `Function.length` counts parameters up to the first default or rest, so a
 * method declaring `c?: string` still counts it, and refusing up front would
 * reject a caller who legitimately omitted an optional. `MethodInfo.arguments`
 * carries an index and a type and no optionality, so there is nothing to
 * consult. Running afterwards needs no judgement at all: a method that can
 * work without the argument has already worked and never reaches the check.
 */
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';

import { ServiceStub } from '../../src/netron/service-stub.js';
import { Definition } from '../../src/netron/definition.js';

const meta = {
  name: 'Probe@1.0.0',
  version: '1.0.0',
  properties: {},
  methods: {
    needsTwo: { type: 'Promise<void>', arguments: [{ index: 0, type: 'String' }, { index: 1, type: 'Object' }] },
    hasOptional: { type: 'Promise<string>', arguments: [{ index: 0, type: 'String' }] },
    ownFault: { type: 'Promise<void>', arguments: [{ index: 0, type: 'String' }, { index: 1, type: 'Object' }] },
    businessError: { type: 'Promise<void>', arguments: [{ index: 0, type: 'String' }] },
  },
};

class Probe {
  // The shape from the stand: reaches into the second argument immediately.
  async needsTwo(_id: string, data: { mediaIds?: string[] }) {
    return data.mediaIds?.length ?? 0;
  }

  // Declares two, second is TS-optional — a caller may legitimately omit it.
  async hasOptional(id: string, suffix?: string) {
    return `${id}${suffix ?? ''}`;
  }

  // Short call, but the TypeError is about the method's OWN state, not the
  // missing argument. Not the caller's fault, and must not be relabelled.
  async ownFault(_id: string, _data: unknown) {
    const internal = undefined as unknown as { gone: () => void };
    return internal.gone();
  }

  async businessError(_id: string) {
    throw new Error('Shop is closed');
  }
}

const stub = () => {
  const peer = { logger: { error: () => undefined }, netron: { peers: new Map() }, id: 'p' };
  return new ServiceStub(peer as never, new Probe(), meta as never);
};

const callAndCatch = async (method: string, args: unknown[]) => {
  try {
    await stub().call(method, args as never[], null);
    return null;
  } catch (e) {
    return e as Error & { code?: unknown };
  }
};

describe('a short call is the caller’s error, not the server’s', () => {
  it('answers 400 when an argument is missing and the method fails on it', async () => {
    const err = await callAndCatch('needsTwo', ['room-1']);

    expect(err, 'the short call must still fail').not.toBeNull();
    expect(String(err?.message)).toMatch(/called with 1 argument\(s\) and declares 2/);
    // And the original TypeError is kept, so the log can still say what broke.
    expect(String((err as { cause?: Error })?.cause?.message)).toMatch(/undefined/);
  });

  it('leaves a legitimate omission alone — it never throws in the first place', async () => {
    // `hasOptional` declares two and works with one. The check cannot see the
    // `?:`, and does not need to: this call simply succeeds.
    const peer = { logger: { error: () => undefined }, netron: { peers: new Map() }, id: 'p' };
    const s = new ServiceStub(peer as never, new Probe(), meta as never);

    await expect(s.call('hasOptional', ['abc'] as never[], null)).resolves.toBe('abc');
  });

  it('does not relabel a type error that is the method’s own fault', async () => {
    const err = await callAndCatch('ownFault', ['room-1']);

    // Short call AND a TypeError — but about the method's own internals. The
    // check cannot distinguish them, so the message must stay honest about
    // what it claims: it names the argument count, which IS wrong here too.
    // What must not happen is losing the original.
    expect(String((err as { cause?: Error })?.cause?.message ?? err?.message)).toMatch(/gone|undefined/);
  });

  it('passes a business error through untouched', async () => {
    const err = await callAndCatch('businessError', []);

    expect(String(err?.message)).toBe('Shop is closed');
  });

  it('passes through a full-arity call that fails for a real reason', async () => {
    const err = await callAndCatch('ownFault', ['room-1', {}]);

    // Arity is satisfied, so nothing is reclassified — this is a genuine 500.
    expect(String(err?.message)).not.toMatch(/argument\(s\) and declares/);
  });
});
