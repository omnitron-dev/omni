/**
 * What `@EmitEvent` actually does — as opposed to what its name suggests.
 *
 * The tests that existed for it emitted the event THEMSELVES and then asserted
 * it had arrived ("Manually emit for test purposes", says the comment). They
 * would pass with the decorator deleted, and that is how two surprises in its
 * contract stayed unrecorded:
 *
 *   1. It emits `${event}.success` and `${event}.error`, never the bare name.
 *      Subscribing to what you passed gets you nothing.
 *   2. It finds its emitter by CONVENTION — `this.__eventEmitter__` or
 *      `this.eventEmitter` — with no injection and no complaint when neither
 *      exists. On a class without such a property the decorator is a no-op.
 *
 * Both are pinned here, the second deliberately: silence is the current
 * behaviour, and a test saying so turns it from an accident into a decision.
 */
import { describe, it, expect, vi } from 'vitest';

import { EmitEvent } from '../src/events.decorators.js';

function recorder() {
  const seen: Array<{ event: string; data: any }> = [];
  return { emit: vi.fn((event: string, data: any) => seen.push({ event, data })), seen };
}

describe('@EmitEvent', () => {
  it('emits `<event>.success` — not the event name it was given', async () => {
    const bus = recorder();

    class UserService {
      readonly eventEmitter = bus;
      @EmitEvent({ event: 'user.created' })
      async createUser(name: string) {
        return { id: 1, name };
      }
    }

    const result = await new UserService().createUser('Ada');

    expect(result).toEqual({ id: 1, name: 'Ada' });
    expect(bus.seen.map((e) => e.event)).toEqual(['user.created.success']);
    expect(bus.seen[0]!.data).toEqual({ id: 1, name: 'Ada' });
  });

  it('emits `<event>.error` and rethrows', async () => {
    const bus = recorder();

    class UserService {
      readonly eventEmitter = bus;
      @EmitEvent({ event: 'user.created' })
      async createUser() {
        throw new Error('Creation failed');
      }
    }

    await expect(new UserService().createUser()).rejects.toThrow('Creation failed');
    expect(bus.seen.map((e) => e.event)).toEqual(['user.created.error']);
    expect(bus.seen[0]!.data).toBeInstanceOf(Error);
  });

  it('applies mapResult and mapError', async () => {
    const bus = recorder();

    class UserService {
      readonly eventEmitter = bus;
      @EmitEvent({
        event: 'user.created',
        mapResult: (u: any) => ({ id: u.id }),
        mapError: (e: Error) => ({ reason: e.message }),
      })
      async createUser(fail = false) {
        if (fail) throw new Error('nope');
        return { id: 7, secret: 'do-not-emit' };
      }
    }

    const svc = new UserService();
    await svc.createUser();
    expect(bus.seen[0]!.data).toEqual({ id: 7 });

    await expect(svc.createUser(true)).rejects.toThrow('nope');
    expect(bus.seen[1]!.data).toEqual({ reason: 'nope' });
  });

  it('also accepts the `__eventEmitter__` property name', async () => {
    const bus = recorder();

    class UserService {
      readonly __eventEmitter__ = bus;
      @EmitEvent({ event: 'x' })
      async run() {
        return 1;
      }
    }

    await new UserService().run();
    expect(bus.seen.map((e) => e.event)).toEqual(['x.success']);
  });

  it('is a silent no-op on a class with neither property', async () => {
    // The decorator does not inject anything and does not complain. A service
    // that names its emitter something else — `events`, `bus`, `emitter` —
    // gets a decorator that runs the method and emits nothing, with no error
    // to chase. Pinned so that changing it is a decision, not a drift.
    class UserService {
      readonly bus = recorder(); // a perfectly reasonable name, and not one of the two
      @EmitEvent({ event: 'user.created' })
      async createUser() {
        return { id: 1 };
      }
    }

    const svc = new UserService();
    await expect(svc.createUser()).resolves.toEqual({ id: 1 });
    expect(svc.bus.seen).toEqual([]);
    expect(svc.bus.emit).not.toHaveBeenCalled();
  });
});
