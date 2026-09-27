/**
 * A token leaves by ONE channel: a cookie or a body, never both.
 *
 * A cookie-mode deployment keeps its tokens in HttpOnly cookies so that no
 * script in the page can read them. Two doors handed them to the page anyway,
 * both measured on the daos dev stand on 2026-09-27, where every backend runs
 * a composite (cookie + bearer) transport:
 *
 *  - `CompositeTokenTransport.issue()` fanned out to every delegate and
 *    stripped nothing. `signin` answered with the access token (547 chars)
 *    and the 7-day refresh token (43) in the body beside the Set-Cookie. So
 *    did a `refreshAccessToken` that any script can make: empty body, refresh
 *    cookie sent by the browser, CSRF header read from the readable cookie.
 *  - `/netron/batch` never applied the transport at all. A cookie-mode
 *    refresh through it answered 200 with both tokens in the body and no
 *    Set-Cookie. The server had rotated, so the browser kept a spent refresh
 *    cookie, and its next renewal would read as reuse and burn the session.
 *
 * The rule this court holds is about the RESPONSE, not a list of doors: a
 * token that is in a Set-Cookie is not in the body, and a browser request
 * (`isBrowserRequest`: `Origin` or `Sec-Fetch-Site`, which no script can remove)
 * never finds a token in the body under a transport that has cookies. A new
 * door is held by it without being named here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { HttpTransport } from '../../../src/netron/transport/http/http-transport.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import { CookieTokenTransport } from '../../../src/netron/auth/token-transports/cookie.js';
import { BearerTokenTransport } from '../../../src/netron/auth/token-transports/bearer.js';
import { CompositeTokenTransport } from '../../../src/netron/auth/token-transports/composite.js';
import { isBrowserRequest, type ITokenTransport } from '../../../src/netron/auth/token-transport.js';
import { issueTokens } from '../../../src/netron/auth/token-issuance.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { createMockLogger } from '../test-utils.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';

@Service('channelAuth@1.0.0')
class ChannelAuthService {
  @Public()
  async signin(input: { username: string }): Promise<{ user: string; accessToken: string; refreshToken: string; accessTokenExpiresAt: string }> {
    const accessToken = `access-${input.username}`;
    const refreshToken = `refresh-${input.username}`;
    issueTokens({ access: accessToken, refresh: refreshToken });
    // A field that is about the token but is not the token: it must stay.
    return { user: input.username, accessToken, refreshToken, accessTokenExpiresAt: '2026-09-27T19:40:01.000Z' };
  }
}

type Kind = 'cookie' | 'composite' | 'bearer';

function transportOf(kind: Kind): ITokenTransport {
  const cookie = () =>
    new CookieTokenTransport({
      accessCookie: { name: 'omni_access', secure: false, path: '/' },
      refreshCookie: { name: 'omni_refresh', secure: false, path: '/' },
    });
  if (kind === 'cookie') return cookie();
  if (kind === 'composite') return new CompositeTokenTransport([cookie(), new BearerTokenTransport()]);
  return new BearerTokenTransport();
}

let server: Netron | undefined;

async function boot(kind: Kind): Promise<number> {
  for (let port = 19400 + Math.floor(Math.random() * 400); ; port++) {
    const logger = createMockLogger();
    const netron = new Netron(logger, { id: `channel-${kind}-${port}` });
    const authn = new AuthenticationManager(logger, {
      authenticate: async (): Promise<AuthContext> => ({ userId: 'u1', roles: ['user'], permissions: [] }),
      validateToken: async (): Promise<AuthContext> => ({ userId: 'u1', roles: ['user'], permissions: [] }),
    });
    netron.configureAuth(authn, new AuthorizationManager(logger), { tokenTransport: transportOf(kind) });
    netron.registerTransport('http', () => new HttpTransport());
    try {
      await netron.registerTransportServer('http', { name: 'http', options: { host: 'localhost', port } });
      await netron.start();
    } catch {
      await netron.stop().catch(() => {});
      continue;
    }
    await netron.peer.exposeService(new ChannelAuthService());
    server = netron;
    return port;
  }
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

interface Answer {
  cookies: string[];
  /** The one answer's data — the invoke's, or the batch item's. */
  data: Record<string, unknown>;
  /** The whole response body as text: a token anywhere in it counts. */
  text: string;
}

