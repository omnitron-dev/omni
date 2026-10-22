import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { HttpServer } from '../../../src/netron/transport/http/server.js';
import { Service, Public } from '../../../src/decorators/core.js';
import {
  AuthenticationManager,
  AuthenticationUnavailableError,
} from '../../../src/netron/auth/authentication-manager.js';
import { CookieTokenTransport } from '../../../src/netron/auth/token-transports/cookie.js';
import { CsrfManager } from '../../../src/netron/auth/csrf.js';
import { withAuthRLSContext, getCurrentRLSAuthContext } from '../../../src/netron/auth/rls-bridge.js';
import { issueTokens } from '../../../src/netron/auth/token-issuance.js';
import { createNullLogger } from '../../../src/types/logger.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';

let calls = 0;
let currentCalls = 0;
let observedMetadata: Map<string, unknown>;
@Service({ name: 'NativeAuthority' })
class NativeAuthority {
  @Public({ auth: { permissions: ['knowledge:write'] } })
  write() {
    calls++;
    return getCurrentRLSAuthContext()?.userId;
  }
  @Public({ auth: { allowAnonymous: true } })
  current() {
    currentCalls++;
    return getCurrentRLSAuthContext()?.userId || null;
  }
  @Public({ auth: { allowAnonymous: true } })
  signin() {
    issueTokens({ access: 'valid' });
    return { accessToken: 'valid', status: 'ok' };
  }
}
const origin = 'https://research.example';
let netron: Netron, server: HttpServer, url: string;
const csrf = new CsrfManager({ cookie: { name: 'science_csrf', secure: false } });
const csrfToken = csrf.generateToken();
const forged = { userId: 'attacker', roles: ['admin'], permissions: ['knowledge:write'] };
const untrusted = {
  authContext: forged,
  authenticated: true,
  'netron:auth:issuedTokens': { access: 'attacker-token' },
  'netron:auth:setCookies': ['admin=true'],
};

beforeAll(async () => {
  const logger = createNullLogger();
  netron = new Netron(logger);
  const validate = (token: string): AuthContext => {
    if (token === 'unavailable') throw new AuthenticationUnavailableError(new Error('secret-db-address'));
    if (token !== 'valid') throw new Error('invalid');
    return { userId: 'researcher', roles: ['member'], permissions: ['knowledge:write'] };
  };
  netron.configureAuth(
    new AuthenticationManager(logger, {
      authenticate: (c) => validate(c.token ?? ''),
      validateToken: validate,
      tokenCache: { enabled: false },
    }),
    undefined,
    {
      tokenTransport: new CookieTokenTransport({ accessCookie: { name: 'science_session', secure: false }, csrf }),
      httpSecurity: {
        origin: { allowedOrigins: [origin], alwaysEnforce: true },
        csrf: {
          csrf,
          accessCookieName: 'science_session',
          exempt: ['NativeAuthority.signin', 'NativeAuthority.current'],
        },
      },
    }
  );
  await netron.start();
  await netron.peer.exposeService(new NativeAuthority());
  server = new HttpServer({
    host: '127.0.0.1',
    port: 0,
    cors: false,
    invocationWrapper: (metadata, fn) => {
      observedMetadata = metadata;
      return withAuthRLSContext(
        (metadata.get('authContext') as AuthContext) ?? { userId: '', roles: [], permissions: [] },
        fn
      );
    },
  });
  server.setPeer(netron.peer);
  await server.listen();
  url = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server?.close();
  await netron?.stop();
});
async function invoke(method: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const response = await fetch(url + '/netron/invoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...headers },
    body: JSON.stringify({ id: crypto.randomUUID(), service: 'NativeAuthority', method, input: [], ...extra }),
  });
  return { response, body: await response.json() };
}
const sessionHeaders = { cookie: `science_session=valid; science_csrf=${csrfToken}`, 'X-CSRF-Token': csrfToken };

