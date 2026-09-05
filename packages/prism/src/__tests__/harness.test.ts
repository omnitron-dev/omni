/**
 * The test harness itself.
 *
 * `@testing-library/jest-dom/vitest` is a side-effect import that extends
 * `expect`, and at 6.9.1 it broke `rejects.toThrow`: every asynchronous
 * rejection assertion in the package failed with
 * `TypeError: Cannot read properties of undefined (reading 'indexOf')`.
 *
 * That failure is dangerous in a specific way. It does not look like a
 * broken matcher — it looks like the code under test rejecting with the
 * wrong thing. Two AsyncLock tests failed for a whole session and read as a
 * defect in AsyncLock, which is correct and was never touched. The next step
 * after "the test says the error is wrong" is usually to change the code.
 *
 * So the harness gets its own assertions. If a dependency bump breaks
 * `expect` again, the failure says so in one line instead of being
 * distributed across whichever tests happened to use the broken form.
 */

import { describe, it, expect } from 'vitest';

class Boom extends Error {
  constructor() {
    super('boom');
    this.name = 'Boom';
  }
}

describe('expect works', () => {
  it('matches a synchronous throw by message', () => {
    expect(() => {
      throw new Boom();
    }).toThrow('boom');
  });

  it('matches a rejection by message', async () => {
    // The one that broke.
    await expect(Promise.reject(new Boom())).rejects.toThrow('boom');
  });

  it('matches a rejection by regex and by constructor', async () => {
    await expect(Promise.reject(new Boom())).rejects.toThrow(/bo+m/);
    await expect(Promise.reject(new Boom())).rejects.toThrow(Boom);
  });

  it('matches a rejection through toThrowError, the older spelling', async () => {
    await expect(Promise.reject(new Boom())).rejects.toThrowError('boom');
  });

  it('still fails when the message does not match', async () => {
    // A matcher that passes everything is as useless as one that fails
    // everything, and the second is at least noisy.
    let failed = false;
    try {
      await expect(Promise.reject(new Boom())).rejects.toThrow('something else');
    } catch {
      failed = true;
    }
    expect(failed, 'rejects.toThrow must reject a wrong message').toBe(true);
  });

  it('resolves assertions work too', async () => {
    await expect(Promise.resolve(42)).resolves.toBe(42);
  });
});

describe('jest-dom matchers are installed', () => {
  it('has toBeInTheDocument', () => {
    // The reason the side-effect import is there at all. Losing it silently
    // would turn every DOM assertion into "not a function".
    const el = document.createElement('div');
    el.textContent = 'x';
    document.body.appendChild(el);

    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('x');
    el.remove();
  });
});
