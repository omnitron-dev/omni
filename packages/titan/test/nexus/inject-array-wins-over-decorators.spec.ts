/**
 * `inject: [...]` on a useClass provider WINS over the parameter decorators,
 * and the array is positional and typed `any[]`.
 *
 * `RegistrationService.register` reads `provider.inject` when it is present
 * and only falls back to `extractClassDependencies` when it is absent. So a
 * class can carry a full set of correct `@Inject` decorators and still be
 * constructed from a stale array that nobody reconciled with it.
 *
 * Two ways that goes wrong, and only one of them was caught:
 *
 *   - a token MISSING from the array — the extra parameters arrive
 *     `undefined`, and `validateConstructorArity` warns (through
 *     `console.warn`, which no application log here captures).
 *   - a token INSERTED IN THE MIDDLE — every parameter after it receives its
 *     neighbour's dependency. The length is right, so the arity check sees
 *     nothing at all, and the failure surfaces much later and somewhere else
 *     as "Cannot read properties of undefined".
 *
 * The second is what `validateInjectOrder` closes. It is not a heuristic: a
 * parameter carrying `@Inject(TOKEN)` and the module's `inject[i]` are two
 * declarations of the same fact, so when both exist and disagree, one of them
 * is wrong. That is worth throwing for.
 */
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { Container } from '../../src/nexus/container.js';
import { createToken } from '../../src/nexus/token.js';
import { Injectable, Inject } from '../../src/decorators/index.js';

const ALPHA = createToken<{ who: 'alpha' }>('ALPHA');
const BETA = createToken<{ who: 'beta' }>('BETA');
const GAMMA = createToken<{ who: 'gamma' }>('GAMMA');
const SERVICE = createToken<Service>('SERVICE');

@Injectable()
class Service {
  constructor(
    @Inject(ALPHA) readonly alpha: { who: string },
    @Inject(BETA) readonly beta: { who: string },
  ) {}
}

const withValues = (c: Container) => {
  c.register(ALPHA, { useValue: { who: 'alpha' as const } });
  c.register(BETA, { useValue: { who: 'beta' as const } });
  c.register(GAMMA, { useValue: { who: 'gamma' as const } });
  return c;
};

describe('inject[] against the constructor it claims to describe', () => {
  it('accepts an array that agrees with the decorators', () => {
    const c = withValues(new Container());
    c.register(SERVICE, { useClass: Service, inject: [ALPHA, BETA] });

    const s = c.resolve(SERVICE);
    expect(s.alpha.who).toBe('alpha');
    expect(s.beta.who).toBe('beta');
  });

  it('refuses an array with a token inserted in the middle', () => {
    const c = withValues(new Container());
    // The shape that shifts everything after it. Length is 2 at the
    // constructor's arity, so the count check is satisfied.
    c.register(SERVICE, { useClass: Service, inject: [GAMMA, ALPHA, BETA] });

    expect(() => c.resolve(SERVICE)).toThrow(/parameter 0.*ALPHA.*GAMMA/s);
  });

  it('names every slot that disagrees, not just the first', () => {
    const c = withValues(new Container());
    c.register(SERVICE, { useClass: Service, inject: [BETA, ALPHA] });

    try {
      c.resolve(SERVICE);
      expect.unreachable('a swapped pair must not resolve');
    } catch (err) {
      const msg = String((err as Error).message);
      expect(msg).toMatch(/parameter 0/);
      expect(msg).toMatch(/parameter 1/);
    }
  });

  it('allows a longer array — a module may append a token to force construction', () => {
    const c = withValues(new Container());
    // `AuthService` in the downstream project does exactly this: a handler
    // token last, so the handler is instantiated and registers itself. The
    // extra entry sits past the constructor's parameters and hurts nothing.
    c.register(SERVICE, { useClass: Service, inject: [ALPHA, BETA, GAMMA] });

    const s = c.resolve(SERVICE);
    expect(s.alpha.who).toBe('alpha');
    expect(s.beta.who).toBe('beta');
  });

  it('still only warns about a SHORT array, which may be @Optional', () => {
    const c = withValues(new Container());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    c.register(SERVICE, { useClass: Service, inject: [ALPHA] });

    // A missing token is indistinguishable at runtime from a TS-optional
    // parameter, so this stays a warning — but it must still be loud.
    const s = c.resolve(SERVICE);
    expect(s.beta).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/arity mismatch/);
    warn.mockRestore();
  });

  it('says nothing about a class with no decorators to compare against', () => {
    class Bare {
      constructor(
        readonly a: unknown,
        readonly b: unknown,
      ) {}
    }
    const BARE = createToken<Bare>('BARE');
    const c = withValues(new Container());
    // Nothing declares what belongs in each slot, so the array is the only
    // statement there is and there is nothing to contradict it.
    c.register(BARE, { useClass: Bare, inject: [BETA, ALPHA] });

    expect(() => c.resolve(BARE)).not.toThrow();
  });
});
