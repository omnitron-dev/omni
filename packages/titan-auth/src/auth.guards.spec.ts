/**
 * Guard authorisation tests.
 *
 * auth.guards.ts (341 lines) had no tests at all. These pin the two
 * authorisation rules a guard exists to enforce:
 *
 *   1. A guard mounted with required roles must ALWAYS be satisfied. A method
 *      decorator can add requirements; it must not be able to remove them.
 *   2. `@Public()` short-circuits authentication — at method level and at
 *      class level, in every guard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AuthGuard, RoleGuard, ApiKeyGuard, CompositeGuard } from './auth.guards.js';
import { Public, RequireRole } from './auth.decorators.js';
import type { IAuthContext, IAuthMiddleware, IRequestLike } from './auth.types.js';

/** Minimal request with plain-object headers (the Node.js shape). */
function request(headers: Record<string, string> = {}): IRequestLike {
  return { headers } as IRequestLike;
}

function contextFor(role: string): IAuthContext {
  return {
    userId: `user-${role}`,
    role,
    tenantId: 'default',
    isServiceRole: role === 'service_role',
    claims: { sub: `user-${role}`, role },
  };
}

/** Auth middleware stub that always authenticates as the given role. */
function middlewareFor(role: string): IAuthMiddleware {
  return {
    authenticate: vi.fn(async () => contextFor(role)),
    authenticateRequired: vi.fn(async () => contextFor(role)),
    extractToken: vi.fn(() => null),
    validateApiKey: vi.fn(() => ({ valid: false })),
  } as unknown as IAuthMiddleware;
}

class AdminArea {
  // Declares a *narrower* requirement than the guard protecting the class.
  @RequireRole(['user'])
  readReport(): void {}

  @Public()
  health(): void {}

  unannotated(): void {}
}

@Public()
class PublicArea {
  anything(): void {}
}

