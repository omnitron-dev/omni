/**
 * Request-authentication tests.
 *
 * auth.middleware.ts (219 lines) had no tests. The rule these pin hardest is
 * tenant selection: `x-tenant-id` is an unauthenticated request header, so it
 * must never let a caller choose which tenant they act as unless they proved
 * they are allowed to. Under RLS, `tenantId` is the isolation boundary.
 */

import { describe, it, expect, vi } from 'vitest';

import { AuthMiddleware, UnauthorizedError, createHttpAuthMiddleware } from './auth.middleware.js';
import type { IAuthContext, IAuthModuleOptions, IJWTService, IRequestLike } from './auth.types.js';

const SERVICE_KEY = 'service-key-secret';
const ANON_KEY = 'anon-key-public';

function request(headers: Record<string, string> = {}): IRequestLike {
  return { headers } as IRequestLike;
}

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
} as never;

function makeMiddleware(options: Partial<IAuthModuleOptions> = {}, jwtContext?: IAuthContext): AuthMiddleware {
  const jwtService = {
    createContext: vi.fn(async () => {
      if (!jwtContext) throw new Error('no jwt context configured');
      return jwtContext;
    }),
    verify: vi.fn(),
  } as unknown as IJWTService;

  const merged: IAuthModuleOptions = {
    defaultTenantId: 'default',
    serviceKey: SERVICE_KEY,
    anonKey: ANON_KEY,
    ...options,
  };

  return new AuthMiddleware(jwtService, merged, silentLogger);
}

describe('AuthMiddleware.authenticate — tenant selection', () => {
  it('ignores x-tenant-id for an unauthenticated caller', async () => {
    const middleware = makeMiddleware();

    const context = await middleware.authenticate(request({ 'x-tenant-id': 'victim-tenant' }));

    expect(context.userId).toBe('anonymous');
    expect(context.tenantId).toBe('default');
  });

  it('ignores x-tenant-id for the anonymous API key', async () => {
    // The anon key is public by design — holding it proves nothing about which
    // tenant the caller may act as.
    const middleware = makeMiddleware();

    const context = await middleware.authenticate(
      request({ 'x-api-key': ANON_KEY, 'x-tenant-id': 'victim-tenant' })
    );

    expect(context.role).toBe('anon');
    expect(context.tenantId).toBe('default');
  });

  it('honours x-tenant-id for the service key', async () => {
    // The service key is a trusted secret; acting across tenants is its purpose.
    const middleware = makeMiddleware();

    const context = await middleware.authenticate(
      request({ 'x-api-key': SERVICE_KEY, 'x-tenant-id': 'tenant-b' })
    );

    expect(context.isServiceRole).toBe(true);
    expect(context.tenantId).toBe('tenant-b');
  });

  it('falls back to the default tenant for a service key with no header', async () => {
    const middleware = makeMiddleware();
    const context = await middleware.authenticate(request({ 'x-api-key': SERVICE_KEY }));
    expect(context.tenantId).toBe('default');
  });

  it('takes the tenant from the verified JWT claim, not the header', async () => {
    const middleware = makeMiddleware({}, {
      userId: 'u1',
      role: 'user',
      tenantId: 'tenant-from-token',
      isServiceRole: false,
      claims: { sub: 'u1', role: 'user', tenant_id: 'tenant-from-token' },
    });

    const context = await middleware.authenticate(
      request({ authorization: 'Bearer token', 'x-tenant-id': 'victim-tenant' })
    );

    expect(context.tenantId).toBe('tenant-from-token');
  });

  it('respects a configured defaultTenantId', async () => {
    const middleware = makeMiddleware({ defaultTenantId: 'acme' });
    const context = await middleware.authenticate(request({ 'x-tenant-id': 'victim-tenant' }));
    expect(context.tenantId).toBe('acme');
  });
});

