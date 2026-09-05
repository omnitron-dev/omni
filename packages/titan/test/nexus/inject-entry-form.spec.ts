/**
 * `inject: [[TOKEN, { optional: true }]]` is not a supported entry form, but
 * it reads like one — it mirrors the provider tuples written right above it,
 * and those are usually cast `as any` to work around literal-type inference on
 * `scope`, so TypeScript stays quiet. Two packages in this repo had written it.
 *
 * Resolution understands a bare token or `{ token, optional }`. Anything else
 * falls through to "resolve this value as a token", which used to fail much
 * later with "Cannot resolve 'Unknown'" — a message that names neither the
 * provider that is wrong nor what to write instead.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Container, createToken } from '../../src/nexus/index.js';

const OPTIONS = createToken<string>('SomeOptions');
const TARGET = createToken<any>('Target');

class Target {
  constructor(public options?: string) {}
}

describe('inject entry forms', () => {
  it('rejects the tuple form at registration, naming the fix', () => {
    const container = new Container();
    expect(() =>
      container.register(TARGET, { useClass: Target, inject: [[OPTIONS, { optional: true }]] } as any)
    ).toThrow(/\{ token: TOKEN, optional: true \}/);
  });

  it('accepts the object form and delivers the value', () => {
    const container = new Container();
    container.register(OPTIONS, { useValue: 'configured' });
    container.register(TARGET, { useClass: Target, inject: [{ token: OPTIONS, optional: true }] } as any);
    expect((container.resolve(TARGET) as Target).options).toBe('configured');
  });

  it('accepts the object form when the optional token is absent', () => {
    const container = new Container();
    container.register(TARGET, { useClass: Target, inject: [{ token: OPTIONS, optional: true }] } as any);
    expect((container.resolve(TARGET) as Target).options).toBeUndefined();
  });
});
