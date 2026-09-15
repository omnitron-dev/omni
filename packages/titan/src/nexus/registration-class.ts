/**
 * Which class does a container registration describe?
 *
 * Asked by every subsystem that walks registrations looking for decorated
 * classes — Netron auto-exposure for `@Service`, the scheduler for `@Cron` —
 * and until now each answered it separately, with different gaps:
 *
 *     auto-exposure   class | useClass | useValue.constructor
 *     scheduler       class | useClass
 *
 * Neither handled `useFactory`, which is how a module registers anything whose
 * construction needs other services. So a `@Service` built by a factory was
 * never put on the wire — observed as `Health@1.0.0` answering 404 on a live
 * `main` while the module's indicators ran on a timer for nobody — and a
 * `@Cron` on a class registered by value or by factory is simply never
 * scheduled, which is the kind of absence that reports nothing at all.
 *
 * Two questions, because they have different certainties. The PROVIDER names a
 * class only sometimes; the TOKEN names one whenever a module files a provider
 * under the class itself, which is the usual shape:
 *
 *     providers.push([HealthRpcService, { useFactory: … }])
 *
 * Neither requires resolving anything, which matters: discovery that resolves
 * in order to look is discovery that depends on resolution order.
 */

import type { Constructor } from './types.js';

/**
 * The class a provider names, or null when only resolving would tell.
 *
 * `useFactory`, `useToken` and `useExisting` return null by construction —
 * there is nothing in them to read.
 */
export function classOfProvider(provider: unknown): Constructor<unknown> | null {
  if (!provider) return null;
  if (typeof provider === 'function') return provider as Constructor<unknown>;
  if (typeof provider !== 'object') return null;

  if ('useClass' in provider) {
    return ((provider as { useClass?: Constructor<unknown> }).useClass ?? null) as Constructor<unknown> | null;
  }
  if ('useValue' in provider) {
    const value = (provider as { useValue?: { constructor?: Constructor<unknown> } }).useValue;
    return value?.constructor ?? null;
  }
  return null;
}

/**
 * The class a registration is FILED UNDER, for when its provider names none.
 *
 * Only a function can be one. A symbolic token names nothing, and a factory
 * under a symbolic token is therefore invisible to any scan that will not
 * resolve it — knowingly, not by oversight.
 */
export function classOfToken(token: unknown): Constructor<unknown> | null {
  return typeof token === 'function' ? (token as Constructor<unknown>) : null;
}

/** The class a registration describes: the provider's, else the token's. */
export function classOfRegistration(token: unknown, provider: unknown): Constructor<unknown> | null {
  return classOfProvider(provider) ?? classOfToken(token);
}