async function ask(port: number, path: 'invoke' | 'batch', browser: boolean, username: string): Promise<Answer> {
  const call = { id: `c-${username}`, service: 'channelAuth@1.0.0', method: 'signin', input: { username } };
  const res = await fetch(`http://localhost:${port}/netron/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(browser ? { Origin: `http://localhost:${port}`, 'Sec-Fetch-Site': 'same-origin' } : {}),
    },
    body: JSON.stringify(
      path === 'invoke'
        ? { version: '2.0', timestamp: Date.now(), ...call }
        : { id: `b-${username}`, version: '2.0', timestamp: Date.now(), requests: [call] },
    ),
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  const body = JSON.parse(text);
  const item = path === 'invoke' ? body : body.responses[0];
  expect(item.success, JSON.stringify(item.error ?? null)).toBe(true);
  return { cookies: res.headers.getSetCookie(), data: item.data, text };
}

/** The rule itself, on one response: no token in a cookie and the body at once. */
function tokensInBoth(a: Answer, username: string): string[] {
  return [`access-${username}`, `refresh-${username}`].filter(
    (t) => a.cookies.some((c) => c.includes(`=${t}`)) && a.text.includes(t),
  );
}

const CASES: Array<{ kind: Kind; browser: boolean; channel: 'cookie' | 'body' }> = [
  { kind: 'cookie', browser: true, channel: 'cookie' },
  { kind: 'cookie', browser: false, channel: 'cookie' },
  { kind: 'composite', browser: true, channel: 'cookie' },
  { kind: 'composite', browser: false, channel: 'body' },
  { kind: 'bearer', browser: true, channel: 'body' },
  { kind: 'bearer', browser: false, channel: 'body' },
];

describe.each(['invoke', 'batch'] as const)('/netron/%s', (path) => {
  it.each(CASES)('$kind transport, browser: $browser → by $channel only', async ({ kind, browser, channel }) => {
    const port = await boot(kind);
    const username = `${kind}-${browser ? 'b' : 'n'}-${path}`;

    const a = await ask(port, path, browser, username);

    expect(tokensInBoth(a, username), 'a token in a Set-Cookie AND in the body').toEqual([]);
    if (channel === 'cookie') {
      expect(a.cookies.some((c) => c.startsWith(`omni_access=access-${username}`))).toBe(true);
      expect(a.cookies.some((c) => c.startsWith(`omni_refresh=refresh-${username}`))).toBe(true);
      expect(a.data['accessToken']).toBeUndefined();
      expect(a.data['refreshToken']).toBeUndefined();
    } else {
      expect(a.cookies).toEqual([]);
      expect(a.data['accessToken']).toBe(`access-${username}`);
      expect(a.data['refreshToken']).toBe(`refresh-${username}`);
    }
    // What the renewal is scheduled from is not a token, and stays.
    expect(a.data['user']).toBe(username);
    expect(a.data['accessTokenExpiresAt']).toBe('2026-09-27T19:40:01.000Z');
  });
});

describe('the signal and its default', () => {
  it('a browser is known by Origin or Sec-Fetch-Site, whatever the case of the name', () => {
    expect(isBrowserRequest({ headers: { origin: 'http://x.onion' } })).toBe(true);
    expect(isBrowserRequest({ headers: { Origin: 'http://x.onion' } })).toBe(true);
    expect(isBrowserRequest({ headers: { 'Sec-Fetch-Site': 'same-origin' } })).toBe(true);
    // What Node's own fetch sends (v24.13.0): a Node client, not a browser.
    expect(isBrowserRequest({ headers: { 'sec-fetch-mode': 'cors', 'user-agent': 'node', accept: '*/*' } })).toBe(false);
    expect(isBrowserRequest({ headers: { 'content-type': 'application/json', authorization: 'Bearer t' } })).toBe(false);
    expect(isBrowserRequest({ headers: { origin: '' } })).toBe(false);
    expect(isBrowserRequest(undefined)).toBe(false);
  });

  it('a composite asked without the request answers as to a browser — the failure that is loud', () => {
    const composite = transportOf('composite');
    const cookies: string[] = [];
    const result = composite.issue({ appendHeader: (_n, v) => cookies.push(v) }, { access: 'a1', refresh: 'r1' });
    expect(cookies.some((c) => c.startsWith('omni_access=a1'))).toBe(true);
    expect(result.stripFromBody).toEqual(expect.arrayContaining(['accessToken', 'refreshToken']));
  });

  it('a composite with no cookie delegate has one channel, the body, for everyone', () => {
    const composite = new CompositeTokenTransport([new BearerTokenTransport()]);
    const cookies: string[] = [];
    const result = composite.issue(
      { appendHeader: (_n, v) => cookies.push(v) },
      { access: 'a1' },
      { headers: { origin: 'http://x.onion' } },
    );
    expect(cookies).toEqual([]);
    expect(result.stripFromBody ?? []).toEqual([]);
  });
});
