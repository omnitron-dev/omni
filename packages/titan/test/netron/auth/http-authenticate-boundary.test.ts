import { afterAll, describe, expect, it } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { HttpServer } from '../../../src/netron/transport/http/server.js';
import {
  AuthenticationManager,
  AuthenticationUnavailableError,
} from '../../../src/netron/auth/authentication-manager.js';
import type { HttpAuthSecurity } from '../../../src/netron/auth/types.js';
import { createNullLogger } from '../../../src/types/logger.js';

const allowed = 'https://science.example';
const fixtures: { server: HttpServer; netron: Netron }[] = [];
async function fixture(httpSecurity?: HttpAuthSecurity) {
  const logger = createNullLogger();
  const netron = new Netron(logger);
  let calls = 0;
  const validate = (token: string) => {
    calls++;
    if (token === 'unavailable') throw new AuthenticationUnavailableError(new Error('private provider fault'));
    if (token !== 'opaque') throw new Error('invalid');
    return { userId: 'researcher', metadata: { confidential: 'provider-only' } };
  };
  netron.configureAuth(
    new AuthenticationManager(logger, {
      authenticate: (c) => validate(c.token ?? ''),
      validateToken: validate,
      tokenCache: { enabled: false },
    }),
    undefined,
    { httpSecurity }
  );
  await netron.start();
  const server = new HttpServer({ host: '127.0.0.1', port: 0 });
  server.setPeer(netron.peer);
  await server.listen();
  fixtures.push({ server, netron });
  return {
    calls: () => calls,
    async authenticate(origin?: string, token = 'opaque') {
      const response = await fetch(`http://127.0.0.1:${server.port}/netron/authenticate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ id: 'builtin-auth', credentials: { token } }),
      });
      return { response, body: await response.json() };
    },
  };
}
afterAll(async () => {
  for (const { server, netron } of fixtures) {
    await server.close();
    await netron.stop();
  }
});

describe('built-in HTTP authentication endpoint policy', () => {
  it('preserves the default endpoint when no HTTP security policy was configured', async () => {
    const f = await fixture();
    const result = await f.authenticate();
    expect(result.response.status).toBe(200);
    expect(result.body.result).toMatchObject({ success: true, context: { userId: 'researcher' } });
    expect(f.calls()).toBe(1);
  });
  it('enforces a configured Origin allow-list before credential validation, even without a cookie', async () => {
    const f = await fixture({ origin: { allowedOrigins: [allowed] } });
    for (const origin of [undefined, 'https://attacker.example', allowed + '.attacker.example']) {
      const result = await f.authenticate(origin);
      expect(result.response.status).toBe(403);
      expect(JSON.stringify(result.body)).not.toContain('provider-only');
    }
    expect(f.calls()).toBe(0);
    const accepted = await f.authenticate(allowed);
    expect(accepted.response.status).toBe(200);
    expect(accepted.body.result.success).toBe(true);
    expect(f.calls()).toBe(1);
  });
  it('disables the endpoint before invoking a provider or disclosing any AuthContext', async () => {
    const f = await fixture({ authenticateEndpoint: 'disabled', origin: { allowedOrigins: [allowed] } });
    for (const origin of [undefined, allowed, 'https://attacker.example']) {
      const result = await f.authenticate(origin);
      expect(result.response.status).toBe(404);
      expect(result.body.result).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain('researcher');
      expect(JSON.stringify(result.body)).not.toContain('provider-only');
      expect(result.response.headers.get('set-cookie')).toBeNull();
    }
    expect(f.calls()).toBe(0);
  });
  it('preserves provider-unavailable failure on the enabled native endpoint', async () => {
    const f = await fixture({ origin: { allowedOrigins: [allowed] } });
    const result = await f.authenticate(allowed, 'unavailable');
    expect(result.response.status).toBe(503);
    expect(result.body.error.code).toBe('authentication_unavailable');
    expect(JSON.stringify(result.body)).not.toContain('private provider fault');
  });
});
