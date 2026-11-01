import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpRemotePeer } from '../../../src/transport/http/peer.js';
import { HttpConnection } from '../../../src/transport/http/connection.js';
import { HttpTransportClient } from '../../../src/transport/http/client.js';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP refusals in the browser', () => {
  it.each(['peer', 'connection', 'hints'] as const)('%s keeps the server refusal and diagnostic identity', async mode => {
    const headers = new Headers({ 'x-request-id': 'refused-request', 'x-correlation-id': 'refused-correlation' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false,
      error: { code: '403', message: 'Missing required permissions', details: { permission: 'sessions.resolve' } },
    }), { status: 403, headers })));
    let call: Promise<unknown>;
    if (mode === 'peer') call = new HttpRemotePeer('http://fixture.invalid').call('Restricted', 'read', [{}]);
    else if (mode === 'hints') call = new HttpTransportClient('http://fixture.invalid').invoke('Restricted', 'read', [{}], { hints: { timeout: 5000 } });
    else call = new HttpConnection('http://fixture.invalid').send(new TextEncoder().encode(JSON.stringify({ type: 'request', service: 'Restricted', method: 'read', input: {} })));
    await expect(call).rejects.toMatchObject({ code: 403, httpStatus: 403, message: 'Missing required permissions',
      details: { permission: 'sessions.resolve' }, requestId: 'refused-request', correlationId: 'refused-correlation' });
  });
});
