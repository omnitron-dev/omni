import { expect, expectTypeOf, it } from 'vitest';
import { defer, type Deferred } from '../src/index.js';

it('returns a complete typed handle that adopts the first settlement', async () => {
  const handle = defer<string>();
  expectTypeOf(handle.promise).toEqualTypeOf<Promise<string>>();
  expectTypeOf(handle.resolve).parameter(0).toEqualTypeOf<string | PromiseLike<string>>();
  expectTypeOf({}).toMatchTypeOf<Deferred>();
  handle.resolve(Promise.resolve('ready'));
  handle.reject(new Error('late'));
  await expect(handle.promise).resolves.toBe('ready');
});
