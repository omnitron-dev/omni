/**
 * A repository handed an unsettled connection must not keep the Promise.
 *
 * Titan's `Container.loadModule` replaces every module provider's
 * `useFactory` with a plain arrow that calls the original inside
 * `runInModuleScope`, and registration decides async-ness from
 * `useFactory.constructor.name === 'AsyncFunction'` — of the WRAPPER, which
 * is always `Function`. So an `async useFactory` such as
 * `DATABASE_CONNECTION` is classified as synchronous, and nothing stops a
 * synchronous resolution from injecting the unsettled Promise. Because these
 * repositories are Singletons, the Promise is then kept for the life of the
 * process and every query throws
 * `[TransactionAwareRepository] executor has no selectFrom`.
 *
 * Measured downstream 2026-09-11: `OrgAuditLogRepository` was one of them, so
 * `Delivery.createPickupPoint` wrote its row and then answered 500 on the
 * audit write, and redeeming a pickup code marked the parcel delivered and
 * then answered 500.
 *
 * The connection is still the connection once it settles, so the repository
 * adopts it. Fixing the classification in Titan is the other half and is a
 * separate change — it turns those sync resolutions into thrown errors, and
 * main's `DeliveryModule` eager-init performs one.
 */

import { describe, it, expect } from 'vitest';
import { TransactionAwareRepository } from '../src/repository/transaction-aware.repository.js';

interface FakeDB {
  widgets: { id: string };
}

/** Minimal stand-in: the only thing the shape check looks for. */
const fakeKysely = () => ({ selectFrom: (t: string) => ({ table: t }) }) as never;

class WidgetRepository extends TransactionAwareRepository<FakeDB, 'widgets'> {
  constructor(db: never) {
    super(db, 'widgets');
  }
  /** Reaches the protected getter the same way every query method does. */
  probe() {
    return (this as unknown as { executor: { selectFrom(t: string): unknown } }).executor;
  }
}

describe('a repository constructed with an unsettled connection', () => {
  it('adopts the connection once it settles', async () => {
    let settle!: (db: never) => void;
    const pending = new Promise<never>((resolve) => {
      settle = resolve;
    });

    const repo = new WidgetRepository(pending as never);

    // Before the connection settles there is nothing to query with, and the
    // diagnostic is the honest answer.
    expect(() => repo.probe()).toThrow(/executor has no selectFrom/);

    settle(fakeKysely());
    await pending;
    await Promise.resolve();

    // This is the regression: it used to throw here for the rest of the
    // process's life.
    expect(repo.probe()).toBeDefined();
    expect(typeof repo.probe().selectFrom).toBe('function');
  });

  it('leaves an ordinary connection exactly as it was', () => {
    const db = fakeKysely();
    const repo = new WidgetRepository(db);
    expect(repo.probe()).toBe(db);
  });

  it('a connection that never settles still reports the real shape', async () => {
    const repo = new WidgetRepository(new Promise(() => {}) as never);
    await Promise.resolve();
    expect(() => repo.probe()).toThrow(/constructorName.*Promise/s);
  });

  it('a rejected connection does not raise a second, less useful error', async () => {
    const rejected = Promise.reject(new Error('connect failed'));
    const repo = new WidgetRepository(rejected as never);
    await Promise.resolve();
    await Promise.resolve();
    // The unhandled-rejection guard is the point: the constructor attaches a
    // rejection handler, so the process does not die on an unrelated failure.
    expect(() => repo.probe()).toThrow(/executor has no selectFrom/);
  });
});
