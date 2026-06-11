/**
 * NX-1 — pins the Nexus provider SCOPE DEFAULT.
 *
 * The default is Singleton (`registration.ts` → `options.scope || Scope.Singleton`).
 * This is load-bearing: orchestrators/managers/stores rely on the implicit
 * default to be singletons, and titan-pm depends on it. The reverse is the
 * footgun — a stateful per-request object left at the default is silently
 * shared. Pinning it here prevents a silent regression to Transient.
 */

import { describe, it, expect } from 'vitest';
import { Container, createToken, Scope } from '../../src/nexus/index.js';

describe('nexus provider scope default (NX-1)', () => {
  it('a factory provider with NO explicit scope is Singleton (same instance, factory runs once)', () => {
    const container = new Container();
    const token = createToken<{ id: number }>('nx1.noScope.factory');
    let calls = 0;
    container.register(token, { useFactory: () => ({ id: ++calls }) });

    const a = container.resolve(token);
    const b = container.resolve(token);

    expect(a).toBe(b); // singleton — identical instance
    expect(calls).toBe(1); // factory invoked exactly once
  });

  it('a class provider with NO explicit scope is Singleton', () => {
    const container = new Container();
    class Service {}
    container.register(Service);

    expect(container.resolve(Service)).toBe(container.resolve(Service));
  });

  it('useValue is always Singleton (the same reference every resolve)', () => {
    const container = new Container();
    const token = createToken<{ v: number }>('nx1.useValue');
    const value = { v: 42 };
    container.register(token, { useValue: value });

    expect(container.resolve(token)).toBe(value);
    expect(container.resolve(token)).toBe(container.resolve(token));
  });

  it('explicit Scope.Transient yields a NEW instance per resolve (override of the default)', () => {
    const container = new Container();
    const token = createToken<{ id: number }>('nx1.transient');
    let calls = 0;
    container.register(token, { useFactory: () => ({ id: ++calls }), scope: Scope.Transient });

    const a = container.resolve(token);
    const b = container.resolve(token);

    expect(a).not.toBe(b); // transient — distinct instances
    expect(calls).toBe(2); // factory invoked per resolve
  });
});