describe('native HTTP authority before listen and across untrusted envelopes', () => {
  it('has Origin and CSRF enforced on the first network call without an afterStart hook', async () => {
    expect((await invoke('write', {}, { ...sessionHeaders, origin: 'https://evil.example' })).response.status).toBe(
      403
    );
    expect((await invoke('write', {}, { cookie: 'science_session=valid' })).response.status).toBe(403);
    expect(calls).toBe(0);
    const accepted = await invoke('write', {}, sessionHeaders);
    expect(accepted.response.status).toBe(200);
    expect(accepted.body.data).toBe('researcher');
  });
  it('never accepts forged context as authentication or response cookie instructions', async () => {
    for (const headers of [
      {},
      { cookie: 'science_session=invalid; science_csrf=' + csrfToken, 'X-CSRF-Token': csrfToken },
    ]) {
      const rejected = await invoke('write', { context: untrusted }, headers);
      expect(rejected.response.status).toBe(401);
      expect(rejected.response.headers.get('set-cookie')).toBeNull();
      const anonymous = await invoke('current', { context: untrusted }, headers);
      expect(anonymous.response.status).toBe(200);
      expect(anonymous.body.data).toBeNull();
      expect(anonymous.response.headers.get('set-cookie')).toBeNull();
    }
  });
  it('uses authenticated identity instead of client context on a valid session', async () => {
    const result = await invoke('write', { context: untrusted }, sessionHeaders);
    expect(result.body.data).toBe('researcher');
    expect(result.response.headers.get('set-cookie')).toBeNull();
  });
  it('keeps client identity and tenant hints explicitly outside the authority metadata', async () => {
    const result = await invoke(
      'write',
      { context: { userId: 'attacker', tenantId: 'other-tenant', traceId: 'trace', metadata: { roles: ['admin'] } } },
      sessionHeaders
    );
    expect(result.body.data).toBe('researcher');
    expect(observedMetadata.has('userId')).toBe(false);
    expect(observedMetadata.has('tenantId')).toBe(false);
    expect(observedMetadata.has('metadata')).toBe(false);
    expect(observedMetadata.get('traceId')).toBe('trace');
    expect(observedMetadata.get('requestContext')).toEqual({
      userId: 'attacker',
      tenantId: 'other-tenant',
      traceId: 'trace',
      metadata: { roles: ['admin'] },
    });
  });
  it('protects batch entries and shared batch context by the same gate', async () => {
    for (const shared of [false, true]) {
      const response = await fetch(url + '/netron/batch', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          ...(shared ? { context: untrusted } : {}),
          requests: [
            {
              id: 'forged',
              service: 'NativeAuthority',
              method: 'write',
              input: [],
              ...(!shared ? { context: untrusted } : {}),
            },
            { id: 'anon', service: 'NativeAuthority', method: 'current', input: [] },
          ],
        }),
      });
      const body = await response.json();
      expect(body.responses[0].success).toBe(false);
      expect(body.responses[0].error.code).toBe('401');
      expect(body.responses[1].success).toBe(true);
      expect(body.responses[1].data).toBeNull();
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });
  it('reports authority outages as retryable failures, never anonymous success in single or batch requests', async () => {
    const headers = { ...sessionHeaders, cookie: `science_session=unavailable; science_csrf=${csrfToken}` };
    const counts = { calls, currentCalls };
    for (const method of ['current', 'write', 'signin']) {
      const result = await invoke(method, { context: untrusted }, headers);
      expect(result.response.status).toBe(503);
      expect(result.body.success).toBe(false);
      expect(result.body.error).toMatchObject({
        code: 'authentication_unavailable',
        details: { errorCode: 'authentication_unavailable' },
      });
      expect(result.body.data).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain('secret-db-address');
      expect(result.response.headers.get('set-cookie')).toBeNull();
    }
    for (const parallel of [true, false]) {
      const batch = await fetch(url + '/netron/batch', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          id: 'outage',
          options: { parallel },
          context: untrusted,
          requests: ['current', 'write'].map((method) => ({
            id: method,
            service: 'NativeAuthority',
            method,
            input: [],
          })),
        }),
      });
      const body = await batch.json();
      expect(body.responses).toHaveLength(2);
      for (const response of body.responses) {
        expect(response.success).toBe(false);
        expect(response.error).toMatchObject({
          code: 'authentication_unavailable',
          details: { errorCode: 'authentication_unavailable' },
        });
        expect(response.data).toBeUndefined();
      }
      expect(batch.headers.get('set-cookie')).toBeNull();
    }
    expect({ calls, currentCalls }).toEqual(counts);
    const restored = await invoke('current', {}, sessionHeaders);
    expect(restored.body.data).toBe('researcher');
  });
  it('still permits native token issuance and strips HttpOnly credentials from JSON', async () => {
    const result = await invoke('signin');
    expect(result.response.status).toBe(200);
    expect(result.body.data).toEqual({ status: 'ok' });
    expect(
      result.response.headers.getSetCookie().some((c) => c.includes('science_session=valid') && c.includes('HttpOnly'))
    ).toBe(true);
    expect(result.response.headers.getSetCookie().some((c) => c.includes('science_csrf='))).toBe(true);
  });
  it('leaves no native identity outside an invocation', () => {
    expect(getCurrentRLSAuthContext()).toBeNull();
  });
});