describe('RoleGuard', () => {
  let handler: AdminArea;

  beforeEach(() => {
    handler = new AdminArea();
  });

  /**
   * The bypass. `execute()` used to `return { allowed: true }` as soon as the
   * method-level decorator was satisfied, never reaching the guard's own
   * `requiredRoles`. A RoleGuard mounted with ['admin'] was therefore defeated
   * by any method annotated with a role the caller happens to hold — the
   * narrow decorator silently overrode the broad guard instead of adding to it.
   */
  it('still enforces guard-level roles when a method decorator is satisfied', async () => {
    const guard = new RoleGuard(middlewareFor('user'), ['admin']);

    const result = await guard.execute({
      request: request(),
      handler,
      methodName: 'readReport',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('admin');
  });

  it('allows when both the decorator and the guard are satisfied', async () => {
    // service_role satisfies every role check by design (see hasRole()).
    const guard = new RoleGuard(middlewareFor('service_role'), ['admin']);

    const result = await guard.execute({ request: request(), handler, methodName: 'readReport' });

    expect(result.allowed).toBe(true);
    expect(result.authContext?.role).toBe('service_role');
  });

  it('denies when the method decorator alone is not satisfied', async () => {
    const guard = new RoleGuard(middlewareFor('guest'), []);

    const result = await guard.execute({ request: request(), handler, methodName: 'readReport' });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('user');
  });

  it('enforces guard-level roles on methods with no decorator', async () => {
    const denied = await new RoleGuard(middlewareFor('user'), ['admin']).execute({
      request: request(),
      handler,
      methodName: 'unannotated',
    });
    expect(denied.allowed).toBe(false);

    const allowed = await new RoleGuard(middlewareFor('admin'), ['admin']).execute({
      request: request(),
      handler,
      methodName: 'unannotated',
    });
    expect(allowed.allowed).toBe(true);
  });

  it('honours @Public() at method level', async () => {
    const guard = new RoleGuard(middlewareFor('guest'), ['admin']);
    const result = await guard.execute({ request: request(), handler, methodName: 'health' });
    expect(result.allowed).toBe(true);
  });

  it('honours @Public() at class level', async () => {
    const guard = new RoleGuard(middlewareFor('guest'), ['admin']);
    const result = await guard.execute({
      request: request(),
      handler: new PublicArea(),
      methodName: 'anything',
    });
    expect(result.allowed).toBe(true);
  });

  it('denies an anonymous caller before any role check', async () => {
    const anonymous: IAuthContext = {
      userId: 'anonymous',
      role: 'anon',
      tenantId: 'default',
      isServiceRole: false,
      claims: { sub: 'anonymous', role: 'anon' },
    };
    const middleware = {
      authenticateRequired: vi.fn(async () => anonymous),
    } as unknown as IAuthMiddleware;

    const result = await new RoleGuard(middleware, ['admin']).execute({ request: request() });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Authentication required');
  });

  it('reports denial through canActivate', async () => {
    const guard = new RoleGuard(middlewareFor('user'), ['admin']);
    await expect(guard.canActivate({ request: request(), handler, methodName: 'readReport' })).resolves.toBe(false);
  });
});

describe('AuthGuard', () => {
  it('allows a public method without authenticating', async () => {
    const middleware = {
      authenticateRequired: vi.fn(async () => {
        throw new Error('should not be called');
      }),
    } as unknown as IAuthMiddleware;

    const result = await new AuthGuard(middleware).execute({
      request: request(),
      handler: new AdminArea(),
      methodName: 'health',
    });

    expect(result.allowed).toBe(true);
    expect(middleware.authenticateRequired).not.toHaveBeenCalled();
  });

  it('allows a class-level public handler without authenticating', async () => {
    const middleware = {
      authenticateRequired: vi.fn(async () => {
        throw new Error('should not be called');
      }),
    } as unknown as IAuthMiddleware;

    const result = await new AuthGuard(middleware).execute({
      request: request(),
      handler: new PublicArea(),
      methodName: 'anything',
    });

    expect(result.allowed).toBe(true);
  });

  it('denies when authentication fails and surfaces the reason', async () => {
    const middleware = {
      authenticateRequired: vi.fn(async () => {
        throw new Error('Authentication required');
      }),
    } as unknown as IAuthMiddleware;

    const result = await new AuthGuard(middleware).execute({
      request: request(),
      handler: new AdminArea(),
      methodName: 'unannotated',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Authentication required');
  });
});

describe('ApiKeyGuard', () => {
  it('denies when the header is missing', async () => {
    const guard = new ApiKeyGuard({ validateKey: async () => ({ userId: 'u1' }) });
    const result = await guard.execute({ request: request() });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('X-API-Key');
  });

  it('denies when validateKey rejects the key', async () => {
    const guard = new ApiKeyGuard({ validateKey: async () => null });
    const result = await guard.execute({ request: request({ 'x-api-key': 'nope' }) });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Invalid API key');
  });

  it('builds an auth context from the validated key', async () => {
    const guard = new ApiKeyGuard({ validateKey: async () => ({ userId: 'u1', scopes: ['read'] }) });
    const result = await guard.execute({ request: request({ 'x-api-key': 'good' }) });

    expect(result.allowed).toBe(true);
    expect(result.authContext).toMatchObject({ userId: 'u1', role: 'api_key', isServiceRole: false });
    expect(result.authContext?.claims['scopes']).toEqual(['read']);
  });

  it('honours @Public() at class level', async () => {
    const validateKey = vi.fn(async () => null);
    const guard = new ApiKeyGuard({ validateKey });

    const result = await guard.execute({
      request: request(),
      handler: new PublicArea(),
      methodName: 'anything',
    });

    expect(result.allowed).toBe(true);
    expect(validateKey).not.toHaveBeenCalled();
  });
});

describe('CompositeGuard', () => {
  const allow = { canActivate: async () => true };
  const deny = { canActivate: async () => false };

  it('requires every guard in "all" mode', async () => {
    await expect(new CompositeGuard([allow, allow], 'all').canActivate({ request: request() })).resolves.toBe(true);
    await expect(new CompositeGuard([allow, deny], 'all').canActivate({ request: request() })).resolves.toBe(false);
  });

  it('requires one guard in "any" mode', async () => {
    await expect(new CompositeGuard([deny, allow], 'any').canActivate({ request: request() })).resolves.toBe(true);
    await expect(new CompositeGuard([deny, deny], 'any').canActivate({ request: request() })).resolves.toBe(false);
  });
});