describe('AuthMiddleware.authenticate — credentials', () => {
  it('rejects an unknown API key', async () => {
    const middleware = makeMiddleware();
    await expect(middleware.authenticate(request({ 'x-api-key': 'wrong' }))).rejects.toThrow(UnauthorizedError);
  });

  it('accepts the api key from the alternate header name', async () => {
    const middleware = makeMiddleware();
    const context = await middleware.authenticate(request({ apikey: SERVICE_KEY }));
    expect(context.isServiceRole).toBe(true);
  });

  it('propagates a JWT verification failure', async () => {
    const middleware = makeMiddleware();
    await expect(middleware.authenticate(request({ authorization: 'Bearer bad' }))).rejects.toThrow(
      'no jwt context configured'
    );
  });

  it('ignores a non-Bearer authorization header', async () => {
    const middleware = makeMiddleware();
    const context = await middleware.authenticate(request({ authorization: 'Basic abc' }));
    expect(context.userId).toBe('anonymous');
  });
});

describe('AuthMiddleware.authenticateRequired', () => {
  it('rejects an anonymous caller', async () => {
    const middleware = makeMiddleware();
    await expect(middleware.authenticateRequired(request())).rejects.toThrow('Authentication required');
  });

  it('rejects a caller bearing only the anonymous API key', async () => {
    // The anon key authenticates nobody — it identifies the application, not a
    // user, so it must not satisfy a "login required" check.
    const middleware = makeMiddleware();
    await expect(middleware.authenticateRequired(request({ 'x-api-key': ANON_KEY }))).rejects.toThrow(
      'Authentication required'
    );
  });

  it('accepts a service key', async () => {
    const middleware = makeMiddleware();
    const context = await middleware.authenticateRequired(request({ 'x-api-key': SERVICE_KEY }));
    expect(context.isServiceRole).toBe(true);
  });
});

describe('validateApiKey', () => {
  it('classifies service and anon keys', () => {
    const middleware = makeMiddleware();
    expect(middleware.validateApiKey(SERVICE_KEY)).toMatchObject({ valid: true, type: 'service' });
    expect(middleware.validateApiKey(ANON_KEY)).toMatchObject({ valid: true, type: 'anon' });
    expect(middleware.validateApiKey('nope')).toEqual({ valid: false });
  });

  it('does not match a prefix of a configured key', () => {
    const middleware = makeMiddleware();
    expect(middleware.validateApiKey(SERVICE_KEY.slice(0, -1))).toEqual({ valid: false });
    expect(middleware.validateApiKey(`${SERVICE_KEY}x`)).toEqual({ valid: false });
  });
});

describe('createHttpAuthMiddleware', () => {
  it('attaches the auth context and calls next', async () => {
    const middleware = makeMiddleware();
    const handler = createHttpAuthMiddleware(middleware, { required: true });
    const ctx = { request: request({ 'x-api-key': SERVICE_KEY }) } as { request: IRequestLike & { auth?: IAuthContext } };
    const next = vi.fn(async () => {});

    await handler(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.request.auth?.isServiceRole).toBe(true);
  });

  it('rejects a role that is not allowed', async () => {
    const middleware = makeMiddleware({}, {
      userId: 'u1',
      role: 'user',
      tenantId: 'default',
      isServiceRole: false,
      claims: { sub: 'u1', role: 'user' },
    });
    const handler = createHttpAuthMiddleware(middleware, { allowedRoles: ['admin'] });
    const next = vi.fn(async () => {});

    await expect(handler({ request: request({ authorization: 'Bearer t' }) }, next)).rejects.toThrow(
      'Insufficient permissions'
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('routes failures to onUnauthorized when provided', async () => {
    const middleware = makeMiddleware();
    const onUnauthorized = vi.fn(() => new Response('denied', { status: 401 }));
    const handler = createHttpAuthMiddleware(middleware, { required: true, onUnauthorized });

    const result = await handler({ request: request() }, vi.fn(async () => {}));

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect((result as Response).status).toBe(401);
  });
});
