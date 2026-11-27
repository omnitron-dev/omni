import { describe, expect, it } from 'vitest';
import { classifyRpcError } from './errors';

describe('sign-in failures', () => {
  it.each([
    [{ code: 'TIMEOUT' }, 'The sign-in request timed out before Console received a result.'],
    [{ status: 504 }, 'The sign-in request timed out before Console received a result.'],
    [new Error('HTTP 503: Session store is unavailable'), 'The session database is unavailable. Please try again when it responds.'],
    [{ status: 503 }, 'The sign-in service is temporarily unavailable.'],
    [{ status: 401 }, 'Invalid username or password.'],
    [new Error('Invalid credentials'), 'Invalid username or password.'],
  ])('reports the outcome of %j', (error, message) => {
    expect(classifyRpcError(error)).toBe(message);
  });
});
